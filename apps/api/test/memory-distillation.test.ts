import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatProvider } from "../src/llm/types.ts";
import { distillMemoryBatch } from "../src/memory/distill.ts";
import { scheduleMemoryJobs } from "../src/memory/jobs.ts";
import { beginForegroundChat } from "../src/memory/priority.ts";
import { ChatStore } from "../src/store/index.ts";

function scripted(response: (messages: Array<{ role: string; content: string }>) => string | Promise<string>, onCall?: () => void): ChatProvider {
  return {
    id: "memory-test", model: "memory-test",
    async *stream(messages, options) {
      onCall?.();
      const result = await response(messages);
      options?.signal?.throwIfAborted();
      yield { text: result };
    },
  };
}

test("memory jobs distill a bounded chat batch into sourced facts, topics, and core in one transaction", async () => {
  const store = new ChatStore(":memory:");
  const session = store.createSession("whale", "记忆整理");
  const user1 = store.add("user", "我最近在学鲸鱼的声音，也喜欢海洋纪录片。", null, "whale", session.id);
  const assistant1 = store.add("assistant", "鲸鱼会用声音交流。", null, "whale", session.id);
  const user2 = store.add("user", "我更正一下，我住在墨尔本。", null, "whale", session.id);
  const assistant2 = store.add("assistant", "记下啦。", null, "whale", session.id);
  store.enqueueMemoryJob({ sessionId: session.id, character: "whale", userMessageId: user1.id, assistantMessageId: assistant1.id });
  store.enqueueMemoryJob({ sessionId: session.id, character: "whale", userMessageId: user2.id, assistantMessageId: assistant2.id });
  let calls = 0;
  const provider = scripted((messages) => {
    calls += 1;
    const payload = JSON.parse(messages.at(-1)!.content) as { messages: Array<{ message_id: number }> };
    assert.deepEqual(payload.messages.map((message) => message.message_id), [user1.id, assistant1.id, user2.id, assistant2.id]);
    return JSON.stringify({
      facts: [
        { source_message_id: user1.id, subject: "用户", predicate: "近期学习", value: "鲸鱼的声音", kind: "fact", evidence: "我最近在学鲸鱼的声音", confidence: 0.9, importance: 0.7, supersedes: false },
        { source_message_id: user2.id, subject: "用户", predicate: "居住城市", value: "墨尔本", kind: "fact", evidence: "我住在墨尔本", confidence: 0.95, importance: 0.8, supersedes: true },
      ],
      topics: [{ key: "ocean", title: "海洋兴趣", summary: "用户在学习鲸鱼声音，也喜欢海洋纪录片。", source_message_ids: [user1.id] }],
      core: "用户近期学习鲸鱼声音；居住在墨尔本。",
      core_source_message_ids: [user1.id, user2.id],
      observation: "用户分享了近期学习和居住城市。",
    });
  });

  try {
    await scheduleMemoryJobs({ store, provider });
    assert.equal(calls, 1);
    assert.equal(store.memoryQueueStatus().pendingJobs, 0);
    assert.equal(store.listFacts().length, 2);
    const prepared = store.memoryDistillation("海洋纪录片");
    assert.match(prepared.core ?? "", /墨尔本/);
    assert.equal(prepared.topics.length, 1);
    assert.equal(prepared.topics[0].sourceMessageIds[0], user1.id);
    assert.equal(store.observation(session.id)?.summary, "用户分享了近期学习和居住城市。");
  } finally {
    store.close();
  }
});

