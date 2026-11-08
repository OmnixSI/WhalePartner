import assert from "node:assert/strict";
import { test } from "node:test";
import { EventBus } from "../src/events.ts";
import type { ChatMessage, ChatProvider } from "../src/llm/types.ts";
import { PresenceRegistry } from "../src/proactive/presence.ts";
import { ProactiveService } from "../src/proactive/service.ts";
import { ChatSessionRequests } from "../src/routes/chat-session-requests.ts";
import { loadConfig } from "../src/config.ts";
import { ChatStore } from "../src/store.ts";

const fixedNow = new Date("2026-06-18T12:00:00.000Z");

function provider(reply: string, seen?: ChatMessage[][]): ChatProvider {
  return {
    id: "fixture",
    model: "fixture-model",
    async *stream(messages) {
      seen?.push(messages);
      yield { text: reply };
    },
  };
}

function setupTrigger(store: ChatStore, now = fixedNow, text = "周五我会去看牙医。") {
  const session = store.createSession("whale");
  const user = store.add("user", text, null, "whale", session.id);
  store.add("assistant", "记下啦。", null, "whale", session.id);
  const fact = store.saveFacts(user.id, [{
    subject: "用户",
    predicate: "计划",
    value: text,
    kind: "plan",
    evidence: text,
    confidence: 0.95,
    importance: 0.8,
    supersedes: false,
  }]).facts[0];
  assert.ok(fact);
  const triggerId = store.enqueueProactiveTrigger({
    sourceMessageId: user.id,
    factId: fact.id,
    sessionId: session.id,
    planText: `用户计划：${text}`,
    evidence: text,
  }, new Date(now.getTime() - 21 * 60_000));
  assert.ok(triggerId);
  return { triggerId, sessionId: session.id, sourceMessageId: user.id, factId: fact.id };
}

function service(store: ChatStore, options: { now?: () => Date; firstTokenTimeoutMs?: number; presence?: PresenceRegistry; requests?: ChatSessionRequests; events?: EventBus; lastChatActivity?: () => number; model?: ChatProvider } = {}) {
  return new ProactiveService({
    store,
    provider: options.model ?? provider("记得你说周五要去看牙医，最近还紧张吗？"),
    config: loadConfig({}),
    presence: options.presence ?? new PresenceRegistry(),
    requests: options.requests ?? new ChatSessionRequests(),
    events: options.events ?? new EventBus(),
    lastChatActivity: options.lastChatActivity ?? (() => 0),
    firstTokenTimeoutMs: options.firstTokenTimeoutMs,
    now: options.now ?? (() => fixedNow),
  });
}

function enable(store: ChatStore, frequency: "rare" | "normal" = "rare") {
  store.putCompanionSettings({ enabled: true, frequency, quiet: { start: "00:00", end: "00:00" } });
}

test("a grounded plan produces one persisted DeepSeek follow-up and live events", async () => {
  const store = new ChatStore(":memory:");
  enable(store);
  const { triggerId, sessionId } = setupTrigger(store);
  const events = new EventBus();
  const received: Array<{ type: string; payload: unknown }> = [];
  events.subscribe((event) => received.push({ type: event.type, payload: event.payload }));
  const seen: ChatMessage[][] = [];
  const worker = service(store, { events, model: provider("[emotion:happy]记得你说周五要去看牙医，最近还紧张吗？", seen) });

  await worker.processDue(triggerId);

  const history = store.recent(10, "deepseek", sessionId);
  const sent = history.at(-1)!;
  assert.equal(sent.role, "assistant");
  assert.equal(sent.character, "deepseek");
  assert.equal(sent.attachment && (sent.attachment as { type?: string }).type, "proactive");
  assert.equal(store.proactiveTrigger(triggerId)?.status, "sent");
  assert.ok(seen[0][0].content.includes("大肥鱼"));
  assert.ok(seen[0].some((message) => message.content.includes("周五我会去看牙医")));
  assert.ok(received.some((event) => event.type === "message.created" && (event.payload as { message?: { attachment?: { type?: string } } }).message?.attachment?.type === "proactive"));
  assert.ok(received.some((event) => event.type === "message.done"));
  assert.deepEqual(await store.messagesAround(sessionId, sent.id, 1)?.map((message) => message.id), [sent.id - 1, sent.id]);
  worker.stop();
  store.close();
});

