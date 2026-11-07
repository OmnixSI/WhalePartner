/**
 * 模型二进制缓存：Cache Storage 命中则二次进入秒开；未命中走网络并写回。
 * 同一 url 的并发请求共用一个 Promise；失败不留缓存，可重试。
 */
const CACHE_NAME = "whalepartner-models-v1";
const inflight = new Map<string, Promise<ArrayBuffer>>();

export function fetchModelBuffer(url: string, onProgress?: (ratio: number) => void): Promise<ArrayBuffer> {
  const existing = inflight.get(url);
  if (existing) return existing;
  const promise = (async () => {
    const cache = typeof caches !== "undefined" ? await caches.open(CACHE_NAME).catch(() => null) : null;
    const hit = cache ? await cache.match(url).catch(() => undefined) : undefined;
    if (hit) {
      const buffer = await hit.arrayBuffer();
      onProgress?.(1);
      return buffer;
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    if ((response.headers.get("content-type") ?? "").includes("text/html")) throw new Error(`模型文件不存在：${url}`);
    const copy = response.clone();
    const total = Number(response.headers.get("content-length")) || 0;
    let buffer: ArrayBuffer;
    if (response.body && total > 0 && onProgress) {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.byteLength;
        onProgress(Math.min(1, loaded / total));
      }
      const merged = new Uint8Array(loaded);
      let offset = 0;
      for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
      buffer = merged.buffer;
    } else {
      buffer = await response.arrayBuffer();
    }
    // 只缓存确实是模型的响应（dev server 的 SPA 回退会返回 index.html，不能存）。
    const type = copy.headers.get("content-type") ?? "";
    if (cache && !type.includes("text/html")) void cache.put(url, copy).catch(() => {});
    return buffer;
  })().finally(() => inflight.delete(url));
  inflight.set(url, promise);
  return promise;
}

/** 应用启动后空闲时预取当前角色模型，进入聊天页时直接命中缓存。 */
export function prefetchModelWhenIdle(url: string, isVrm: boolean, onDone?: () => void) {
  const run = () => {
    if (isVrm) void fetchModelBuffer(url).catch(() => {}).finally(() => onDone?.());
    else onDone?.();
  };
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(run, { timeout: 4000 });
  else window.setTimeout(run, 1500);
}
