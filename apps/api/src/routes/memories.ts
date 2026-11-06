import type { IncomingMessage, ServerResponse } from "node:http";
import { ChatInputError } from "../chat.ts";
import { readJsonBody, sendJson } from "../http.ts";
import { archiveExperience } from "../memory/archive.ts";
import type { MemoryStore } from "../memory/types.ts";
import type { ServerDeps } from "../server-types.ts";
import { text } from "./input.ts";
import { isCharacterId } from "../persona/persona.ts";
import type { MemoryCategory, MemoryExplorerFilters, MemoryStatusFilter } from "../store/explorer.ts";

export async function handleMemoriesRoute(
  deps: Pick<ServerDeps, "store" | "memory">,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
) {
  const memory = deps.memory;
  try {
    if (request.method === "GET" && url.pathname === "/api/memories") {
      return await listMemories(deps.store, memory, response);
    }
    if (request.method === "GET" && url.pathname === "/api/memories/explorer") {
      const character = url.searchParams.get("character") ?? "whale";
      if (!isCharacterId(character)) throw new ChatInputError("未知的角色。");
      const category = url.searchParams.get("category") ?? "all";
      const status = url.searchParams.get("status") ?? "all";
      const role = url.searchParams.get("role") ?? "all";
      if (!isMemoryCategory(category) || !isMemoryStatus(status) || !isMemoryRole(role)) throw new ChatInputError("记忆筛选条件无效。");
      const from = dateBoundary(url.searchParams.get("from"), false);
      const to = dateBoundary(url.searchParams.get("to"), true);
      if (from && to && from >= to) throw new ChatInputError("结束日期需要晚于开始日期。");
      const filters: MemoryExplorerFilters = {
        character,
        query: text(url.searchParams.get("q") ?? undefined, 120, "q", false),
        category,
        status,
        role,
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        page: Math.max(1, Number(url.searchParams.get("page")) || 1),
        pageSize: Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 30)),
      };
      return sendJson(response, 200, deps.store.listMemoryExplorer(filters));
    }
    if (request.method === "DELETE" && url.pathname.startsWith("/api/memories/") && url.pathname !== "/api/memories/experience") {
      return await deleteMemory(deps.store, memory, url.pathname, response);
    }
    if (request.method === "POST" && url.pathname === "/api/memories/experience") {
      const body = await readJsonBody(request);
      const link = text(body.url, 500, "url", false);
      if (link && !/^https?:\/\//.test(link)) throw new ChatInputError("url 必须以 http:// 或 https:// 开头。");
      const input = {
        kind: text(body.kind, 32, "kind")!,
        title: text(body.title, 120, "title")!,
        text: text(body.text, 4000, "text")!,
        url: link,
        sourceId: text(body.sourceId, 64, "sourceId", false),
      };
      const entry = await archiveExperience(deps.store, memory, input, "经历");
      return sendJson(response, 200, { entry });
    }
    return sendJson(response, 404, { error: "未找到。" });
  } catch (error) {
    const status = error instanceof ChatInputError || error instanceof SyntaxError ? 400 : 500;
    return sendJson(response, status, { error: error instanceof SyntaxError ? "请求体不是有效的 JSON。" : error instanceof Error ? error.message : "记忆请求失败。" });
  }
}

function isMemoryCategory(value: string): value is MemoryCategory {
  return ["all", "fact", "conversation", "video", "web", "diary", "learned", "reflection"].includes(value);
}

function isMemoryStatus(value: string): value is MemoryStatusFilter {
  return ["all", "current", "historical"].includes(value);
}

function isMemoryRole(value: string): value is NonNullable<MemoryExplorerFilters["role"]> {
  return ["all", "user", "assistant"].includes(value);
}

function dateBoundary(value: string | null, afterDay: boolean): string | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) throw new ChatInputError("日期格式无效。");
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) throw new ChatInputError("日期无效。");
  if (afterDay) date.setDate(date.getDate() + 1);
  return date.toISOString();
}

async function listMemories(store: ServerDeps["store"], memory: MemoryStore | undefined, response: ServerResponse) {
  let entries: Awaited<ReturnType<MemoryStore["list"]>> = [];
  let vectorError: string | undefined;
  if (memory) {
    try {
      entries = await memory.list();
    } catch (error) {
      vectorError = error instanceof Error ? error.message : String(error);
    }
  } else {
    vectorError = "语义记忆索引未启用。";
  }
  const archivedExperiences = store.listExperiences(500, false);
  const storedFacts = store.listFacts();
  const facts = storedFacts.map((fact) => ({
    id: `local:${fact.id}`,
    kind: "fact" as const,
    text: `${fact.subject}的${fact.predicate}：${fact.value}`,
    createdAt: fact.createdAt,
    source: "chat",
    sourceId: fact.sources.map((source) => `message:${source.messageId}`).join(","),
    validFrom: fact.validFrom,
    validTo: fact.validTo,
    status: fact.status,
    confidence: fact.confidence,
    importance: fact.importance,
    sources: fact.sources,
  }));
  const structuredValues = storedFacts.map((fact) => fact.value).filter((value) => value.length > 2);
  const experiences = archivedExperiences.map((experience) => ({
    id: `local-exp:${experience.id}`,
    kind: "experience" as const,
    text: experience.text,
    createdAt: experience.createdAt,
    source: experience.kind,
    title: experience.title,
    url: experience.url,
    sourceId: experience.sourceId,
    vectorIndexed: experience.vectorIndexed,
    lastError: experience.lastError,
  }));
  const indexedSources = new Set(archivedExperiences.map((experience) => experience.sourceId));
  return sendJson(response, 200, {
    entries: [
      ...facts,
      ...experiences,
      ...entries.filter((entry) => (!entry.sourceId || !indexedSources.has(entry.sourceId)) && !(entry.kind === "fact" && structuredValues.some((value) => entry.text.includes(value)))),
    ],
    ...(vectorError ? { vectorError } : {}),
  });
}

async function deleteMemory(store: ServerDeps["store"], memory: MemoryStore | undefined, pathname: string, response: ServerResponse) {
  const id = decodeURIComponent(pathname.slice("/api/memories/".length));
  if (id.startsWith("local:")) {
    const factId = Number(id.slice("local:".length));
    if (!Number.isInteger(factId) || factId < 1 || !store.getFact(factId)) {
      return sendJson(response, 404, { error: "没有找到这条记忆。" });
    }
    const vectorId = store.factVectorId(factId);
    if (vectorId && memory) await memory.remove(vectorId);
    store.removeFact(factId);
  } else if (id.startsWith("local-exp:")) {
    const experienceId = Number(id.slice("local-exp:".length));
    const experience = Number.isInteger(experienceId) && experienceId > 0 ? store.getExperience(experienceId) : undefined;
    if (!experience) return sendJson(response, 404, { error: "没有找到这条记忆。" });
    if (experience.vectorEntryId && memory) await memory.remove(experience.vectorEntryId);
    store.removeExperience(experienceId);
  } else {
    if (!memory) return sendJson(response, 503, { error: "语义记忆索引未启用，无法删除该索引条目。" });
    await memory.remove(id);
  }
  return sendJson(response, 200, { ok: true });
}
