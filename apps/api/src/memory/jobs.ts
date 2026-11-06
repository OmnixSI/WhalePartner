import type { ChatProvider } from "../llm/types.ts";
import type { MemoryStore } from "./types.ts";
import { archiveExperience } from "./archive.ts";
import { extractUserFacts } from "./facts.ts";
import { observeConversation } from "./observer.ts";
import { ChatStore } from "../store.ts";

interface ProcessorDeps {
  store: ChatStore;
  provider: ChatProvider;
  memory?: MemoryStore;
}

const queues = new WeakMap<ChatStore, Promise<void>>();

async function drain({ store, provider, memory }: ProcessorDeps) {
  if (memory?.syncPendingExperiences) {
    try {
      await memory.syncPendingExperiences();
    } catch (error) {
      console.warn("本机经历向量索引恢复失败：", error instanceof Error ? error.message : error);
    }
  }
  for (;;) {
    const job = store.claimMemoryJob();
    if (!job) return;
    try {
      const user = store.message(job.userMessageId);
      const assistant = store.message(job.assistantMessageId);
      if (!user || !assistant) {
        store.completeMemoryJob(job.id);
        continue;
      }

      if (!job.factsDone) {
        const candidates = await extractUserFacts(provider, user.content);
        const { facts } = store.saveFacts(user.id, candidates);
        if (memory) {
          for (const fact of facts) {
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
        store.markMemoryJobStep(job.id, "facts");
      }

      if (!job.vectorsDone) {
        const session = store.getSession(job.sessionId);
        const experience = {
          kind: "chat",
          title: session?.title ?? "聊天经历",
          text: [`用户：${user.content}`, `角色：${assistant.content}`].join("\n").slice(0, 6000),
          sourceId: `chat:${job.sessionId}:${user.id}`,
          sourceSessionId: job.sessionId,
          sourceMessageId: user.id,
        };
        await archiveExperience(store, memory, experience, "聊天经历");
        store.markMemoryJobStep(job.id, "vectors");
      }

      if (!job.summaryDone) {
        const input = store.observationInput(job.sessionId);
        if (input) {
          const summary = await observeConversation(provider, input);
          if (summary) {
            store.saveObservation(job.sessionId, summary, input.messages[0].id, input.throughMessageId);
          }
        }
        store.markMemoryJobStep(job.id, "summary");
      }

      if (!job.legacyDone) {
        if (memory) {
          const vectorIds = await memory.remember([
            { role: "user", content: user.content },
            { role: "assistant", content: assistant.content },
          ]);
          for (const vectorId of vectorIds ?? []) store.addLegacyMemorySource(vectorId, job.sessionId);
        }
        store.markMemoryJobStep(job.id, "legacy");
      }

      store.completeMemoryJob(job.id);
      if (process.env.WP_DEBUG) console.log(`[记忆] 已处理会话任务 ${job.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store.failMemoryJob(job.id, job.attempts, message);
      console.warn("本地记忆任务失败，稍后重试：", message);
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
