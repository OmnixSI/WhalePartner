import { useEffect, useRef } from "react";
import { install as installPixiUnsafeEval } from "@pixi/unsafe-eval";
import * as PIXI from "pixi.js";
import type { Cubism4InternalModel, Live2DModel } from "pixi-live2d-display/cubism4";
import { setAvatarStatus } from "./avatar-state";
import type { AvatarEmotion } from "./model.config";
import { chooseTapAction, EMOTION_EXPRESSIONS, loadTapActions } from "./live2d/actions";
import { placeModel } from "./live2d/geometry";

installPixiUnsafeEval(PIXI);

interface Props {
  modelUrl: string;
  emotion: AvatarEmotion;
  speaking: boolean;
}

const CORE_URL = "/live2d/libs/live2dcubismcore.min.js";
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

/** 对话框安全区：把 .scene__chrome 的真实高度写成 --scene-safe（chat.css 的裁剪规则读同一个变量）。 */
function watchSafeArea(host: HTMLElement, onChange: () => void) {
  const scene = host.closest<HTMLElement>(".scene");
  const chrome = host.closest<HTMLElement>(".room__main")?.querySelector<HTMLElement>(".scene__chrome");
  if (!scene || !chrome) return () => {};
  const apply = () => {
    // 手机把 .scene__chrome 放回文档流（舞台下面），那时它不遮舞台，可画区就是整块。
    const overlays = getComputedStyle(chrome).position === "absolute";
    const px = overlays ? Math.round(chrome.getBoundingClientRect().height) : 0;
    scene.style.setProperty("--scene-safe", `${px}px`);
    onChange();
  };
  const observer = new ResizeObserver(apply);
  observer.observe(chrome);
  apply();
  return () => observer.disconnect();
}

export function Live2DStage({ modelUrl, emotion, speaking }: Props) {
  const mount = useRef<HTMLDivElement>(null);
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
    let removeMotionFinishListener: (() => void) | undefined;
    let onPointerMove: ((event: PointerEvent) => void) | undefined;
    let removePointerListener: (() => void) | undefined;
    let mouthId: string | undefined;
    let removeDetach: (() => void) | undefined;
    let layoutFrame: number | undefined;
    let tapActions: Awaited<ReturnType<typeof loadTapActions>> = [];
    let actionActive = false;
    let wasSpeaking = false;
    const coreUpdate = () => {
      if (!model || !mouthId) return;
      if (!speakingRef.current && !wasSpeaking) return;
      const core = (model.internalModel as Cubism4InternalModel).coreModel;
      const now = performance.now();
      const open = speakingRef.current ? 0.18 + 0.48 * Math.abs(Math.sin(now / 105)) : 0;
      core.setParameterValueById(mouthId, open);
      wasSpeaking = speakingRef.current;
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
        const renderer = app.renderer as PIXI.Renderer;

        model = await Live2DModel.from(modelUrl, { autoUpdate: true, autoInteract: false });
        if (disposed || !app) {
          model.destroy({ children: true, texture: false, baseTexture: false });
          return;
        }

        app.stage.addChild(model);

        const internal = model.internalModel as Cubism4InternalModel;
        const hasParameter = (id: string) => internal.coreModel.getParameterIndex(id) >= 0;
        mouthId = hasParameter("ParamMouthOpenY") ? "ParamMouthOpenY" : undefined;
        internal.on("beforeModelUpdate", coreUpdate);
        tapActions = await loadTapActions(internal.motionManager);
        if (disposed) return;

        const scheduleLayout = () => {
          if (layoutFrame !== undefined) return;
          layoutFrame = window.requestAnimationFrame(() => {
            layoutFrame = undefined;
            if (model && !disposed) placeModel(host, renderer, model);
          });
        };

        const playIdle = () => {
          if (model) void model.motion("Idle", 0, MotionPriority.IDLE);
        };
        const setExpression = (name?: string) => {
          if (!model) return;
          if (!name) {
            internal.motionManager.expressionManager?.resetExpression();
            return;
          }
          void model.expression(name);
        };
        const express = (name?: string, duration = 2200) => {
          if (!model || actionActive) return;
          if (expressionTimer !== undefined) window.clearTimeout(expressionTimer);
          setExpression(name);
          if (!name) return;
          expressionTimer = window.setTimeout(() => {
            if (model) internal.motionManager.expressionManager?.resetExpression();
            expressionTimer = undefined;
          }, duration);
        };
        const react = (value: AvatarEmotion) => {
          if (actionActive) return;
          express(EMOTION_EXPRESSIONS[value]);
        };
        reactRef.current = react;
        playIdle();
        react(emotionRef.current);

        model.interactive = true;
        model.buttonMode = true;
        const bounds = model.getLocalBounds();
        model.hitArea = new PIXI.Rectangle(bounds.x, bounds.y, bounds.width, bounds.height);
        model.on("pointertap", () => {
          if (actionActive || !model) return;
          const action = chooseTapAction(tapActions);
          if (!action) return;

          if (expressionTimer !== undefined) window.clearTimeout(expressionTimer);
          expressionTimer = undefined;
          actionActive = true;

          const finishAction = (restoreIdle: boolean) => {
            if (!actionActive) return;
            actionActive = false;
            removeMotionFinishListener?.();
            removeMotionFinishListener = undefined;
            if (expressionTimer !== undefined) window.clearTimeout(expressionTimer);
            expressionTimer = undefined;
            if (restoreIdle) playIdle();
            react(emotionRef.current);
          };

          const motionEvents = internal.motionManager as unknown as {
            on: (event: string, listener: () => void) => unknown;
            off: (event: string, listener: () => void) => unknown;
          };
          const onMotionFinish = () => finishAction(false);
          motionEvents.on("motionFinish", onMotionFinish);
          removeMotionFinishListener = () => motionEvents.off("motionFinish", onMotionFinish);
          void (async () => {
            if (action.expression) await model?.expression(action.expression);
            if (!model || disposed || !actionActive) return;
            const started = await model.motion(action.group, action.index, MotionPriority.FORCE);
            if (!started) finishAction(true);
          })().catch((error: unknown) => {
            console.warn("Live2D interaction motion failed", error);
            finishAction(true);
          });
        });

        onPointerMove = (event: PointerEvent) => {
          const rect = host.getBoundingClientRect();
          model?.focus(event.clientX - rect.left, event.clientY - rect.top);
        };
        window.addEventListener("pointermove", onPointerMove);
        removePointerListener = () => window.removeEventListener("pointermove", onPointerMove!);

        observer = new ResizeObserver(scheduleLayout);
        observer.observe(host);
        const stopSafe = watchSafeArea(host, scheduleLayout);
        scheduleLayout();
        setAvatarStatus("ready");

        // 卸载时移除安全区监听。
        removeDetach = () => {
          stopSafe();
        };
      } catch (error) {
        if (!disposed) {
          console.error("Live2D model load failed", error);
          setAvatarStatus("failed");
        }
      }
    })();

    return () => {
      disposed = true;
      if (layoutFrame !== undefined) window.cancelAnimationFrame(layoutFrame);
      if (expressionTimer !== undefined) window.clearTimeout(expressionTimer);
      actionActive = false;
      removeMotionFinishListener?.();
      reactRef.current = null;
      removeDetach?.();
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
