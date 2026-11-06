import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const clientRoot = resolve(import.meta.dirname, "..");
const modelRoot = resolve(clientRoot, "public/live2d/whale-maid");
const coreTarget = resolve(clientRoot, "public/live2d/libs/live2dcubismcore.min.js");
const modelSource = "https://raw.githubusercontent.com/A8Chann/dsh-pet-live2d/9b7cd8ed0d16bd23fb098bc0c4fdbac63d89de75/dsh-live2d-pet/pets/ds-whale-girl/";
const licenseSource = "https://raw.githubusercontent.com/A8Chann/dsh-pet-live2d/9b7cd8ed0d16bd23fb098bc0c4fdbac63d89de75/dsh-live2d-pet/";
const modelFile = "c_0120.model3.json";

function sourceUrl(base, path) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return new URL(encodedPath, base);
}

async function downloadIfMissing(url, target) {
  if (existsSync(target)) return;
  const response = await fetch(url, { headers: { "user-agent": "WhalePartner" } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  console.log(`已下载 ${target.replace(`${clientRoot}/`, "")}`);
}

function collectAssetFiles(value, files) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectAssetFiles(item, files));
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, item] of Object.entries(value)) {
    if (["Moc", "Textures", "Physics", "DisplayInfo", "File"].includes(key)) {
      if (typeof item === "string") files.add(item);
      else if (Array.isArray(item)) item.filter((path) => typeof path === "string").forEach((path) => files.add(path));
    } else {
      collectAssetFiles(item, files);
    }
  }
}

try {
  const modelPath = resolve(modelRoot, modelFile);
  await downloadIfMissing(sourceUrl(modelSource, modelFile), modelPath);
  const model = JSON.parse(readFileSync(modelPath, "utf8"));
  const files = new Set([modelFile]);
  collectAssetFiles(model.FileReferences, files);
  for (const file of files) {
    await downloadIfMissing(sourceUrl(modelSource, file), resolve(modelRoot, file));
  }
  await downloadIfMissing(sourceUrl(modelSource, "LICENSE"), resolve(modelRoot, "LICENSE"));
  await downloadIfMissing(sourceUrl(licenseSource, "NOTICE.md"), resolve(modelRoot, "NOTICE.md"));
  if (!existsSync(coreTarget)) {
    console.warn(`未找到 Cubism Core：请自行从 Live2D 官方 SDK 页面获取并放入 ${coreTarget.replace(`${clientRoot}/`, "")}`);
    console.warn("下载与分发须遵循 Live2D SDK 许可；未安装时应用会显示默认鲸鱼形象。");
    console.warn("https://www.live2d.com/en/sdk/download/web/");
  }
  console.log("大肥鱼 Live2D 模型资源已准备好。");
} catch (error) {
  console.error(`Live2D 下载失败：${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
