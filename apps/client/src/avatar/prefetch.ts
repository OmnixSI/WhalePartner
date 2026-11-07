import { useEffect } from "react";
import { useModel } from "../characters";
import { prewarmLive2D } from "./live2d/runtime";
import { prefetchModelWhenIdle } from "./model-cache";

/** 应用启动后空闲时预取当前角色的模型（VRM 写入 Cache Storage；Live2D 预热 Core 与库）。 */
export function usePrefetchAvatar() {
  const model = useModel();
  useEffect(() => {
    prefetchModelWhenIdle(model.url, model.renderer === "vrm", () => {
      if (model.renderer === "live2d") prewarmLive2D(model.url);
    });
  }, [model.url, model.renderer]);
}
