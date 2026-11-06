import os from "node:os";
import { performance } from "node:perf_hooks";
import { buildChatContext, estimateTokens } from "../src/memory/context.ts";
import { decayForPrompt } from "../src/memory/decay.ts";
import { recallChatMemory } from "../src/memory/recall.ts";
import { ChatStore } from "../src/store.ts";
import { openChatDatabase } from "../src/store/database.ts";
import { ExperienceRepository } from "../src/store/experiences.ts";

const samples = Number(process.env.WP_PROFILE_SAMPLES ?? 500);
const warmup = Math.min(50, samples);
const now = new Date().toISOString();
const vectorEntries = Array.from({ length: 500 }, (_, index) => ({
  id: `synthetic-${index}`,
  kind: "experience",
  source: "learned",
  sourceId: `learned:video:synthetic:${index}`,
  createdAt: now,
  text: `合成学习记录 ${index}：用于模拟旧链路返回并按时间排序的 500 条本地记忆。`,
}));
let listCalls = 0;
let listedRows = 0;

const memory = {
  async search() { return []; },
  async recall() { return []; },
  async recentExperiences() { return []; },
  async recentLearnings(limit = 4) {
    listCalls += 1;
    listedRows += vectorEntries.length;
    return [...vectorEntries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  },
};

const store = new ChatStore(":memory:");
const session = store.createSession("whale", "合成基准会话");
const query = "我有点想聊聊天。";
const legacyElapsed = [];
const optimizedElapsed = [];
const firstMode = process.env.WP_PROFILE_FIRST === "optimized" ? "optimized" : "baseline";
let firstRequestMs = 0;
let legacyTokenEstimate = 0;
let optimizedTokenEstimate = 0;

function makePrompt(recall, learned) {
  const messages = buildChatContext({
    persona: "# 角色设定：大肥鱼\n自然聊天，记住共同经历。",
    memories: recall.facts,
    experiences: recall.experiences,
    learned,
    note: undefined,
    archive: recall.archive,
    history: [...recall.history, { role: "user", content: query }],
    inputBudget: 12_000,
  });
  return messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
}

async function runLegacyPath() {
  const started = performance.now();
  const [recall, recentLearned] = await Promise.all([
    recallChatMemory({ store, memory, character: "whale", sessionId: session.id, query }),
    memory.recentLearnings(4, "whale"),
  ]);
  const learned = decayForPrompt(recentLearned);
  const tokens = makePrompt(recall, learned);
  return { elapsed: performance.now() - started, tokens, learned: learned.length };
}

async function runOptimizedPath() {
  const started = performance.now();
  const recall = await recallChatMemory({ store, memory, character: "whale", sessionId: session.id, query });
  const tokens = makePrompt(recall, recall.learned);
  return { elapsed: performance.now() - started, tokens, learned: recall.learned.length };
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p) => Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)].toFixed(3));
  return {
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    meanMs: Number((sorted.reduce((sum, value) => sum + value, 0) / sorted.length).toFixed(3)),
  };
}

