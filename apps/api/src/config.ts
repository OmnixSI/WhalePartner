import { homedir } from "node:os";
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
  diaryCron: string;
  deepseek?: OpenAiCompatibleConfig;
  backup?: OpenAiCompatibleConfig;
  codexFallback: boolean;
  llmTimeoutMs: number;
  /** B1：每个自然月的“贝壳”总量；目前只记账不拦截。 */
  quotaMonthlyUnits: number;
  /** B1：`QUOTA_ENFORCE=1` 时额度不够会返回 402。 */
  quotaEnforce: boolean;
  /** B2：导出 zip 落在哪里，默认 `~/Downloads`。 */
  exportDir: string;
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
    diaryCron: text(env.DIARY_CRON) ?? "0 20 * * *",
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
    quotaMonthlyUnits: positiveInt(env.QUOTA_MONTHLY_UNITS, 3000, "QUOTA_MONTHLY_UNITS"),
    quotaEnforce: text(env.QUOTA_ENFORCE) === "1",
    exportDir: text(env.EXPORT_DIR) ?? resolve(homedir(), "Downloads"),
  };
}

/**
 * 把日记的 cron 表达式读成人能看懂的时间（B6.1）：
 * 只有 `M H * * *` 这种每天固定时刻的写法能转成 `"HH:MM"`，其余返回 null。
 */
export function journalTimeFromCron(expression: string): string | null {
  const match = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/.exec(expression.trim());
  if (!match) return null;
  const minute = Number(match[1]);
  const hour = Number(match[2]);
  if (minute > 59 || hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
