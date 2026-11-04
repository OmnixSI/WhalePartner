// 下载演示用的现成二次元 VRM（内部展示用，文件不进仓库）。清单在 models.manifest.json。
//   pnpm --dir apps/client run fetch-model            下载清单里的全部模型
//   pnpm --dir apps/client run fetch-model avatar-a   只下载指定的
// 单个失败只记录并继续；有 sha256 的会校验，没有的会打印出来方便补进清单。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const { models } = JSON.parse(readFileSync(resolve(import.meta.dirname, "../models.manifest.json"), "utf8"));
const dir = resolve(import.meta.dirname, "../public/models");
const wanted = process.argv.slice(2);
const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");
mkdirSync(dir, { recursive: true });

async function download(model) {
  const response = await fetch(model.download.url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  let buffer = Buffer.from(await response.arrayBuffer());
  if (model.download.zipEntry) {
    // 压缩包放在独立的临时位置，只取出一个 .vrm，不执行里面的任何东西。
    const tmp = resolve(dir, `.${model.id}.zip`);
    writeFileSync(tmp, buffer);
    try {
      buffer = execFileSync("unzip", ["-p", tmp, model.download.zipEntry], { maxBuffer: 512 * 1024 * 1024 });
    } finally {
      execFileSync("rm", ["-f", tmp]);
    }
  }
  if (buffer.subarray(0, 4).toString("latin1") !== "glTF") throw new Error("不是 glTF/VRM 文件");
  return buffer;
}

let failed = 0;
for (const model of models.filter((m) => wanted.length === 0 || wanted.includes(m.id))) {
  const target = resolve(dir, model.file);
  if (existsSync(target) && (!model.sha256 || sha(readFileSync(target)) === model.sha256)) {
    console.log(`跳过  ${model.file}（已存在）`);
    continue;
  }
  try {
    const buffer = await download(model);
    const digest = sha(buffer);
    if (model.sha256 && digest !== model.sha256) throw new Error(`校验失败：期望 ${model.sha256}，实际 ${digest}`);
    writeFileSync(target, buffer);
    console.log(`已保存 ${model.file}（${(buffer.length / 1048576).toFixed(1)} MB）${model.sha256 ? "" : `\n  sha256 ${digest}（请补进清单）`}`);
  } catch (error) {
    failed++;
    console.warn(`失败  ${model.id}：${error instanceof Error ? error.message : error}`);
  }
}
process.exit(failed ? 1 : 0);