test("foreground chat aborts an active distillation and the same durable job resumes when idle", async () => {
  const store = new ChatStore(":memory:");
  const session = store.createSession("whale", "前台优先");
  const user = store.add("user", "我住在悉尼。", null, "whale", session.id);
  const assistant = store.add("assistant", "好的，我记住了。", null, "whale", session.id);
  store.enqueueMemoryJob({ sessionId: session.id, character: "whale", userMessageId: user.id, assistantMessageId: assistant.id });
  let started!: () => void;
  const called = new Promise<void>((resolve) => { started = resolve; });
  let calls = 0;
  const provider: ChatProvider = {
    id: "abort-test", model: "abort-test",
    async *stream(_messages, options) {
      calls += 1;
      if (calls === 1) {
        started();
        await new Promise<void>((resolve) => options?.signal?.addEventListener("abort", () => resolve(), { once: true }));
        options?.signal?.throwIfAborted();
      }
      yield { text: JSON.stringify({
        facts: [{ source_message_id: user.id, subject: "用户", predicate: "居住城市", value: "悉尼", kind: "fact", evidence: "我住在悉尼", confidence: 0.9, importance: 0.8, supersedes: false }],
        topics: [], core: "用户住在悉尼。", core_source_message_ids: [user.id], observation: "用户说住在悉尼。",
      }) };
    },
  };
  let finishChat: (() => void) | undefined;
  try {
    const running = scheduleMemoryJobs({ store, provider });
    await called;
    finishChat = beginForegroundChat();
    await running;
    assert.equal(store.memoryQueueStatus().pendingJobs, 1);
    assert.equal(store.listFacts().length, 0);
    finishChat();
    finishChat = undefined;
    await scheduleMemoryJobs({ store, provider });
    assert.equal(calls, 2);
    assert.equal(store.memoryQueueStatus().pendingJobs, 0);
    assert.equal(store.listFacts()[0]?.value, "悉尼");
  } finally {
    finishChat?.();
    store.close();
  }
});

test("an explicit correction invalidates topic and core notes rooted in the superseded fact", () => {
  const store = new ChatStore(":memory:");
  const session = store.createSession("whale", "事实纠正");
  const old = store.add("user", "我现在住在悉尼。", null, "whale", session.id);
  store.saveFacts(old.id, [{
    subject: "用户", predicate: "居住城市", value: "悉尼", kind: "fact", evidence: "我现在住在悉尼", confidence: 0.9, importance: 0.8, supersedes: false,
  }]);
  store.publishMemoryDistillation({
    facts: [], topics: [{ key: "home", title: "居住地", summary: "用户住在悉尼。", sourceMessageIds: [old.id] }],
    core: "用户住在悉尼。", coreSourceMessageIds: [old.id],
  }, [], false);
  const correction = store.add("user", "更正，我现在住在墨尔本。", null, "whale", session.id);
  const published = store.publishMemoryDistillation({
    facts: [{
      sourceMessageId: correction.id, subject: "用户", predicate: "居住城市", value: "墨尔本", kind: "fact",
      evidence: "我现在住在墨尔本", confidence: 0.95, importance: 0.9, supersedes: true,
    }],
    topics: [{ key: "home", title: "居住地", summary: "用户住在悉尼。", sourceMessageIds: [old.id, correction.id] }],
    core: "用户住在悉尼。", coreSourceMessageIds: [old.id, correction.id],
  }, [], false);

  try {
    assert.equal(published.supersededIds.length, 1);
    assert.equal(store.listFacts().find((fact) => fact.status === "active")?.value, "墨尔本");
    const prepared = store.memoryDistillation("居住地");
    assert.equal(prepared.core, undefined);
    assert.equal(prepared.topics.length, 0);
  } finally {
    store.close();
  }
});