try {
  let firstLegacy;
  let firstOptimized;
  if (firstMode === "baseline") {
    firstLegacy = await runLegacyPath();
    firstRequestMs = Number(firstLegacy.elapsed.toFixed(3));
    firstOptimized = await runOptimizedPath();
  } else {
    firstOptimized = await runOptimizedPath();
    firstRequestMs = Number(firstOptimized.elapsed.toFixed(3));
    firstLegacy = await runLegacyPath();
  }
  legacyTokenEstimate = firstLegacy.tokens;
  optimizedTokenEstimate = firstOptimized.tokens;

  for (let index = 0; index < warmup; index += 1) {
    if (index % 2 === 0) {
      await runLegacyPath();
      await runOptimizedPath();
    } else {
      await runOptimizedPath();
      await runLegacyPath();
    }
  }
  for (let index = 0; index < samples; index += 1) {
    const legacyFirst = index % 2 === 0;
    let legacy;
    let optimized;
    if (legacyFirst) {
      legacy = await runLegacyPath();
      optimized = await runOptimizedPath();
    } else {
      optimized = await runOptimizedPath();
      legacy = await runLegacyPath();
    }
    legacyElapsed.push(legacy.elapsed);
    optimizedElapsed.push(optimized.elapsed);
    legacyTokenEstimate = legacy.tokens;
    optimizedTokenEstimate = optimized.tokens;
  }

  const legacyStats = stats(legacyElapsed);
  const optimizedStats = stats(optimizedElapsed);
  const profileDb = openChatDatabase(":memory:");
  let sqlProfile;
  try {
    const insert = profileDb.prepare(`
      INSERT INTO memory_experiences(kind, title, text, source_id, created_at, updated_at)
      VALUES ('learned', '合成知识', '合成学习记录，用于检查索引上的最新记录读取。', ?, ?, ?)
    `);
    profileDb.exec("BEGIN");
    for (let index = 0; index < 10_000; index += 1) insert.run(`learned:video:profile:${index}`, now, now);
    profileDb.exec("COMMIT");
    const repository = new ExperienceRepository(profileDb);
    const scopeSql = `(
      (e.source_session_id IS NULL AND NOT EXISTS (SELECT 1 FROM memory_experience_sessions es WHERE es.experience_id = e.id)
        AND e.kind <> 'chat' AND e.source_id NOT LIKE 'learned:chat:%'
        AND (e.kind <> 'journal' OR e.source_id LIKE ?))
      OR s.character = ?
      OR EXISTS (SELECT 1 FROM memory_experience_sessions es JOIN chat_sessions cs ON cs.id = es.session_id WHERE es.experience_id = e.id AND cs.character = ?)
      OR (e.source_id LIKE 'learned:chat:%' AND e.source_id LIKE ?)
    )`;
    const queryPlan = profileDb.prepare(`
      EXPLAIN QUERY PLAN SELECT e.id FROM memory_experiences e
      LEFT JOIN chat_sessions s ON s.id = e.source_session_id
      WHERE e.kind = 'learned' AND ${scopeSql}
      ORDER BY e.created_at DESC, e.id DESC LIMIT 4
    `).all("journal:whale:%", "whale", "whale", "learned:chat:whale:%").map((row) => row.detail);
    const sqlFirstStarted = performance.now();
    const firstRows = repository.recentLearnings(4, "whale");
    const sqlFirstMs = Number((performance.now() - sqlFirstStarted).toFixed(3));
    const sqlSamples = [];
    for (let index = 0; index < warmup + samples; index += 1) {
      const started = performance.now();
      const rows = repository.recentLearnings(4, "whale");
      const duration = performance.now() - started;
      if (index >= warmup) sqlSamples.push(duration);
      if (rows.length !== 4) throw new Error(`Expected four indexed learned rows, received ${rows.length}.`);
    }
    sqlProfile = {
      syntheticArchiveRows: 10_000,
      returnedRows: firstRows.length,
      firstRequestMs: sqlFirstMs,
      warmRequestMs: stats(sqlSamples),
      queryPlan,
    };
  } finally {
    profileDb.close();
  }
  process.stdout.write(`${JSON.stringify({
    workload: "synthetic, in-memory SQLite, ordinary chat; no vector database or provider calls",
    baseline: "old per-turn recentLearnings list and JavaScript sort; benchmark models its 500-row cap but excludes Mem0 storage I/O",
    recordsReturnedByLegacyList: vectorEntries.length,
    warmup,
    samples,
    runtime: { node: process.version, platform: process.platform, arch: process.arch, osRelease: os.release() },
    firstRequest: { path: firstMode, localRecallAndContextMs: firstRequestMs },
    warmLocalRecallAndContextMs: { baseline: legacyStats, optimized: optimizedStats },
    baselineOnly: { recentLearningListCalls: listCalls, rowsSorted: listedRows },
    localPromptTokenEstimate: { baseline: legacyTokenEstimate, optimized: optimizedTokenEstimate },
    learnedLines: { baseline: 4, optimized: 0 },
    indexedRecentLearnings: sqlProfile,
  }, null, 2)}\n`);
} finally {
  store.close();
}
