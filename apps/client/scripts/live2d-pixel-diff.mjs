#!/usr/bin/env node
/**
 * Live2D 逐像素对照：两份构建在同一组模型姿态下画出来的像素是否一致（用来验证绘制路径的改动不改画面）。
 *
 *   node scripts/live2d-pixel-diff.mjs <distA> <snaps.json> record          在 distA 上录一组姿态（静置、点击动作、张嘴）
 *   node scripts/live2d-pixel-diff.mjs <distA> <snaps.json> a               停掉 ticker，逐个姿态画一帧，读回像素
 *   node scripts/live2d-pixel-diff.mjs <distB> <snaps.json> b <snaps.a.px.json>   同上，并与 a 逐字节比较
 *
 * 端口 14251；姿态里存参数值和部件不透明度，两边都直接写进 Cubism 模型再画，与时间、动作进度无关。
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
const CLIENT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { serveDist } = await import(join(CLIENT, "scripts/perf-idle.mjs"));
const { stubApi } = await import(join(CLIENT, "scripts/ui-fixtures.mjs"));
const require = createRequire(join(CLIENT, "package.json"));
const pw = await import(pathToFileURL(require.resolve("playwright")).href);
const [dist, snapFile, mode] = process.argv.slice(2);
const server = await serveDist(dist, 14251);
const browser = await (pw.chromium ?? pw.default.chromium).launch({ channel: "chrome", headless: false });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await stubApi(page);
await page.addInitScript(() => { localStorage.setItem("wp.onboarded", "1"); localStorage.setItem("wp.character", "deepseek"); });
await page.goto("http://127.0.0.1:14251/", { waitUntil: "networkidle" });
await page.waitForSelector('.live2d[data-stage="ready"] canvas');
await page.waitForTimeout(3000);
const find = () => { let l = PIXI.Ticker.shared._head, m, app; while (l) { if (l.context?.internalModel) m = l.context; if (l.context?.renderer && l.context?.stage) app = l.context; l = l.next; } return { m, app }; };
if (mode === "record") {
  const box = await page.locator(".live2d canvas").boundingBox();
  const snaps = [];
  const grab = () => page.evaluate(`(${find})()`).then(() => page.evaluate(() => { let l = PIXI.Ticker.shared._head, m; while (l) { if (l.context?.internalModel) m = l.context; l = l.next; } const cm = m.internalModel.coreModel._model; return { p: Array.from(cm.parameters.values), o: Array.from(cm.parts.opacities) }; }));
  for (let i = 0; i < 4; i++) { snaps.push(await grab()); await page.waitForTimeout(700); }
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.2);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.6);
  for (let i = 0; i < 6; i++) { await page.waitForTimeout(350); snaps.push(await grab()); }
  // 张嘴
  await page.evaluate(() => { let l = PIXI.Ticker.shared._head, m; while (l) { if (l.context?.internalModel) m = l.context; l = l.next; } const cm = m.internalModel.coreModel; window.__mouth = () => cm.setParameterValueById("ParamMouthOpenY", 1); m.internalModel.on("beforeModelUpdate", window.__mouth); });
  for (let i = 0; i < 2; i++) { await page.waitForTimeout(300); snaps.push(await grab()); }
  writeFileSync(snapFile, JSON.stringify(snaps));
  console.log("recorded", snaps.length);
} else {
  const snaps = JSON.parse(readFileSync(snapFile, "utf8"));
  const out = await page.evaluate((snaps) => {
    let l = PIXI.Ticker.shared._head, m, app; while (l) { if (l.context?.internalModel) m = l.context; if (l.context?.renderer && l.context?.stage) app = l.context; l = l.next; }
    PIXI.Ticker.shared.stop();
    const im = m.internalModel, cm = im.coreModel._model; let cur;
    im.update = () => { cm.parameters.values.set(cur.p); cm.parts.opacities.set(cur.o); cm.update(); cm.drawables.resetDynamicFlags?.(); };
    const r = app.renderer, gl = r.gl; const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const res = [];
    for (const s of snaps) { cur = s; im.update(); r.render(app.stage); const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); let nz = 0; for (let i = 3; i < px.length; i += 4) if (px[i]) nz++; let bin = ""; for (let i = 0; i < px.length; i += 0x8000) bin += String.fromCharCode.apply(null, px.subarray(i, i + 0x8000)); res.push({ px: btoa(bin), nz }); }
    return { w, h, res };
  }, snaps);
  const bufs = out.res.map((r) => Buffer.from(r.px, "base64"));
  const frames = bufs.map((b, i) => ({ hash: createHash("sha1").update(b).digest("hex").slice(0, 12), nz: out.res[i].nz }));
  const other = process.argv[5] && existsSync(process.argv[5]) ? JSON.parse(readFileSync(process.argv[5], "utf8")) : null;
  if (other) frames.forEach((f, i) => { const o = Buffer.from(other[i], "base64"), b = bufs[i]; let diff = 0, max = 0; for (let k = 0; k < b.length; k++) { const d = Math.abs(b[k] - o[k]); if (d) { diff++; if (d > max) max = d; } } f.diffBytes = diff; f.maxDelta = max; });
  writeFileSync(snapFile.replace(".json", `.${mode}.px.json`), JSON.stringify(out.res.map((r) => r.px)));
  console.log(JSON.stringify({ w: out.w, h: out.h, frames }));
}
await browser.close(); server.close();