test("a synonym-key correction replaces its referenced fact and clears a stale session observation", () => {
  const store = new ChatStore(":memory:");
  const session = store.createSession("whale", "同义事实键纠正");
  const old = store.add("user", "我现在住在悉尼。", null, "whale", session.id);
  const oldFact = store.saveFacts(old.id, [{
    subject: "用户", predicate: "居住地", value: "悉尼", kind: "fact", evidence: "我现在住在悉尼", confidence: 0.9, importance: 0.8, supersedes: false,
  }]).facts[0]!;
  store.saveObservation(session.id, "用户住在悉尼。", old.id, old.id);
  const correction = store.add("user", "更正，我现在住在墨尔本。", null, "whale", session.id);

  try {
    const published = store.publishMemoryDistillation({
      facts: [{
        sourceMessageId: correction.id, subject: "用户", predicate: "居住城市", value: "墨尔本", kind: "fact",
        evidence: "我现在住在墨尔本", confidence: 0.95, importance: 0.9, supersedes: true, supersedesFactIds: [oldFact.id],
      }],
      topics: [], coreSourceMessageIds: [],
    }, [], false);

    assert.deepEqual(published.supersededIds, [oldFact.id]);
    assert.equal(store.getFact(oldFact.id)?.status, "superseded");
    assert.equal(store.listFacts().find((fact) => fact.status === "active")?.value, "墨尔本");
    assert.equal(store.observation(session.id), undefined);
  } finally {
    store.close();
  }
});

test("a cancelled plan supersedes its active plan and suppresses its pending reminder", async () => {
  const store = new ChatStore(":memory:");
  const session = store.createSession("whale", "取消计划");
  store.putCompanionSettings({ enabled: true });
  const old = store.add("user", "周五我会去看牙医。", null, "whale", session.id);
  const oldFact = store.saveFacts(old.id, [{
    subject: "用户", predicate: "看牙医", value: "周五去看牙医", kind: "plan", evidence: "周五我会去看牙医", confidence: 0.95, importance: 0.8, supersedes: false,
  }]).facts[0]!;
  const oldTrigger = store.enqueueProactiveTrigger({
    sourceMessageId: old.id, factId: oldFact.id, sessionId: session.id, planText: "周五去看牙医", evidence: "周五我会去看牙医",
  });
  assert.ok(oldTrigger);
  const correction = store.add("user", "我取消周五去看牙医的安排了。", null, "whale", session.id);
  const assistant = store.add("assistant", "好，已经更新。", null, "whale", session.id);
  store.enqueueMemoryJob({ sessionId: session.id, character: "whale", userMessageId: correction.id, assistantMessageId: assistant.id });
  const provider = scripted((messages) => {
    const payload = JSON.parse(messages.at(-1)!.content) as { active_facts: Array<{ id: number }> };
    assert.ok(payload.active_facts.some((fact) => fact.id === oldFact.id));
    return JSON.stringify({
      facts: [{
        source_message_id: correction.id, subject: "用户", predicate: "日程安排", value: "已取消周五看牙医", kind: "plan",
        evidence: "我取消周五去看牙医的安排了", confidence: 0.95, importance: 0.8,
        supersedes_fact_ids: [oldFact.id], plan_status: "cancelled",
      }],
      topics: [], core: "", core_source_message_ids: [], observation: "",
    });
  });

  try {
    await scheduleMemoryJobs({ store, provider });
    assert.equal(store.proactiveFactActive(oldFact.id), false);
    assert.equal(store.proactiveTrigger(oldTrigger)?.status, "suppressed");
    assert.equal(store.pendingProactiveTriggers().some((trigger) => trigger.sourceMessageId === correction.id), false);
    assert.equal(store.listFacts().find((fact) => fact.id === oldFact.id)?.status, "superseded");
    assert.equal(store.listFacts().filter((fact) => fact.kind === "plan" && fact.status === "active").length, 0);
    assert.equal(store.memoryDistillationWorkingSet("取消").activePlanSubjects?.includes("用户"), false);
  } finally {
    store.close();
  }
});

