import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface StoredCodexSettings {
  model: string;
  effort: string;
}

export function codexConfigPath() {
  const codexHome = process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
  return join(codexHome, "config.toml");
}

function readTomlValue(text: string, name: string): string | undefined {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) break;
    if (!line || line.startsWith("#")) continue;
    const match = new RegExp(`^${name}\\s*=\\s*(.*)$`).exec(line);
    if (!match) continue;

    const value = match[1].replace(/\s+#.*$/, "").trim();
    if (value.length < 2) return value;
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        return JSON.parse(value) as string;
      } catch {
        return value.slice(1, -1);
      }
    }
    if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
    return value;
  }
  return undefined;
}

export function readStoredCodexSettings(configPath = codexConfigPath()): StoredCodexSettings {
  let text = "";
  try {
    text = readFileSync(configPath, "utf8");
  } catch {
    text = "";
  }

  return {
    model: readTomlValue(text, "model") ?? "",
    effort: readTomlValue(text, "model_reasoning_effort") ?? process.env.CODEX_REASONING_EFFORT?.trim() ?? "",
  };
}