test("disabled setting and quiet hours do not call the model", async () => {
  const offStore = new ChatStore(":memory:");
  enable(offStore);
  const off = setupTrigger(offStore);
  offStore.putCompanionSettings({ enabled: false });
  let calls = 0;
  const offWorker = service(offStore, { model: { ...provider("不能发"), async *stream() { calls++; yield { text: "不能发" }; } } });
  await offWorker.processDue(off.triggerId);
  assert.equal(offStore.proactiveTrigger(off.triggerId)?.status, "suppressed");
  assert.equal(calls, 0);

  const quietStore = new ChatStore(":memory:");
  enable(quietStore);
  quietStore.putCompanionSettings({ quiet: { start: "11:00", end: "13:00" } });
  const quietNow = new Date(2026, 5, 18, 12, 0, 0);
  const quiet = setupTrigger(quietStore, quietNow);
  const quietWorker = service(quietStore, { now: () => quietNow, model: { ...provider("不能发"), async *stream() { calls++; yield { text: "不能发" }; } } });
  await quietWorker.processDue(quiet.triggerId, quietNow);
  assert.equal(quietStore.proactiveTrigger(quiet.triggerId)?.status, "pending");
  assert.equal(Date.parse(quietStore.proactiveTrigger(quiet.triggerId)!.dueAt), new Date(2026, 5, 18, 13, 0, 0).getTime());
  assert.equal(calls, 0);
  offWorker.stop();
  quietWorker.stop();
  offStore.close();
  quietStore.close();
});

test("deleting or superseding a plan cancels its pending follow-up", async () => {
  const deletedStore = new ChatStore(":memory:");
  enable(deletedStore);
  const deleted = setupTrigger(deletedStore);
  deletedStore.removeFact(deleted.factId);
  assert.equal(deletedStore.proactiveTrigger(deleted.triggerId), undefined);

  const changedStore = new ChatStore(":memory:");
  enable(changedStore);
  const changed = setupTrigger(changedStore);
  const correction = "我改主意了，不去看牙医了。";
  const correctionMessage = changedStore.add("user", correction, null, "whale", changed.sessionId);
  changedStore.saveFacts(correctionMessage.id, [{
    subject: "用户",
    predicate: "计划",
    value: "取消看牙医",
    kind: "plan",
    evidence: "不去看牙医",
    confidence: 0.95,
    importance: 0.8,
    supersedes: true,
  }]);
  let calls = 0;
  const worker = service(changedStore, { model: { ...provider("不应生成"), async *stream() { calls++; yield { text: "不应生成" }; } } });

  await worker.processDue(changed.triggerId);

  assert.equal(changedStore.proactiveTrigger(changed.triggerId)?.status, "suppressed");
  assert.equal(calls, 0);
  worker.stop();
  deletedStore.close();
  changedStore.close();
});

test("cooldown, active chat, voice playback and persona switching suppress a send", async () => {
  const capped = new ChatStore(":memory:");
  enable(capped, "normal");
  const first = setupTrigger(capped);
  capped.claimProactiveTrigger(first.triggerId, fixedNow);
  capped.deliverProactiveMessage(first.triggerId, "第一条主动消息。", "neutral", fixedNow);
  const next = setupTrigger(capped, new Date(fixedNow.getTime() + 60 * 60_000), "下周我会去复查牙齿。");
  let calls = 0;
  const cappedWorker = service(capped, { now: () => new Date(fixedNow.getTime() + 60 * 60_000), model: { ...provider("不会生成"), async *stream() { calls++; yield { text: "不会生成" }; } } });
  await cappedWorker.processDue(next.triggerId, new Date(fixedNow.getTime() + 60 * 60_000));
  assert.equal(capped.proactiveTrigger(next.triggerId)?.status, "pending");
  assert.equal(Date.parse(capped.proactiveTrigger(next.triggerId)!.dueAt), fixedNow.getTime() + 6 * 60 * 60_000);
  assert.equal(calls, 0);

  const busyStore = new ChatStore(":memory:");
  enable(busyStore);
  const busy = setupTrigger(busyStore);
  const requests = new ChatSessionRequests();
  const release = requests.begin(busy.sessionId, new AbortController())!;
  const busyWorker = service(busyStore, { requests, model: { ...provider("不会生成"), async *stream() { calls++; yield { text: "不会生成" }; } } });
  await busyWorker.processDue(busy.triggerId);
  assert.equal(busyStore.proactiveTrigger(busy.triggerId)?.status, "pending");
  release();

  const voiceStore = new ChatStore(":memory:");
  enable(voiceStore);
  const voice = setupTrigger(voiceStore);
  const presence = new PresenceRegistry();
  presence.update({ clientId: "device-voice-123", character: "deepseek", visible: true, active: false, busy: false, voicePlaying: true }, fixedNow.getTime());
  const voiceWorker = service(voiceStore, { presence, model: { ...provider("不会生成"), async *stream() { calls++; yield { text: "不会生成" }; } } });
  await voiceWorker.processDue(voice.triggerId);
  assert.equal(voiceStore.proactiveTrigger(voice.triggerId)?.status, "pending");

  const roleStore = new ChatStore(":memory:");
  enable(roleStore);
  const role = setupTrigger(roleStore);
  const rolePresence = new PresenceRegistry();
  rolePresence.update({ clientId: "device-role-123", character: "claude", visible: true, active: false, busy: false, voicePlaying: false }, fixedNow.getTime());
  const roleWorker = service(roleStore, { presence: rolePresence, model: { ...provider("不会生成"), async *stream() { calls++; yield { text: "不会生成" }; } } });
  await roleWorker.processDue(role.triggerId);
  assert.equal(roleStore.proactiveTrigger(role.triggerId)?.status, "suppressed");
  assert.equal(calls, 0);
  cappedWorker.stop();
  busyWorker.stop();
  voiceWorker.stop();
  roleWorker.stop();
  capped.close();
  busyStore.close();
  voiceStore.close();
  roleStore.close();
});

