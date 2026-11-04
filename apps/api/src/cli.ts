import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const appDir = resolve(import.meta.dirname, "..");
const repoDir = resolve(appDir, "../..");

async function writeSmokeArtifact() {
  const outPath = resolve(repoDir, ".local/PLACEHOLDER_smoke.json");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify({ status: "PLACEHOLDER", purpose: "CLI smoke artifact only" }, null, 2) + "\n");
  process.stdout.write(outPath + "\n");
}

async function main() {
  if (process.argv.includes("--smoke")) {
    await writeSmokeArtifact();
    return;
  }

  process.stderr.write("Usage: pnpm run summarize -- <bilibili-url-or-bvid>\n");
  process.exitCode = 2;
}

void main();