test("a terminal plan with no valid active-plan target is dropped and the rest of the batch still lands", async () => {
  const store = new ChatStore(":memory:");
  const session = store.createSession("whale", "计划终态校验");
  const old = store.add("user", "周五我会去看牙医。", null, "whale", session.id);
  store.saveFacts(old.id, [{
    subject: "用户", predicate: "看牙医", value: "周五去看牙医", kind: "plan", evidence: "周五我会去看牙医", confidence: 0.95, importance: 0.8, supersedes: false,
  }]);
  const otherFactMessage = store.add("user", "我喜欢咖啡。", null, "whale", session.id);
  const otherFact = store.saveFacts(otherFactMessage.id, [{
    subject: "用户", predicate: "喜好饮品", value: "咖啡", kind: "preference", evidence: "我喜欢咖啡", confidence: 0.9, importance: 0.7, supersedes: false,
  }]).facts[0]!;
  const correction = store.add("user", "我取消周五去看牙医的安排了，另外我养了一只猫。", null, "whale", session.id);
  const terminal = {
    source_message_id: correction.id, subject: "用户", predicate: "日程安排", value: "已取消周五看牙医", kind: "plan",
    evidence: "我取消周五去看牙医的安排了", confidence: 0.95, importance: 0.8, plan_status: "cancelled",
  };
  const pet = {
    source_message_id: correction.id, subject: "用户", predicate: "宠物", value: "一只猫", kind: "fact",
    evidence: "我养了一只猫", confidence: 0.95, importance: 0.7, supersedes: false,
  };
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args.join(" "));
  try {
    const context = store.memoryDistillationWorkingSet(correction.content);
    // 引用了另一主体无关的事实 id：无效来源，丢弃终态候选，宠物事实照常通过。
    const wrongTarget = await distillMemoryBatch(
      scripted(() => JSON.stringify({ facts: [{ ...terminal, supersedes_fact_ids: [otherFact.id] }, pet], topics: [], core: "", core_source_message_ids: [], observation: "" })),
      { messages: [correction], context },
    );
    assert.deepEqual(wrongTarget.facts.map((fact) => fact.predicate), ["宠物"]);
    // 活动计划根本不在上下文里：同样丢弃而不是抛错。
    const hiddenPlan = await distillMemoryBatch(
      scripted(() => JSON.stringify({ facts: [terminal, pet], topics: [], core: "", core_source_message_ids: [], observation: "" })),
      { messages: [correction], context: { ...context, facts: [], activePlanSubjects: ["用户"] } },
    );
    assert.deepEqual(hiddenPlan.facts.map((fact) => fact.predicate), ["宠物"]);
    assert.equal(warnings.length, 2);
    assert.match(warnings[0]!, /计划终态缺少对应的活动计划来源/u);
    assert.equal(store.listFacts().filter((fact) => fact.status === "active" && fact.kind === "plan").length, 1);
  } finally {
    console.warn = warn;
    store.close();
  }
});

test("a memory job whose terminal plan cannot find its active plan completes and writes the other facts", async () => {
  const store = new ChatStore(":memory:");
  const session = store.createSession("whale", "终态计划不阻塞批次");
  const old = store.add("user", "周五我会去看牙医。", null, "whale", session.id);
  store.saveFacts(old.id, [{
    subject: "用户", predicate: "看牙医", value: "周五去看牙医", kind: "plan", evidence: "周五我会去看牙医", confidence: 0.95, importance: 0.8, supersedes: false,
  }]);
  const user = store.add("user", "我取消周五去看牙医的安排了，另外我养了一只猫。", null, "whale", session.id);
  const assistant = store.add("assistant", "好的。", null, "whale", session.id);
  store.enqueueMemoryJob({ sessionId: session.id, character: "whale", userMessageId: user.id, assistantMessageId: assistant.id });
  const provider = scripted(() => JSON.stringify({
    facts: [
      { source_message_id: user.id, subject: "用户", predicate: "日程安排", value: "已取消周五看牙医", kind: "plan", evidence: "我取消周五去看牙医的安排了", confidence: 0.95, importance: 0.8, plan_status: "cancelled" },
      { source_message_id: user.id, subject: "用户", predicate: "宠物", value: "一只猫", kind: "fact", evidence: "我养了一只猫", confidence: 0.95, importance: 0.7, supersedes: false },
    ],
    topics: [], core: "", core_source_message_ids: [], observation: "",
  }));
  const warn = console.warn;
  console.warn = () => {};
  try {
    await scheduleMemoryJobs({ store, provider });
    assert.equal(store.memoryQueueStatus().pendingJobs, 0);
    assert.equal(store.memoryQueueStatus().retryingJobs, 0);
    assert.ok(store.listFacts().some((fact) => fact.predicate === "宠物" && fact.status === "active"));
  } finally {
    console.warn = warn;
    store.close();
  }
});

