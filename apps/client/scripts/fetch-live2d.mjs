import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const clientRoot = resolve(import.meta.dirname, "..");
const modelRoot = resolve(clientRoot, "public/live2d/whale-maid");
const coreTarget = resolve(clientRoot, "public/live2d/libs/live2dcubismcore.min.js");
const modelSource = "https://raw.githubusercontent.com/A8Chann/dsh-pet-live2d/9b7cd8ed0d16bd23fb098bc0c4fdbac63d89de75/dsh-live2d-pet/pets/ds-whale-girl/";
const licenseSource = "https://raw.githubusercontent.com/A8Chann/dsh-pet-live2d/9b7cd8ed0d16bd23fb098bc0c4fdbac63d89de75/dsh-live2d-pet/";
const modelFile = "c_0120.model3.json";
const requireCore = process.argv.includes("--require-core");

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
  // NOTICE.md 上游不一定存在，缺了不影响运行
  await downloadIfMissing(sourceUrl(licenseSource, "NOTICE.md"), resolve(modelRoot, "NOTICE.md")).catch(() => {});
  // Cubism Core（4）与 live2d.min.js（Cubism 2 模型才需要）：尽力从官方地址取，取不到只警告，不让整条命令失败。
  const runtimes = [
    { target: coreTarget, url: "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js", needed: true },
    { target: resolve(clientRoot, "public/live2d/libs/live2d.min.js"), url: "https://cubism.live2d.com/sdk-web/bin/live2d.min.js", needed: false },
  ];
  for (const runtime of runtimes) {
    if (existsSync(runtime.target)) continue;
    try {
      const response = await fetch(runtime.url, { headers: { "user-agent": "WhalePartner" } });
      const text = response.ok ? await response.text() : "";
      if (!text || /^\s*</.test(text)) throw new Error(`HTTP ${response.status}`);
      mkdirSync(dirname(runtime.target), { recursive: true });
      writeFileSync(runtime.target, text);
      console.log(`已下载 ${runtime.target.replace(`${clientRoot}/`, "")}`);
    } catch (error) {
      const label = runtime.target.replace(`${clientRoot}/`, "");
      if (runtime.needed) {
        if (requireCore) {
          throw new Error(
            `无法获取必须的 ${label}（${error instanceof Error ? error.message : error}）。请从 Live2D 官方 Web SDK 获取并放到该路径，再重新构建。Cubism Core 遵循其独立许可，不要提交或分发该文件。`,
          );
        }
        console.warn(`未能获取 ${label}（${error instanceof Error ? error.message : error}）：请自行从 Live2D 官方 SDK 页面获取并放入该路径。`);
        console.warn("下载与分发须遵循 Live2D SDK 许可。https://www.live2d.com/en/sdk/download/web/");
      } else {
        console.warn(`未获取 ${label}：只有 Cubism 2（.model.json）模型需要它，可忽略。`);
      }
    }
  }
  console.log(requireCore ? "大肥鱼 Live2D 模型与 Cubism Core 已准备好。" : "大肥鱼 Live2D 模型资源已准备好。");
} catch (error) {
  console.error(`Live2D 下载失败：${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
