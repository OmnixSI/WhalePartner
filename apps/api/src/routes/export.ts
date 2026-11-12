import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { pauseBackgroundJobs, resetReflectionSchedule } from "../chat/background.ts";
import { clearMem0History } from "../memory/history.ts";
import { waitForMemoryJobs } from "../memory/jobs.ts";
import { readJsonBody, RequestBodyError, sendJson } from "../server/http.ts";
import { createZip, type ZipEntry } from "../server/zip.ts";
import type { ServerDeps } from "../server/types.ts";
import type { UserDataTable } from "../store/maintenance.ts";
import type { ChatSessionRequests } from "./chat-session-requests.ts";

/**
 * 导出与「删除全部」（规范 §10.5 B2）。
 *
 * POST /api/export          生成一份 zip，返回 { id }
 * GET  /api/export?id=…     下载（application/zip），10 分钟内有效
 * DELETE /api/data          清空全部（必须 { confirm: "DELETE_ALL" }）
 *
 * 导出/删除进行中时，聊天请求会被拒绝（409），避免导出一半又被写入。
 */
const EXPORT_TTL_MS = 10 * 60_000;
/** 向量库一次最多列出 500 条，删除全部时按轮清，直到清空。 */
const MAX_MEMORY_ROUNDS = 100;

interface ExportBundle {
  at: number;
  zip: Buffer;
  name: string;
}

const bundles = new Map<string, ExportBundle>();
let busy = false;

/** 聊天链路用：正在导出/删除时返回 true。 */
export function dataMaintenanceBusy(): boolean {
  return busy;
}

function json(data: unknown): Buffer {
  return Buffer.from(JSON.stringify(data, null, 2), "utf8");
}

/** 整包导出：不截断，删除全部之前导出的这份就是完整副本。 */
function collect(deps: ServerDeps): ZipEntry[] {
  const { store } = deps;
  const sessions = store.listSessions("whale", -1);
  const messages = sessions.flatMap((session) => store.recent(-1, undefined, session.id).map((message) => ({ ...message, sessionId: session.id })));
  const table = (name: UserDataTable) => json(store.dumpTable(name));
  return [
    { name: "manifest.json", data: json({ app: "whalepartner", exportedAt: new Date().toISOString(), format: 2 }) },
    {
      name: "README.txt",
      data: Buffer.from("这是 WhalePartner 导出的数据：聊天记录、记忆（含她的近况小记和聊天观察）、日记、见闻、好感度、昵称与用量。用任何支持 zip 的工具打开即可。\n", "utf8"),
    },
    { name: "chat/sessions.json", data: json(sessions) },
    { name: "chat/messages.json", data: json(messages) },
    { name: "memories/facts.json", data: json(store.listFacts(-1)) },
    { name: "memories/experiences.json", data: json(store.listExperiences(-1, true)) },
    { name: "memories/note.json", data: table("character_notes") },
    { name: "memories/note-history.json", data: table("character_note_history") },
    { name: "memories/session-observations.json", data: table("session_observations") },
    { name: "diary/journals.json", data: table("daily_journals") },
    { name: "diary/journal-revisions.json", data: table("daily_journal_revisions") },
    { name: "diary/video-diary.json", data: table("diary_items") },
    { name: "surf/items.json", data: table("surf_items") },
    { name: "relationship.json", data: table("relationship_state") },
    { name: "profile.json", data: table("user_profile") },
    { name: "usage.json", data: table("usage_ledger") },
  ];
}

/** 删掉全部向量和 mem0 的变更历史；有任何一步没成功就返回 false。 */
async function clearAllMemories(deps: ServerDeps): Promise<boolean> {
  let cleared = true;
  if (deps.memory) {
    try {
      for (let round = 0; round < MAX_MEMORY_ROUNDS; round += 1) {
        const entries = await deps.memory.list();
        if (entries.length === 0) break;
        let removed = 0;
        for (const entry of entries) {
          try {
            await deps.memory.remove(entry.id);
            removed += 1;
          } catch (error) {
            cleared = false;
            console.warn("向量记忆清理失败：", error instanceof Error ? error.message : error);
          }
        }
        if (removed === 0) break;
      }
    } catch (error) {
      cleared = false;
      console.warn("未能读取向量记忆：", error instanceof Error ? error.message : error);
    }
  }
  if (!clearMem0History(join(deps.config.memoryDir, "history.db"))) cleared = false;
  return cleared;
}