test("the distillation working set keeps an active plan even when related facts fill the quota", () => {
  const store = new ChatStore(":memory:");
  const session = store.createSession("whale", "工作集优先活动计划");
  const planMessage = store.add("user", "周五我会去看牙医。", null, "whale", session.id);
  const plan = store.saveFacts(planMessage.id, [{
    subject: "用户", predicate: "看牙医", value: "周五去看牙医", kind: "plan", evidence: "周五我会去看牙医", confidence: 0.95, importance: 0.8, supersedes: false,
  }]).facts[0]!;
  for (let index = 0; index < 14; index += 1) {
    const message = store.add("user", `我喜欢咖啡口味${index}。`, null, "whale", session.id);
    store.saveFacts(message.id, [{
      subject: "用户", predicate: `咖啡口味${index}`, value: "咖啡", kind: "preference", evidence: `我喜欢咖啡口味${index}`, confidence: 0.9, importance: 0.6, supersedes: false,
    }]);
  }
  try {
    const set = store.memoryDistillationWorkingSet("咖啡");
    assert.equal(set.facts.length, 12);
    assert.ok(set.facts.some((fact) => fact.id === plan.id), "活动计划必须在 12 条工作集内");
  } finally {
    store.close();
  }
});

test("a memory job moves to the dead letter after the retry cap and stops being claimed", (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const store = new ChatStore(":memory:");
  const session = store.createSession("whale", "重试上限");
  const user = store.add("user", "你好。", null, "whale", session.id);
  const assistant = store.add("assistant", "你好。", null, "whale", session.id);
  store.enqueueMemoryJob({ sessionId: session.id, character: "whale", userMessageId: user.id, assistantMessageId: assistant.id });
  try {
    context.mock.timers.tick(1_000); // 冻结的时钟要越过 SQLite 默认的入队时间
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const batch = store.claimMemoryJobBatch();
      assert.ok(batch, `第 ${attempt} 次仍应能领取`);
      assert.equal(batch.jobs[0]!.attempts, attempt);
      store.failMemoryJob(batch.jobs[0]!.id, batch.jobs[0]!.attempts, "模型输出无效");
      context.mock.timers.tick(2 * 3_600_000);
    }
    context.mock.timers.tick(365 * 24 * 3_600_000);
    assert.equal(store.claimMemoryJobBatch(), undefined);
    assert.deepEqual(
      { pending: store.memoryQueueStatus().pendingJobs, retrying: store.memoryQueueStatus().retryingJobs, dead: store.memoryQueueStatus().deadJobs },
      { pending: 0, retrying: 0, dead: 1 },
    );
  } finally {
    store.close();
  }
});

test("pausing a memory job for foreground chat does not spend a retry attempt", () => {
  const store = new ChatStore(":memory:");
  const session = store.createSession("whale", "暂停不计次");
  const user = store.add("user", "你好。", null, "whale", session.id);
  const assistant = store.add("assistant", "你好。", null, "whale", session.id);
  store.enqueueMemoryJob({ sessionId: session.id, character: "whale", userMessageId: user.id, assistantMessageId: assistant.id });
  try {
    for (let round = 0; round < 12; round += 1) {
      const batch = store.claimMemoryJobBatch();
      assert.ok(batch);
      assert.equal(batch.jobs[0]!.attempts, 1);
      store.pauseMemoryJob(batch.jobs[0]!.id);
    }
    assert.equal(store.memoryQueueStatus().deadJobs, 0);
  } finally {
    store.close();
  }
});

