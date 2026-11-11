import type { ChatProvider } from "../llm/types.ts";
import { ChatStore } from "../store/index.ts";
import { archiveExperience } from "./archive.ts";
import { distillMemoryBatch } from "./distill.ts";
import { beginMemoryJob, endMemoryJob, isForegroundChatActive } from "./priority.ts";
import type { MemoryStore } from "./types.ts";

interface ProcessorDeps {
  store: ChatStore;
  provider: ChatProvider;
  memory?: MemoryStore;
}

const queues = new WeakMap<ChatStore, Promise<void>>();

/** 被打断的回复带 `{ type: "interrupted" }` 附件：能确认是它，就不拿半句回复当记忆依据。 */
function isInterrupted(message: { attachment?: unknown } | undefined): boolean {
  const attachment = message?.attachment;
  return Boolean(attachment && typeof attachment === "object" && (attachment as { type?: unknown }).type === "interrupted");
}

async function drain({ store, provider, memory }: ProcessorDeps) {
  if (isForegroundChatActive()) return;
  if (memory?.syncPendingExperiences) {
    try {
      await memory.syncPendingExperiences();
    } catch (error) {
      console.warn("本机经历向量索引恢复失败：", error instanceof Error ? error.message : error);
    }
  }
  for (;;) {
    if (isForegroundChatActive()) return;
    const batch = store.claimMemoryJobBatch();
    if (!batch) return;
    const controller = beginMemoryJob();
    if (!controller) {
      for (const job of batch.jobs) store.pauseMemoryJob(job.id);
      return;
    }
    try {
      // 被打断的轮次只拿用户消息去整理；已生成的那半句标记为 interrupted，不作为事实依据。
      const interruptedAssistantIds = new Set(
        batch.jobs
          .map((job) => job.assistantMessageId)
          .filter((id) => isInterrupted(store.message(id))),
      );
      const messages = batch.messages.filter((message) => !(message.role === "assistant" && interruptedAssistantIds.has(message.id)));
      const needsDistillation = batch.jobs.some((job) => !job.factsDone || !job.summaryDone);
      if (needsDistillation && messages.length > 0) {
        const sessionId = batch.jobs[0].sessionId;
        const previousObservation = store.observation(sessionId);
        const query = messages.filter((message) => message.role === "user").map((message) => message.content).join("\n").slice(0, 12_000);
        const context = store.memoryDistillationWorkingSet(query);
        const inputCharacters = JSON.stringify({ messages, previousObservation: previousObservation?.summary, context }).length;
        if (process.env.WP_DEBUG) console.log(`[记忆] 整理 ${batch.jobs.length} 轮聊天、${inputCharacters} 字符输入、1 次模型请求。`);
        const result = await distillMemoryBatch(provider, {
          messages,
          previousObservation: previousObservation?.summary,
          context,
        }, controller.signal);
        controller.signal.throwIfAborted();
        const saved = store.publishMemoryDistillation(result, batch.jobs.map((job) => job.id), true, {
          sessionId,
          fromMessageId: messages[0].id,
          throughMessageId: messages.at(-1)!.id,
        });
        if (memory) {
          for (const factId of saved.supersededIds) {
            const vectorId = store.factVectorId(factId);
            if (vectorId) {
              try {
                await memory.remove(vectorId);
                // 向量已删：清掉指向它的 id，之后在记忆页删这条旧事实时不会再去删一个不存在的向量。
                store.setFactVectorId(factId, null);
              } catch (error) {
                console.warn("已取代事实的语义索引清理失败：", error instanceof Error ? error.message : error);
              }
            }
          }
          const indexedFacts = new Set<number>();
          for (const fact of saved.facts) {
            if (fact.status !== "active" || indexedFacts.has(fact.id)) continue;
            indexedFacts.add(fact.id);
            try {
              const indexed = await memory.addExperience({
                kind: "fact",
                title: `${fact.subject} · ${fact.predicate}`.slice(0, 120),
                text: `${fact.subject}的${fact.predicate}：${fact.value}`,
                sourceId: `fact:${fact.id}`,
              });
              if (!indexed.id.startsWith("local-exp:")) store.setFactVectorId(fact.id, indexed.id);
            } catch (error) {
              console.warn("事实语义索引失败，本机事实仍已保存：", error instanceof Error ? error.message : error);
            }
          }
        }
        for (const fact of saved.facts) {
          if (fact.kind !== "plan") continue;
          const activePlan = result.facts.some((candidate) =>
            candidate.kind === "plan" && candidate.planStatus === "active" && candidate.subject === fact.subject &&
            candidate.predicate === fact.predicate && candidate.value === fact.value &&
            fact.sources.some((source) => source.messageId === candidate.sourceMessageId),
          );
          if (!activePlan) continue;
          const source = fact.sources.find((item) => batch.jobs.some((job) => job.userMessageId === item.messageId));
          if (!source) continue;
          store.enqueueProactiveTrigger({
            sourceMessageId: source.messageId,
            factId: fact.id,
            sessionId: source.sessionId,
            planText: `${fact.subject}的${fact.predicate}：${fact.value}`,
            evidence: source.quote,
          });
        }
      } else if (batch.jobs.some((job) => !job.legacyDone)) {
        for (const job of batch.jobs) if (!job.legacyDone) store.markMemoryJobStep(job.id, "legacy");
      }

      for (const job of batch.jobs) {
        controller.signal.throwIfAborted();
        if (!job.vectorsDone) {
          const user = store.message(job.userMessageId);
          const assistant = store.message(job.assistantMessageId);
          if (user) {
            const session = store.getSession(job.sessionId);
            const includeReply = assistant && !interruptedAssistantIds.has(assistant.id);
            await archiveExperience(store, memory, {
              kind: "chat",
              title: session?.title ?? "聊天经历",
              text: (includeReply ? [`用户：${user.content}`, `角色：${assistant.content}`] : [`用户：${user.content}`]).join("\n").slice(0, 6_000),
              sourceId: `chat:${job.sessionId}:${user.id}`,
              sourceSessionId: job.sessionId,
              sourceMessageId: user.id,
            }, "聊天经历");
          }
          store.markMemoryJobStep(job.id, "vectors");
        }
        store.completeMemoryJob(job.id);
        if (process.env.WP_DEBUG) console.log(`[记忆] 已处理批次任务 ${job.id}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const job of batch.jobs) {
        if (controller.signal.aborted) store.pauseMemoryJob(job.id);
        else store.failMemoryJob(job.id, job.attempts, message);
      }
      if (!controller.signal.aborted) console.warn("本地记忆任务失败，稍后重试：", message);
      if (controller.signal.aborted) return;
    } finally {
      endMemoryJob(controller);
    }
  }
}

/** 按顺序处理 SQLite outbox；正在执行的任务在进程重启时会恢复为 pending。 */
export function scheduleMemoryJobs(deps: ProcessorDeps): Promise<void> {
  const previous = queues.get(deps.store) ?? Promise.resolve();
  let current: Promise<void>;
  current = previous.catch(() => {}).then(() => drain(deps)).finally(() => {
    if (queues.get(deps.store) === current) queues.delete(deps.store);
  });
  queues.set(deps.store, current);
  return current;
}

export async function waitForMemoryJobs(store: ChatStore) {
  await queues.get(store);
}
