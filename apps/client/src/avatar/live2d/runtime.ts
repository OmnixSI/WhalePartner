/** Cubism 运行时按需加载：Core 脚本去重（含并发），失败后允许重试。 */
export type CubismVersion = 2 | 4;

const CORE_URLS: Record<CubismVersion, { url: string; global: string }> = {
  4: { url: "/live2d/libs/live2dcubismcore.min.js", global: "Live2DCubismCore" },
  2: { url: "/live2d/libs/live2d.min.js", global: "Live2D" },
};

const pending = new Map<CubismVersion, Promise<void>>();

/** `.model3.json` 是 Cubism 3/4/5；`.model.json` 是 Cubism 2。 */
export function cubismVersionOf(modelUrl: string): CubismVersion {
  const path = modelUrl.split(/[?#]/)[0].toLowerCase();
  return path.endsWith(".model3.json") ? 4 : path.endsWith(".model.json") ? 2 : 4;
}

export function loadCubismCore(version: CubismVersion): Promise<void> {
  const { url, global } = CORE_URLS[version];
  if ((window as unknown as Record<string, unknown>)[global]) return Promise.resolve();
  const existing = pending.get(version);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onload = () =>
      (window as unknown as Record<string, unknown>)[global]
        ? resolve()
        : reject(new Error(`${global} did not initialize`));
    script.onerror = () => {
      script.remove();
      reject(new Error(`Unable to load ${url}`));
    };
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    pending.delete(version);
    throw error;
  });
  pending.set(version, promise);
  return promise;
}

/** 启动后空闲时预热：Core 脚本 + 库 chunk（失败静默，进入聊天页时会再试）。 */
export function prewarmLive2D(modelUrl: string) {
  const version = cubismVersionOf(modelUrl);
  void loadCubismCore(version)
    .then(() => (version === 2 ? import("pixi-live2d-display/cubism2") : import("pixi-live2d-display/cubism4")))
    .catch(() => {});
  void fetch(modelUrl, { cache: "force-cache" }).catch(() => {});
}
