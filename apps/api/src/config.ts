import { join, resolve } from "node:path";
import { surfDataDir } from "./data-dir.ts";

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ApiConfig {
  host: string;
  dbPath: string;
  memoryEnabled: boolean;
  memoryDir: string;
  port: number;
  diaryCron: string;
  journalCron: string;
  chatContextTokens: number;
  deepseek?: OpenAiCompatibleConfig;
  backup?: OpenAiCompatibleConfig;
  codexFallback: boolean;
  llmTimeoutMs: number;
  /** 「她自己去逛」的全局总闸（SURF_ENABLED，默认开）。 */
  surfEnabled: boolean;
  /** 自定义 Chromium 路径（SURF_CHROMIUM_PATH），默认用 playwright 自带的。 */
  surfChromiumPath?: string;
  /** 冲浪留下的东西（缩略图）放这儿，默认 .local/surf。 */
  surfDir: string;
  /** 桌面 App 注入的本机令牌（WP_LOCAL_TOKEN）；同 `localToken`，方便通过 config 传递。 */
  localToken?: string;
}

/**
 * 桌面 App 由 Tauri 在启动后端时注入 WP_LOCAL_TOKEN（随机、每次启动都不同）。
 * 没设置（开发时单独跑后端）就是 undefined，鉴权中间件据此决定放行。
 */
export const localToken: string | undefined = process.env.WP_LOCAL_TOKEN?.trim() || undefined;

const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-flash";

function text(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function positiveInt(value: string | undefined, fallback: number, name: string) {
  const raw = text(value);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} 必须是正整数。`);
  return parsed;
}

/** 从环境变量读取服务配置。密钥只在这里进入进程，不写入日志和响应。 */
export function loadConfig(env: Record<string, string | undefined> = process.env): ApiConfig {
  const deepseekKey = text(env.DEEPSEEK_API_KEY);
  const backupKey = text(env.BACKUP_LLM_API_KEY);
  const backupBase = text(env.BACKUP_LLM_BASE_URL);
  const backupModel = text(env.BACKUP_LLM_MODEL);

  // WP_DATA_DIR（桌面 App 的 app_data_dir）优先于仓库内 .local；单项环境变量仍可覆盖。
  const dataDir = text(env.WP_DATA_DIR);
  const dataPath = (name: string) => (dataDir ? join(resolve(dataDir), name) : resolve(import.meta.dirname, "../.local", name));

  return {
    host: text(env.API_HOST) ?? "127.0.0.1",
    memoryEnabled: text(env.MEMORY) !== "off",
    memoryDir: text(env.MEMORY_DIR) ?? dataPath("memory"),
    dbPath: text(env.APP_DB_PATH) ?? dataPath("app.db"),
    port: positiveInt(env.API_PORT, 8787, "API_PORT"),
    diaryCron: text(env.DIARY_CRON) ?? "0 20 * * *",
    journalCron: text(env.JOURNAL_CRON) ?? "30 20 * * *",
    chatContextTokens: positiveInt(env.CHAT_CONTEXT_TOKENS, 32_000, "CHAT_CONTEXT_TOKENS"),
    deepseek: deepseekKey
      ? {
          baseUrl: text(env.DEEPSEEK_BASE_URL) ?? DEFAULT_DEEPSEEK_BASE_URL,
          apiKey: deepseekKey,
          model: text(env.DEEPSEEK_MODEL) ?? DEFAULT_DEEPSEEK_MODEL,
        }
      : undefined,
    backup:
      backupKey && backupBase && backupModel
        ? { baseUrl: backupBase, apiKey: backupKey, model: backupModel }
        : undefined,
    codexFallback: text(env.CODEX_FALLBACK) !== "0",
    llmTimeoutMs: positiveInt(env.LLM_TIMEOUT_MS, 30000, "LLM_TIMEOUT_MS"),
    surfEnabled: text(env.SURF_ENABLED) !== "0",
    surfChromiumPath: text(env.SURF_CHROMIUM_PATH),
    surfDir: text(env.SURF_DIR) ?? surfDataDir(env),
    localToken: text(env.WP_LOCAL_TOKEN),
  };
}