test("a terminal plan for one subject is not blocked by another subject's plan", async () => {
  const store = new ChatStore(":memory:");
  const session = store.createSession("whale", "不同主体的计划");
  const otherPlan = store.add("user", "妈妈周五要去看牙医。", null, "whale", session.id);
  store.saveFacts(otherPlan.id, [{
    subject: "妈妈", predicate: "看牙医", value: "周五去看牙医", kind: "plan", evidence: "妈妈周五要去看牙医", confidence: 0.95, importance: 0.8, supersedes: false,
  }]);
  const cancellation = store.add("user", "我取消了自己的安排。", null, "whale", session.id);
  const provider = scripted(() => JSON.stringify({
    facts: [{
      source_message_id: cancellation.id, subject: "用户", predicate: "日程安排", value: "已取消自己的安排", kind: "plan",
      evidence: "我取消了自己的安排", confidence: 0.95, importance: 0.8, plan_status: "cancelled",
    }],
    topics: [], core: "", core_source_message_ids: [], observation: "",
  }));

  try {
    const result = await distillMemoryBatch(provider, { messages: [cancellation], context: store.memoryDistillationWorkingSet(cancellation.content) });
    assert.equal(result.facts[0]?.planStatus, "cancelled");
    assert.equal(result.facts[0]?.supersedesFactIds, undefined);
  } finally {
    store.close();
  }
});

test("deleting a source session removes its derived topic and core immediately", () => {
  const store = new ChatStore(":memory:");
  const session = store.createSession("whale", "要删除的来源");
  const source = store.add("user", "我们聊过鲸鱼的声音。", null, "whale", session.id);
  store.publishMemoryDistillation({
    facts: [], topics: [{ key: "whale-sounds", title: "鲸鱼声音", summary: "共同讨论过鲸鱼声音。", sourceMessageIds: [source.id] }],
    core: "近期共同聊过鲸鱼声音。", coreSourceMessageIds: [source.id],
  }, [], false);
  try {
    assert.ok(store.memoryDistillation("鲸鱼声音").core);
    assert.equal(store.deleteSession(session.id, "whale")?.character, "whale");
    const prepared = store.memoryDistillation("鲸鱼声音");
    assert.equal(prepared.core, undefined);
    assert.equal(prepared.topics.length, 0);
  } finally {
    store.close();
  }
});

test("a batch without correction evidence keeps an older active fact", () => {
  const store = new ChatStore(":memory:");
  const session = store.createSession("whale", "保留有效事实");
  const source = store.add("user", "我喜欢咖啡。", null, "whale", session.id);
  store.saveFacts(source.id, [{
    subject: "用户", predicate: "喜好饮品", value: "咖啡", kind: "preference", evidence: "我喜欢咖啡", confidence: 0.9, importance: 0.7, supersedes: false,
  }]);
  try {
    store.publishMemoryDistillation({ facts: [], topics: [], coreSourceMessageIds: [] }, [], false);
    assert.equal(store.listFacts()[0]?.status, "active");
  } finally {
    store.close();
  }
});

test("manually deleting a fact also invalidates notes rooted in its messages", () => {
  const store = new ChatStore(":memory:");
  const session = store.createSession("whale", "删除事实");
  const source = store.add("user", "我喜欢咖啡。", null, "whale", session.id);
  const { facts } = store.saveFacts(source.id, [{
    subject: "用户", predicate: "喜好饮品", value: "咖啡", kind: "preference", evidence: "我喜欢咖啡", confidence: 0.9, importance: 0.7, supersedes: false,
  }]);
  store.publishMemoryDistillation({
    facts: [], topics: [{ key: "drink", title: "饮品偏好", summary: "用户喜欢咖啡。", sourceMessageIds: [source.id] }],
    core: "用户喜欢咖啡。", coreSourceMessageIds: [source.id],
  }, [], false);
  try {
    store.removeFact(facts[0].id);
    const prepared = store.memoryDistillation("饮品偏好");
    assert.equal(prepared.core, undefined);
    assert.equal(prepared.topics.length, 0);
  } finally {
    store.close();
  }
});
