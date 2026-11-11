import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonBody, sendJson } from "../server/http.ts";
import { listCodexModels, type CodexModelOption } from "../codex/app-server.ts";
import { codexSettingsPath, readStoredCodexSettings, writeStoredCodexSettings } from "../codex/settings.ts";
import type { ServerDeps } from "../server/types.ts";

/**
 * 模型接入（设置 › 模型接入）：把「接 DeepSeek 的 key」和「调 Codex 的模型和推理强度」搬到界面上。
 * Codex 的选择存在大肥鱼自己的 `codex-settings.json`，不碰用户的 `~/.codex/config.toml`。
 *
 * 三条底线：
 * 1. **绝不回明文**：GET 只给 configured + 掩码后四位；PUT 的响应里也只有掩码。
 * 2. **写 `.env` 先备份**成 `.env.bak`。
 * 3. **同时只允许一个写**：抢不到写锁就回 409，别让两个保存互相盖。
 *
 * 都不写日志：这里没有任何 console 调用。
 */
/** 模型名的粗筛；真正的判断是它在不在 Codex 当前的模型列表里。 */
const MODEL_PATTERN = /^\S{2,64}$/;
/** `sk-` 前缀 + 17–197 个可打印字符 = 全长 20–200，且不可能夹换行。 */
const KEY_PATTERN = /^sk-[\x21-\x7e]{17,197}$/;

const ENV_FILE_NAME = "DEEPSEEK_API_KEY";

export interface SetupTargets {
  /** 写 `DEEPSEEK_API_KEY` 的那个 `.env`；默认 `apps/api/.env`。 */
  envPath: string;
  /** 大肥鱼自己的 Codex 设置；默认数据目录里的 `codex-settings.json`。 */
  codexPath: string;
}

export function setupTargets(deps: ServerDeps): SetupTargets {
  return {
    envPath: deps.setup?.envPath ?? (process.env.WP_DATA_DIR?.trim() ? join(resolve(process.env.WP_DATA_DIR.trim()), ".env") : resolve(import.meta.dirname, "../../.env")),
    codexPath: deps.setup?.codexPath ?? codexSettingsPath(),
  };
}

/* ---------------------------------------------------------------- 写锁 */

let writing = false;

/**
 * 抢写锁：抢到返回 true，同一时间只有一个写操作能拿到。
 * 测试里也用它模拟「另一个请求正在写」，验证 409。
 */
export function acquireSetupWrite(): boolean {
  if (writing) return false;
  writing = true;
  return true;
}

export function releaseSetupWrite(): void {
  writing = false;
}

/* ---------------------------------------------------------------- 文本工具 */

/** 掩码：永远只有 `sk-…` + 后四位；短得离谱的值干脆一位都不露。 */
export function maskKey(key: string): string {
  return key.length >= 8 ? `sk-…${key.slice(-4)}` : "sk-…";
}

function unquote(raw: string): string {
  const value = raw.replace(/\s+#.*$/, "").trim();
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

/** 读 `.env` 里某一项；文件不在或没这项都返回 undefined。`export X=` 也认。 */
function readEnvValue(envPath: string, name: string): string | undefined {
  if (!existsSync(envPath)) return undefined;
  let text: string;
  try {
    text = readFileSync(envPath, "utf8");
  } catch {
    return undefined;
  }
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=(.*)$`, "m");
  const match = pattern.exec(text);
  if (!match) return undefined;
  const value = unquote(match[1]);
  return value ? value : undefined;
}

/** 整行替换（保留其它行和行首的 `export `），没有就追加到末尾。 */
function upsertEnvValue(text: string, name: string, value: string): string {
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=.*$`, "m");
  const existing = pattern.exec(text);
  if (existing) {
    const prefix = /^\s*export\s+/.test(existing[0]) ? "export " : "";
    return text.replace(pattern, () => `${prefix}${name}=${value}`);
  }
  const line = `${name}=${value}`;
  const trimmed = text.replace(/\s+$/, "");
  return trimmed ? `${trimmed}\n${line}\n` : `${line}\n`;
}

function readFileOrEmpty(path: string): string {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : "";
  } catch {
    return "";
  }
}

