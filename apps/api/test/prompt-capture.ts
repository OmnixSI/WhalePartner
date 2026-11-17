/**
 * 抓下各处「会显示给用户的 AI 输出」发给模型的提示词，给 prompt-language.test.ts 用。
 * 参数 root 是 apps/api 目录：测试传当前代码；核对与 0.3.6 是否逐字相同时，可以把它指向 0.3.6 的检出目录。
 * 只用 0.3.6 就有的入口，所以两边能跑同一份抓取代码。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type Message = { role: string; content: string };

// i18n-ignore-start：测试用的固定输入
const CHAT = [
  { role: "user" as const, content: "我这周在学游泳，有点怕水。", createdAt: "2026-06-15T09:00:00.000Z" },
  { role: "assistant" as const, content: "慢慢来，先在浅水区待着。", createdAt: "2026-06-15T09:01:00.000Z" },
];
const SUMMARY = "# 分享给你\n\n这条视频讲蓝鲸怎么唱歌。\n\n# 来源与依据\n\n- 标题：蓝鲸之歌";
// i18n-ignore-end

function recorder(reply: string) {
  const calls: Message[][] = [];
  const provider = {
    id: "capture",
    model: "capture",
    async *stream(messages: Message[]) {
      calls.push(messages.map(({ role, content }) => ({ role, content })));
      yield { text: reply };
    },
  };
  return { provider, calls };
}

const join2 = (messages: Message[]) => messages.map((message) => `[${message.role}]\n${message.content}`).join("\n\n");

/** 返回 名称 → 提示词全文。lang 由调用方用 runWithLang 包住。 */
export async function capturePrompts(root: string): Promise<Record<string, string>> {
  const load = (path: string) => import(pathToFileURL(join(root, "src", path)).href);
  const out: Record<string, string> = {};

  const { buildVideoSummaryPrompt } = await load("video/prompt.ts");
  out.videoSummary = buildVideoSummaryPrompt("字幕：大家好。", [{ time: 3, reason: "开头" }]); // i18n-ignore：测试输入

  const { reflect } = await load("chat/reflect.ts");
  let r = recorder("这周陪你学游泳，我也跟着紧张又开心。");
  await reflect(r.provider, { name: "鲸汐", previous: "上周很平静。", learned: ["蓝鲸会唱歌"], chat: ["她：你好", "用户：你好"] }); // i18n-ignore：测试输入
  out.reflect = join2(r.calls[0]);

  const { extractLearnings } = await load("chat/learning.ts");
  r = recorder("[]");
  await extractLearnings(r.provider, { title: "蓝鲸", text: "蓝鲸的歌声能传很远。" }); // i18n-ignore：测试输入
  out.learning = join2(r.calls[0]);

  const { readWeb } = await load("chat/materials.ts");
  const { ChatStore } = await load("store/index.ts");
  r = recorder("这个网页讲了蓝鲸。"); // i18n-ignore：测试输入
  const store = new ChatStore(":memory:");
  const session = store.createSession("whale");
  const page = { url: "https://example.com/whale", title: "Whales", text: "Blue whales sing." };
  const web = readWeb({ provider: r.provider, store }, "whale", { read: async () => page }, page.url, session.id, 1);
  for (let step = await web.next(); !step.done; step = await web.next()) { /* 读完 */ }
  out.webSummary = join2(r.calls[0]);

  const { distillMemoryBatch } = await load("memory/distill.ts");
  r = recorder("{}");
  await distillMemoryBatch(r.provider, {
    messages: CHAT.map((message, index) => ({ id: index + 1, role: message.role, content: message.content, emotion: null, character: "whale", sessionId: "s", createdAt: message.createdAt })),
    context: { coreSourceMessageIds: [], topics: [], facts: [] },
  });
  out.distill = join2(r.calls[0]);

  const { generateDiaryText } = await load("diary/service.ts");
  r = recorder("今天看了蓝鲸的视频，心里软软的。"); // i18n-ignore：测试输入
  await generateDiaryText(r.provider, { bvid: "BV1", title: "蓝鲸", url: "https://www.bilibili.com/video/BV1", summary: SUMMARY });
  out.videoDiary = join2(r.calls[0]);
  out.videoDiaryCalls = String(r.calls.length);

  // 每日手帐：提示词里带当天日期，只用来比中英两种模式，不做固定指纹
  const { DailyJournalService } = await load("diary/journal.ts");
  const { JournalStore } = await load("diary/journal-store.ts");
  const directory = mkdtempSync(join(tmpdir(), "whale-prompts-"));
  const archive = new ChatStore(join(directory, "chat.db"));
  const chat = archive.createSession("whale", "chat");
  archive.add("user", CHAT[0].content, null, "whale", chat.id);
  archive.add("assistant", CHAT[1].content, null, "whale", chat.id);
  r = recorder("今天陪你聊了学游泳的事。"); // i18n-ignore：测试输入
  const today = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  await new DailyJournalService({ store: new JournalStore(join(directory, "chat.db")), archive, provider: r.provider }).generate("whale", today);
  out.journal = r.calls[0] ? join2(r.calls[0]) : "";
  archive.close?.();
  rmSync(directory, { recursive: true, force: true });

  // 主动陪伴：固定时间，照 proactive.test.ts 的做法排一个计划
  const { ProactiveService } = await load("proactive/service.ts");
  const { PresenceRegistry } = await load("proactive/presence.ts");
  const { ChatSessionRequests } = await load("routes/chat-session-requests.ts");
  const { EventBus } = await load("hub/events.ts");
  const { loadConfig } = await load("server/config.ts");
  const fixedNow = new Date("2026-06-18T12:00:00.000Z");
  const proactiveStore = new ChatStore(":memory:");
  proactiveStore.putCompanionSettings({ enabled: true, frequency: "rare", quiet: { start: "00:00", end: "00:00" } });
  const planSession = proactiveStore.createSession("whale");
  const text = "周五我会去看牙医。"; // i18n-ignore：测试输入
  const user = proactiveStore.add("user", text, null, "whale", planSession.id);
  const fact = proactiveStore.saveFacts(user.id, [{ subject: "用户", predicate: "计划", value: text, kind: "plan", evidence: text, confidence: 0.95, importance: 0.8, supersedes: false }]).facts[0]; // i18n-ignore：测试输入
  const triggerId = proactiveStore.enqueueProactiveTrigger({ sourceMessageId: user.id, factId: fact.id, sessionId: planSession.id, planText: `计划：${text}`, evidence: text }, new Date(fixedNow.getTime() - 21 * 60_000)); // i18n-ignore：测试输入
  r = recorder("最近还紧张吗？"); // i18n-ignore：测试输入
  await new ProactiveService({
    store: proactiveStore, provider: r.provider, config: loadConfig({}), presence: new PresenceRegistry(), requests: new ChatSessionRequests(),
    events: new EventBus(), lastChatActivity: () => 0, now: () => fixedNow,
  }).processDue(triggerId);
  out.proactive = r.calls[0] ? join2(r.calls[0]) : "";

  return out;
}
