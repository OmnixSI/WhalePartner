import { resolve } from "node:path";

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
  deepseek?: OpenAiCompatibleConfig;
  backup?: OpenAiCompatibleConfig;
  codexFallback: boolean;
  llmTimeoutMs: number;
}

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

  return {
    host: text(env.API_HOST) ?? "127.0.0.1",
    memoryEnabled: text(env.MEMORY) !== "off",
    memoryDir: text(env.MEMORY_DIR) ?? resolve(import.meta.dirname, "../.local/memory"),
    dbPath: text(env.APP_DB_PATH) ?? resolve(import.meta.dirname, "../.local/app.db"),
    port: positiveInt(env.API_PORT, 8787, "API_PORT"),
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
  };
}
