import { useEffect, useRef } from "react";
import { install as installPixiUnsafeEval } from "@pixi/unsafe-eval";
import * as PIXI from "pixi.js";
import type { Cubism4InternalModel, Live2DModel } from "pixi-live2d-display/cubism4";
import { setAvatarStatus } from "./avatar-state";
import type { AvatarEmotion } from "./model.config";

installPixiUnsafeEval(PIXI);

interface Props {
  modelUrl: string;
  emotion: AvatarEmotion;
  speaking: boolean;
}

const CORE_URL = "/live2d/libs/live2dcubismcore.min.js";
const EMOTION_EXPRESSIONS: Partial<Record<AvatarEmotion, string>> = {
  happy: "开心兴奋",
  sad: "悲伤",
  angry: "生气",
  surprised: "问号",
  relaxed: "脸红",
};

type Live2DWindow = Window & {
  Live2DCubismCore?: unknown;
  PIXI?: typeof PIXI;
};

function loadCubismCore() {
  const liveWindow = window as Live2DWindow;
  if (liveWindow.Live2DCubismCore) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CORE_URL;
    script.onload = () => liveWindow.Live2DCubismCore
      ? resolve()
      : reject(new Error("Cubism Core did not initialize"));
    script.onerror = () => reject(new Error(`Unable to load ${CORE_URL}`));
    document.head.appendChild(script);
  });
}

export function Live2DStage({ modelUrl, emotion, speaking }: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const modelRef = useRef<Live2DModel | null>(null);
  const emotionRef = useRef(emotion);
  const speakingRef = useRef(speaking);
  const reactRef = useRef<((value: AvatarEmotion) => void) | null>(null);

  useEffect(() => {
    emotionRef.current = emotion;
    reactRef.current?.(emotion);
  }, [emotion]);

  useEffect(() => {
    speakingRef.current = speaking;
  }, [speaking]);

  useEffect(() => {
    const host = mount.current;
    if (!host) return;

    let disposed = false;
    let app: PIXI.Application | undefined;
    let model: Live2DModel | undefined;
    let observer: ResizeObserver | undefined;
    let expressionTimer: number | undefined;
    let onPointerMove: ((event: PointerEvent) => void) | undefined;
    let removePointerListener: (() => void) | undefined;
    let mouthId: string | undefined;
    let tapped = 0;
    const coreUpdate = () => {
      if (!model || !mouthId) return;
      const core = (model.internalModel as Cubism4InternalModel).coreModel;
      const now = performance.now();
      const open = speakingRef.current ? 0.18 + 0.48 * Math.abs(Math.sin(now / 105)) : 0;
      core.addParameterValueById(mouthId, open);
    };

    setAvatarStatus("loading");
    void (async () => {
      try {
        await loadCubismCore();
        if (disposed) return;

        const { Live2DModel, MotionPriority } = await import("pixi-live2d-display/cubism4");
        if (disposed) return;

        const liveWindow = window as Live2DWindow;
        liveWindow.PIXI = PIXI;
        Live2DModel.registerTicker(PIXI.Ticker);
        app = new PIXI.Application({
          width: Math.max(1, host.clientWidth),
          height: Math.max(1, host.clientHeight),
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
        });
        host.appendChild(app.view);

        model = await Live2DModel.from(modelUrl, { autoUpdate: true, autoInteract: false });
        if (disposed || !app) {
          model.destroy({ children: true, texture: false, baseTexture: false });
          return;
        }

        modelRef.current = model;
        app.stage.addChild(model);

        const internal = model.internalModel as Cubism4InternalModel;
        const hasParameter = (id: string) => internal.coreModel.getParameterIndex(id) >= 0;
        mouthId = hasParameter("ParamMouthOpenY") ? "ParamMouthOpenY" : undefined;
        internal.on("beforeModelUpdate", coreUpdate);

        const placeModel = () => {
          if (!app || !model || !host.clientWidth || !host.clientHeight) return;
          app.renderer.resize(host.clientWidth, host.clientHeight);
          const bounds = model.getLocalBounds();
          const scale = Math.min((host.clientWidth * 0.92) / bounds.width, (host.clientHeight * 0.84) / bounds.height);
          model.anchor.set(0.5, 1);
          model.scale.set(scale);
          model.position.set(host.clientWidth / 2, host.clientHeight * 0.95);
        };

        const playIdle = () => {
          if (model) void model.motion("Idle", 0, MotionPriority.IDLE);
        };
        const express = (name?: string, duration = 2200) => {
          if (!model) return;
          if (expressionTimer !== undefined) window.clearTimeout(expressionTimer);
          if (!name) {
            internal.motionManager.expressionManager?.resetExpression();
            return;
          }
          void model.expression(name);
          expressionTimer = window.setTimeout(() => {
            if (model) internal.motionManager.expressionManager?.resetExpression();
          }, duration);
        };
        const react = (value: AvatarEmotion) => {
          express(EMOTION_EXPRESSIONS[value]);
        };
        reactRef.current = react;
        playIdle();
        react(emotionRef.current);

        model.interactive = true;
        model.buttonMode = true;
        model.on("pointertap", () => {
          express(tapped % 2 === 0 ? "调皮" : "爱心眼", 1600);
          tapped += 1;
        });

        onPointerMove = (event: PointerEvent) => {
          const rect = host.getBoundingClientRect();
          model?.focus(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            1 - ((event.clientY - rect.top) / rect.height) * 2,
          );
        };
        host.addEventListener("pointermove", onPointerMove);
        removePointerListener = () => host.removeEventListener("pointermove", onPointerMove!);

        observer = new ResizeObserver(placeModel);
        observer.observe(host);
        placeModel();
        setAvatarStatus("ready");

      } catch (error) {
        if (!disposed) {
          console.error("Live2D model load failed", error);
          setAvatarStatus("failed");
        }
      }
    })();

    return () => {
      disposed = true;
      if (expressionTimer !== undefined) window.clearTimeout(expressionTimer);
      reactRef.current = null;
      modelRef.current = null;
      observer?.disconnect();
      if (model) {
        model.internalModel.off("beforeModelUpdate", coreUpdate);
      }
      app?.destroy(true, { children: true, texture: false, baseTexture: false });
      removePointerListener?.();
    };
  }, [modelUrl]);

  return <div className="live2d" ref={mount} aria-hidden="true" />;
}
