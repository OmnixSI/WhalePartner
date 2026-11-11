/** 静态托管前端（apps/client/dist）+ PWA manifest：手机/其他电脑用浏览器打开 hub 地址即可。 */
import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { pipeline } from "node:stream";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".webmanifest": "application/manifest+json",
  ".moc3": "application/octet-stream", ".wasm": "application/wasm", ".glb": "model/gltf-binary",
};

export const MANIFEST = {
  name: "鲸汐",
  short_name: "鲸汐",
  description: "她一直都在。",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#f4efe4",
  theme_color: "#f4efe4",
  icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
};

/** 返回 true 表示已处理。 */
export function serveStatic(staticDir: string | undefined, request: IncomingMessage, response: ServerResponse, pathname: string): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (pathname === "/manifest.webmanifest") {
    response.writeHead(200, { "content-type": TYPES[".webmanifest"], "cache-control": "no-cache" });
    response.end(JSON.stringify(MANIFEST));
    return true;
  }
  if (!staticDir || !existsSync(staticDir) || pathname.startsWith("/api/") || pathname === "/api") return false;
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return false; }
  const target = normalize(join(staticDir, decoded));
  if (target !== staticDir && !target.startsWith(staticDir + sep)) return false;
  let file = target;
  if (!existsSync(file) || statSync(file).isDirectory()) {
    // 单页应用：没有扩展名的路径回退到 index.html
    if (extname(decoded)) return false;
    file = join(staticDir, "index.html");
    if (!existsSync(file)) return false;
  }
  const hashed = /\/assets\//.test(decoded);
  response.writeHead(200, {
    "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
    "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
  });
  if (request.method === "HEAD") { response.end(); return true; }
  // 文件在检查之后被删（例如正在重新构建前端）时，读流会报错；用 pipeline 收尾，别让它拖垮进程。
  pipeline(createReadStream(file), response, () => {});
  return true;
}
