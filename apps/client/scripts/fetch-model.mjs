// 下载演示用的现成二次元 VRM（内部展示用，文件不进仓库）。
// 来源是 AIRI 项目自己引用的 VRoid 官方示例镜像；换模型：改下面的清单和 src/avatar/model.config.ts。
//   pnpm --dir apps/client run fetch-model            下载全部
//   pnpm --dir apps/client run fetch-model avatar-a   只下载一个
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const MODELS = [
  {
    id: "avatar-a",
    file: "avatar-a.vrm",
    url: "https://dist.ayaka.moe/vrm-models/VRoid-Hub/AvatarSample-A/AvatarSample_A.vrm",
    sha256: "2a0ccd84880b03d7b65503d8b6287f7a97f3bb4fab70a5fd0a47b433c97827f5",
  },
  {
    id: "avatar-b",
    file: "avatar-b.vrm",
    url: "https://dist.ayaka.moe/vrm-models/VRoid-Hub/AvatarSample-B/AvatarSample_B.vrm",
    sha256: "7fca4a77fdc60ab2c78a9907430744562626180125fa386eb74fb2ea15c2e518",
  },
];

const dir = resolve(import.meta.dirname, "../public/models");
const wanted = process.argv.slice(2);
const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");
mkdirSync(dir, { recursive: true });

for (const model of MODELS.filter((m) => wanted.length === 0 || wanted.includes(m.id))) {
  const target = resolve(dir, model.file);
  if (existsSync(target) && (!model.sha256 || sha(readFileSync(target)) === model.sha256)) {
    console.log(`${model.file} 已存在，跳过。`);
    continue;
  }
  const response = await fetch(model.url);
  if (!response.ok) throw new Error(`${model.id} 下载失败：HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const digest = sha(buffer);
  if (model.sha256 && digest !== model.sha256) throw new Error(`${model.id} 校验失败：期望 ${model.sha256}，实际 ${digest}`);
  writeFileSync(target, buffer);
  console.log(`已保存 ${model.file}（${(buffer.length / 1048576).toFixed(1)} MB）\n  sha256 ${digest}`);
}