/**
 * 「删除我的全部数据」：和清空聊天记录同一套锁顺序——先停后台任务、拦住聊天请求和日记写入、
 * 等记忆任务收尾，再清数据，免得进行中的任务把刚删掉的内容写回来。设置、配对设备和 .env 保留。
 */
async function deleteAllData(deps: ServerDeps, sessionRequests: ChatSessionRequests) {
  const unlockBackground = await pauseBackgroundJobs();
  let unlockRequests = () => {};
  let unlockJournals = () => {};
  try {
    const unlock = await sessionRequests.lockForHistoryClear();
    if (!unlock) return undefined;
    unlockRequests = unlock;
    if (deps.journal) unlockJournals = await deps.journal.lockForSessionDeletion();
    await waitForMemoryJobs(deps.store);
    deps.store.clearAll();
    resetReflectionSchedule();
    const memoriesCleared = await clearAllMemories(deps);
    await rm(join(deps.config.surfDir, "thumbs"), { recursive: true, force: true });
    try {
      await deps.accounts?.logout("bilibili");
    } catch (error) {
      console.warn("B 站登出失败：", error instanceof Error ? error.message : error);
    }
    return { memoriesCleared };
  } finally {
    unlockJournals();
    unlockRequests();
    unlockBackground();
  }
}

export async function handleExportRoute(
  deps: ServerDeps,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  sessionRequests: ChatSessionRequests,
): Promise<boolean> {
  if (url.pathname === "/api/export" && request.method === "POST") {
    if (busy) return sendJson(response, 409, { error: "busy", message: "正在导出或删除，稍等一下。" }), true;
    busy = true;
    try {
      const zip = createZip(collect(deps));
      const id = randomUUID();
      bundles.set(id, { at: Date.now(), zip, name: `whalepartner-${new Date().toISOString().slice(0, 10)}.zip` });
      for (const [key, value] of bundles) if (Date.now() - value.at > EXPORT_TTL_MS) bundles.delete(key);
      sendJson(response, 201, { id });
    } catch {
      sendJson(response, 503, { error: "export_failed", message: "这次没打包成功，再试一次。" });
    } finally {
      busy = false;
    }
    return true;
  }

  if (url.pathname === "/api/export" && request.method === "GET") {
    const id = url.searchParams.get("id") ?? "";
    const bundle = bundles.get(id);
    if (!bundle || Date.now() - bundle.at > EXPORT_TTL_MS) {
      bundles.delete(id);
      sendJson(response, 404, { error: "export_not_found", message: "这份打包已经过期，再导一次。" });
      return true;
    }
    response.statusCode = 200;
    response.setHeader("content-type", "application/zip");
    response.setHeader("content-disposition", `attachment; filename="${bundle.name}"`);
    response.setHeader("cache-control", "no-store");
    response.end(bundle.zip);
    return true;
  }

  if (url.pathname === "/api/data" && request.method === "DELETE") {
    if (busy) return sendJson(response, 409, { error: "busy", message: "正在导出或删除，稍等一下。" }), true;
    busy = true;
    try {
      const body = await readJsonBody(request);
      if (body?.confirm !== "DELETE_ALL") {
        sendJson(response, 400, { error: "confirm_required", message: "要删除全部，必须明确确认。" });
        return true;
      }
      const result = await deleteAllData(deps, sessionRequests);
      if (!result) {
        sendJson(response, 409, { error: "busy", message: "聊天记录正在变更，稍等一下再删。" });
        return true;
      }
      bundles.clear();
      sendJson(response, 200, { ok: true, memoriesCleared: result.memoriesCleared });
    } catch (error) {
      if (error instanceof RequestBodyError) sendJson(response, error.status, { error: error.code, message: error.message });
      else sendJson(response, 503, { error: "delete_failed", message: "这次没删成功，再试一次。" });
    } finally {
      busy = false;
    }
    return true;
  }

  return false;
}
