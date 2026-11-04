import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CORE = readFileSync(resolve(import.meta.dirname, "whale.md"), "utf8").trim();

/** 人格核心固定在文件里，模型无法改写；记忆和经历只作为资料拼在后面。 */
export function buildSystemPrompt(): string {
  return CORE;
}
