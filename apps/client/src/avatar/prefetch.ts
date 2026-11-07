import { useEffect } from "react";
import { useModel } from "../characters";
import { prewarmLive2D } from "./live2d/runtime";

/** 应用启动后空闲时预热当前角色的 Live2D（Core 与库）；没有模型的角色什么也不做。 */
export function usePrefetchAvatar() {
  const model = useModel();
  const url = model?.url;
  useEffect(() => {
    if (!url) return;
    const run = () => prewarmLive2D(url);
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) idle(run, { timeout: 4000 });
    else window.setTimeout(run, 1500);
  }, [url]);
}
