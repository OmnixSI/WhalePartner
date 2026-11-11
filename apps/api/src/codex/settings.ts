import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { dataDir } from "../server/data-dir.ts";

/**
 * 大肥鱼自己选的 Codex 模型和推理强度。
 *
 * 存在大肥鱼的数据目录里，**不读也不写** `~/.codex/config.toml`：那个文件归用户自己的 Codex
 * （桌面版 / VS Code / CLI）所有，用户在那边换模型时 Codex 会改写它。以前大肥鱼的设置也存在那里，
 * 结果两边互相覆盖：用户换了 Codex 的模型，大肥鱼就跟着换；大肥鱼保存设置，又改掉用户的 Codex 默认值。
 * 空字符串表示没选，用 Codex 模型列表里的默认模型 / 该模型的默认档位。
 */
export interface StoredCodexSettings {
  model: string;
  effort: string;
}

export function codexSettingsPath(env: Record<string, string | undefined> = process.env) {
  return join(dataDir(env), "codex-settings.json");
}

export function readStoredCodexSettings(path = codexSettingsPath()): StoredCodexSettings {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<StoredCodexSettings>;
    return {
      model: typeof raw.model === "string" ? raw.model : "",
      effort: typeof raw.effort === "string" ? raw.effort : "",
    };
  } catch {
    return { model: "", effort: "" };
  }
}

/** 先写临时文件再改名：保存到一半退出也不会留下半截 JSON。 */
export function writeStoredCodexSettings(settings: StoredCodexSettings, path = codexSettingsPath()) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ model: settings.model, effort: settings.effort }, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}