test("normal frequency permits two sends per local day and suppresses the third", async () => {
  const store = new ChatStore(":memory:");
  enable(store, "normal");
  const morning = new Date(2026, 5, 18, 8, 0, 0);
  const first = setupTrigger(store, morning);
  store.claimProactiveTrigger(first.triggerId, morning);
  assert.equal(store.deliverProactiveMessage(first.triggerId, "第一条。", "neutral", morning)?.kind, "sent");
  const afternoon = new Date(morning.getTime() + 6 * 60 * 60_000);
  const second = setupTrigger(store, afternoon, "下周我会去复查牙齿。");
  store.claimProactiveTrigger(second.triggerId, afternoon);
  assert.equal(store.deliverProactiveMessage(second.triggerId, "第二条。", "neutral", afternoon)?.kind, "sent");
  const next = new Date(morning.getTime() + 7 * 60 * 60_000);
  const third = setupTrigger(store, next, "周末我打算去看外婆。");
  let calls = 0;
  const worker = service(store, { now: () => next, model: { ...provider("不应生成"), async *stream() { calls++; yield { text: "不应生成" }; } } });

  await worker.processDue(third.triggerId, next);

  assert.equal(store.proactiveTrigger(third.triggerId)?.status, "suppressed");
  assert.equal(calls, 0);
  worker.stop();
  store.close();
});

test("a model first-token timeout retries once, then records failure", async () => {
  const store = new ChatStore(":memory:");
  enable(store);
  const { triggerId } = setupTrigger(store);
  let now = fixedNow;
  const hanging: ChatProvider = {
    id: "hang",
    model: "fixture-hang",
    async *stream(_messages, options) {
      await new Promise<never>((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
      });
      yield { text: "" };
    },
  };
  const worker = service(store, { model: hanging, now: () => now, firstTokenTimeoutMs: 1 });

  await worker.processDue(triggerId);
  const retry = store.proactiveTrigger(triggerId)!;
  assert.equal(retry.status, "pending");
  assert.equal(retry.attempts, 1);
  assert.equal(Date.parse(retry.dueAt), fixedNow.getTime() + 10 * 60_000);

  now = new Date(retry.dueAt);
  await worker.processDue(triggerId, now);
  const failed = store.proactiveTrigger(triggerId)!;
  assert.equal(failed.status, "failed");
  assert.equal(failed.attempts, 2);
  worker.stop();
  store.close();
});

test("a timer delayed by sleep past its grace period expires without catch-up", async () => {
  const store = new ChatStore(":memory:");
  enable(store);
  const { triggerId } = setupTrigger(store);
  const wokeAt = new Date(fixedNow.getTime() + 5 * 60_000);
  let calls = 0;
  const worker = service(store, { now: () => wokeAt, model: { ...provider("不应补发"), async *stream() { calls++; yield { text: "不应补发" }; } } });

  await worker.processDue(triggerId, wokeAt);

  assert.equal(store.proactiveTrigger(triggerId)?.status, "expired");
  assert.equal(calls, 0);
  worker.stop();
  store.close();
});
