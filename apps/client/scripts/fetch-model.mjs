// 下载演示用的开源 VRM（pixiv three-vrm 官方示例，VRM Public License 1.0）。
// 模型文件不进仓库；换原创模型时改 src/avatar/model.config.ts 和这里的 URL/校验值。
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const URL_ = "https://raw.githubusercontent.com/pixiv/three-vrm/dev/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm";
const SHA256 = process.env.VRM_SHA256 ?? "12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2";
const target = resolve(import.meta.dirname, "../public/models/demo.vrm");

const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");

if (existsSync(target) && (!SHA256 || sha(readFileSync(target)) === SHA256)) {
  console.log("demo.vrm 已存在，跳过下载。");
  process.exit(0);
}

const response = await fetch(URL_);
if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
const buffer = Buffer.from(await response.arrayBuffer());
const digest = sha(buffer);
if (SHA256 && digest !== SHA256) throw new Error(`校验失败：期望 ${SHA256}，实际 ${digest}`);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, buffer);
console.log(`已保存 ${target}（${(buffer.length / 1048576).toFixed(1)} MB）\nsha256 ${digest}`);