/** 写之前先备份成 `<文件名>.bak`（文件本来不存在就不写备份）。`mode` 给了就同样收紧备份的权限。 */
function backup(path: string, mode?: number): void {
  if (!existsSync(path)) return;
  copyFileSync(path, `${path}.bak`);
  if (mode !== undefined) chmodSync(`${path}.bak`, mode);
}

/** `mode` 给了就按它设权限（新建和已有文件都设）：装密钥的 .env 只给自己读写。 */
function writeText(path: string, text: string, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, mode === undefined ? "utf8" : { encoding: "utf8", mode });
  if (mode !== undefined) chmodSync(path, mode);
}

const SECRET_FILE_MODE = 0o600;

/* ---------------------------------------------------------------- 读当前状态 */

async function readCodexModels(deps: ServerDeps) {
  return deps.codexModels ? deps.codexModels() : listCodexModels();
}

/**
 * 只读已保存的值，不等 Codex 模型列表：列表要先拉起 app-server，可能慢也可能失败，
 * 界面上已保存的模型和档位不能跟着它一起转圈或消失。模型列表走 `GET /api/setup/codex/models`。
 */
export function readSetupState(deps: ServerDeps) {
  const targets = setupTargets(deps);
  // 文件里的值优先：刚保存过就能立刻在界面上看到；进程内 config 兜底（key 也可能来自系统环境变量）。
  const key = readEnvValue(targets.envPath, ENV_FILE_NAME) ?? deps.config.deepseek?.apiKey;
  const stored = readStoredCodexSettings(targets.codexPath);

  return {
    deepseek: {
      configured: Boolean(key),
      masked: key ? maskKey(key) : null,
    },
    codex: {
      model: stored.model,
      effort: stored.effort,
      configPath: targets.codexPath,
      present: existsSync(targets.codexPath),
    },
    chain: deps.provider.providers.map((item) => item.id),
  };
}

/* ---------------------------------------------------------------- 校验 */

function validateKey(raw: unknown): { ok: true; key: string } | { ok: false } {
  if (typeof raw !== "string") return { ok: false };
  return KEY_PATTERN.test(raw) ? { ok: true, key: raw } : { ok: false };
}

function validateEffort(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.trim() ? raw : undefined;
}

/* ---------------------------------------------------------------- 路由 */

export async function handleSetupRoute(
  deps: ServerDeps,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (url.pathname !== "/api/setup" && !url.pathname.startsWith("/api/setup/")) return false;

  if (url.pathname === "/api/setup") {
    if (request.method === "GET") {
      try {
        sendJson(response, 200, readSetupState(deps));
      } catch {
        sendJson(response, 503, { error: "setup_unavailable", message: "现在读不到模型设置。" });
      }
      return true;
    }
    sendJson(response, 405, { error: "method_not_allowed", message: "只支持 GET。" });
    return true;
  }

  if (url.pathname === "/api/setup/codex/models") {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "method_not_allowed", message: "只支持 GET。" });
      return true;
    }
    try {
      sendJson(response, 200, { models: await readCodexModels(deps) });
    } catch {
      sendJson(response, 503, { error: "codex_unavailable", message: "现在读不到本机 Codex 的可用模型列表。" });
    }
    return true;
  }

  if (url.pathname === "/api/setup/deepseek" && request.method === "PUT") {
    // 先抢锁再读 body：并发写必须在碰文件之前就被挡住。
    if (!acquireSetupWrite()) {
      sendJson(response, 409, { error: "busy", message: "正在保存另一项设置，等一下再试。" });
      return true;
    }
    try {
      const body = await readJsonBody(request);
      const checked = validateKey(body.key);
      if (!checked.ok) {
        sendJson(response, 400, { error: "invalid_key", message: "这个 key 看着不对：要以 sk- 开头，长度 20–200。" });
        return true;
      }
      const targets = setupTargets(deps);
      backup(targets.envPath, SECRET_FILE_MODE);
      writeText(targets.envPath, upsertEnvValue(readFileOrEmpty(targets.envPath), ENV_FILE_NAME, checked.key), SECRET_FILE_MODE);
      sendJson(response, 200, { ok: true, restartRequired: true, masked: maskKey(checked.key) });
    } catch (error) {
      sendJson(response, 500, { error: "write_failed", message: error instanceof Error ? error.message : "没写进去。" });
    } finally {
      releaseSetupWrite();
    }
    return true;
  }

  if (url.pathname === "/api/setup/codex" && request.method === "PUT") {
    if (!acquireSetupWrite()) {
      sendJson(response, 409, { error: "busy", message: "正在保存另一项设置，等一下再试。" });
      return true;
    }
    try {
      const body = await readJsonBody(request);
      const wantsModel = body.model !== undefined;
      const wantsEffort = body.effort !== undefined;
      if (!wantsModel && !wantsEffort) {
        sendJson(response, 400, { error: "empty", message: "至少给一个 model 或 effort。" });
        return true;
      }

      let model: string | undefined;
      if (wantsModel) {
        if (typeof body.model !== "string" || !MODEL_PATTERN.test(body.model)) {
          sendJson(response, 400, { error: "invalid_model", message: "模型名只能是 2–64 个不带空格的字符。" });
          return true;
        }
        model = body.model;
      }

      let effort: string | undefined;
      if (wantsEffort) {
        effort = validateEffort(body.effort);
        if (!effort) {
          sendJson(response, 400, { error: "invalid_effort", message: "推理强度必须来自当前模型的可用列表。" });
          return true;
        }
      }

      const targets = setupTargets(deps);
      let models: CodexModelOption[];
      try {
        models = await readCodexModels(deps);
      } catch {
        sendJson(response, 503, { error: "codex_unavailable", message: "现在读不到本机 Codex 的可用模型列表。" });
        return true;
      }

      const stored = readStoredCodexSettings(targets.codexPath);
      const modelName = model ?? stored.model;
      const modelOption = modelName
        ? models.find((item) => item.model === modelName)
        : models.find((item) => item.isDefault) ?? models[0];
      if (!modelOption) {
        sendJson(response, 400, { error: "invalid_model", message: "这个模型不在本机 Codex 当前可用列表中。" });
        return true;
      }

      let selectedEffort = effort ?? stored.effort;
      if (!selectedEffort) selectedEffort = modelOption.defaultReasoningEffort;
      const supportedEfforts = modelOption.supportedReasoningEfforts.map((option) => option.reasoningEffort);
      if (!supportedEfforts.includes(selectedEffort)) {
        sendJson(response, 400, {
          error: "invalid_effort",
          message: `推理强度不在 ${modelOption.model} 当前可用列表中：${supportedEfforts.join(" / ")}`,
        });
        return true;
      }

      writeStoredCodexSettings({ model: modelOption.model, effort: selectedEffort }, targets.codexPath);
      const saved = readStoredCodexSettings(targets.codexPath);
      sendJson(response, 200, {
        ok: true,
        restartRequired: false,
        codex: { model: saved.model, effort: saved.effort, configPath: targets.codexPath, present: true },
      });
    } catch (error) {
      sendJson(response, 500, { error: "write_failed", message: error instanceof Error ? error.message : "没写进去。" });
    } finally {
      releaseSetupWrite();
    }
    return true;
  }

  if (url.pathname === "/api/setup/deepseek" || url.pathname === "/api/setup/codex") {
    sendJson(response, 405, { error: "method_not_allowed", message: "只支持 PUT。" });
    return true;
  }

  sendJson(response, 404, { error: "not_found", message: "没有这个设置项。" });
  return true;
}
