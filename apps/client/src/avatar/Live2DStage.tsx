import { useCallback, useEffect, useRef, useState } from "react";
import { install as installPixiUnsafeEval } from "@pixi/unsafe-eval";
import * as PIXI from "pixi.js";
import type { Live2DModel } from "pixi-live2d-display/cubism4";
import { claimAvatar, setAvatarStatus } from "./avatar-state";
import type { AvatarEmotion } from "./model.config";
import { chooseTapAction, EMOTION_EXPRESSIONS, loadTapActions, type TapAction } from "./live2d/actions";
import { createFrameGovernor } from "./live2d/frame-governor";
import { placeModel } from "./live2d/geometry";
import { classifyTap } from "./live2d/hit";
import { cubismVersionOf, loadCubismCore } from "./live2d/runtime";
import {
  FALLBACK_MS,
  initialTapState,
  reduceTap,
  type TapEffect,
  type TapEvent,
  type TapState,
} from "./live2d/tap-machine";
import { StageStatus, type StagePhase } from "./StageStatus";

installPixiUnsafeEval(PIXI);

interface Props {
  modelUrl: string;
  emotion: AvatarEmotion;
  speaking: boolean;
  failureMessage?: string;
  audioDriven?: boolean;
  audioLevel?: { current: number };
  onReady?: () => void;
  onError?: (error: Error) => void;
  /** 点到模型时通知外层一次（外层不再自己监听舞台点击，避免重复触发）。 */
  onTap?: () => void;
}

type Live2DWindow = Window & { PIXI?: typeof PIXI };

/** Cubism 2 / 4 的 coreModel 参数 API 不同，这里只用到口型。 */
interface MouthCore {
  getParameterIndex?: (id: string) => number;
  setParameterValueById?: (id: string, value: number) => void;
  getParamIndex?: (id: string) => number;
  setParamFloat?: (id: string, value: number) => void;
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

export function Live2DStage({ modelUrl, emotion, speaking, failureMessage, audioDriven = false, audioLevel, onReady, onError, onTap }: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const emotionRef = useRef(emotion);
  const speakingRef = useRef(speaking);
  const audioDrivenRef = useRef(audioDriven);
  const audioLevelRef = useRef(audioLevel);
  const reactRef = useRef<((value: AvatarEmotion) => void) | null>(null);
  /** 把 Live2D 从静置档叫醒（说话、换表情等从 props 来的变化用）。 */
  const wakeRef = useRef<(() => void) | null>(null);
  const callbacks = useRef({ onReady, onError, onTap });
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<StagePhase>("loading");

  useEffect(() => {
    callbacks.current = { onReady, onError, onTap };
  }, [onReady, onError, onTap]);

  useEffect(() => {
    emotionRef.current = emotion;
    reactRef.current?.(emotion);
    wakeRef.current?.();
  }, [emotion]);

  useEffect(() => {
    speakingRef.current = speaking;
    wakeRef.current?.();
  }, [speaking]);

  useEffect(() => {
    audioDrivenRef.current = audioDriven;
    audioLevelRef.current = audioLevel;
    wakeRef.current?.();
  }, [audioDriven, audioLevel]);

  const retry = useCallback(() => {
    setAvatarStatus("loading");
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    const host = mount.current;
    if (!host) return;

    // disposed 就是「取消标记」：StrictMode 双挂载 / 换角色时，旧一轮的每个 await 之后都先看它。
    let disposed = false;
    const token = claimAvatar();
    setPhase("loading");

    let app: PIXI.Application | undefined;
    let model: Live2DModel | undefined;
    let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
    const cleanups: Array<() => void> = [];
    let expressionTimer: number | undefined;
    let watchdogTimer: number | undefined;
    let layoutFrame: number | undefined;
    let governor: ReturnType<typeof createFrameGovernor> | undefined;
    let mouthId: string | undefined;
    let wasSpeaking = false;
    let tapActions: TapAction[] = [];
    let expressionNames: string[] = [];
    let tapState: TapState = initialTapState;
    const bounce = { start: 0, amp: 0, baseY: 0, baseScale: 1 };

    const mouthCore = () => (model?.internalModel as unknown as { coreModel?: MouthCore } | undefined)?.coreModel;
    const coreUpdate = () => {
      const core = mouthCore();
      if (!core || !mouthId) return;
      if (!speakingRef.current && !wasSpeaking) return;
      const open = speakingRef.current
        ? audioDrivenRef.current
          ? Math.min(1, 0.04 + (audioLevelRef.current?.current ?? 0) * 2.8)
          : 0.18 + 0.48 * Math.abs(Math.sin(performance.now() / 105))
        : 0;
      (core.setParameterValueById ?? core.setParamFloat)?.call(core, mouthId, open);
      wasSpeaking = speakingRef.current;
    };

    const fail = (error: unknown) => {
      if (disposed) return;
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("Live2D model load failed", err);
      setPhase("failed");
      setAvatarStatus("failed", token);
      callbacks.current.onError?.(err);
    };

    void (async () => {
      try {
        const version = cubismVersionOf(modelUrl);
        await loadCubismCore(version);
        if (disposed) return;

        // Cubism 2 / 4 各自一个入口；两个都类型兼容，这里统一按 cubism4 的类型使用。
        const lib = (await (version === 2
          ? import("pixi-live2d-display/cubism2")
          : import("pixi-live2d-display/cubism4"))) as typeof import("pixi-live2d-display/cubism4");
        if (disposed) return;

        (window as Live2DWindow).PIXI = PIXI;
        lib.Live2DModel.registerTicker(PIXI.Ticker);

        // 先加载模型（含全部纹理），再建 Application：加载期间不占 GL 上下文，
        // 并且 fit 是在纹理就绪之后才算的。
        const loaded = await lib.Live2DModel.from(modelUrl, { autoUpdate: true, autoInteract: false });
        if (disposed) {
          loaded.destroy({ children: true, texture: true, baseTexture: true });
          return;
        }
        model = loaded;

        app = new PIXI.Application({
          width: Math.max(1, host.clientWidth),
          height: Math.max(1, host.clientHeight),
          view: undefined,
          backgroundAlpha: 0,
          antialias: false,
          autoDensity: true,
          resolution: Math.min(window.devicePixelRatio || 1, 1.5),
          powerPreference: "high-performance",
          sharedTicker: true, // 与 Live2DModel 的自动更新共用同一个 ticker，只走一路 rAF
          autoStart: true,
        });
        host.appendChild(app.view as HTMLCanvasElement);
        const renderer = app.renderer as PIXI.Renderer;
        // InteractionManager 默认挂在 Ticker.system 上，每帧补算「光标不动、物体移过来」的 over/out；
        // 这里只用 pointertap，用不到它，却是一路常驻 60fps 的 rAF，页面隐藏也不停（#151 性能预算）
        (renderer.plugins.interaction as PIXI.InteractionManager).useSystemTicker = false;
        gl = renderer.gl;
        app.stage.addChild(model);

        const internal = model.internalModel as unknown as {
          on: (event: string, fn: () => void) => void;
          off: (event: string, fn: () => void) => void;
          motionManager: {
            expressionManager?: { resetExpression: () => void; definitions?: Array<{ Name?: string; name?: string }> };
            stopAllMotions: () => void;
            on: (event: string, fn: () => void) => void;
            off: (event: string, fn: () => void) => void;
          };
          coreModel: MouthCore;
        };
        const core = internal.coreModel;
        const mouthCandidates = ["ParamMouthOpenY", "PARAM_MOUTH_OPEN_Y"];
        mouthId = mouthCandidates.find((id) => ((core.getParameterIndex ?? core.getParamIndex)?.call(core, id) ?? -1) >= 0);
        internal.on("beforeModelUpdate", coreUpdate);
        cleanups.push(() => internal.off("beforeModelUpdate", coreUpdate));
        expressionNames = (internal.motionManager.expressionManager?.definitions ?? [])
          .map((d) => d.Name ?? d.name ?? "")
          .filter(Boolean);

        const scheduleLayout = () => {
          if (layoutFrame !== undefined) return;
          layoutFrame = window.requestAnimationFrame(() => {
            layoutFrame = undefined;
            if (!model || disposed) return;
            placeModel(host, renderer, model);
            bounce.baseY = model.y;
            bounce.baseScale = model.scale.x;
            governor?.wake();
          });
        };

        // 先摆位再 ready：不等 tap 动作。摆好之后下一帧再通知，保证第一帧已是正确构图。
        placeModel(host, renderer, model);
        bounce.baseY = model.y;
        bounce.baseScale = model.scale.x;
        const ro = new ResizeObserver(scheduleLayout);
        ro.observe(host);
        cleanups.push(() => ro.disconnect());
        cleanups.push(watchSafeArea(host, scheduleLayout));

        const MotionPriority = lib.MotionPriority;
        const playIdle = () => {
          if (model) void model.motion("Idle", 0, MotionPriority.IDLE).catch(() => {});
        };
        const setExpression = (name?: string) => {
          if (!model) return;
          if (!name) {
            internal.motionManager.expressionManager?.resetExpression();
            return;
          }
          void model.expression(name).catch(() => {});
        };
        const express = (name?: string, duration = 2200) => {
          if (!model) return;
          if (expressionTimer !== undefined) window.clearTimeout(expressionTimer);
          expressionTimer = undefined;
          setExpression(name);
          if (!name) return;
          expressionTimer = window.setTimeout(() => {
            expressionTimer = undefined;
            if (model && !disposed) internal.motionManager.expressionManager?.resetExpression();
          }, duration);
        };
        const react = (value: AvatarEmotion) => {
          if (tapState.phase === "acting") return;
          express(EMOTION_EXPRESSIONS[value]);
          governor?.wake();
        };
        reactRef.current = react;

        // ---- 点击状态机：纯函数 reduceTap 决定做什么，这里只负责执行 effect ----
        const runEffect = (effect: TapEffect) => {
          if (!model || disposed) return;
          if (effect.type === "play") {
            if (expressionTimer !== undefined) window.clearTimeout(expressionTimer);
            expressionTimer = undefined;
            // 100ms 内必有可见反应：先弹一下，动作/表情随后叠上
            bounce.start = performance.now();
            bounce.amp = effect.fallback.bounce;
            const { action, fallback, seq } = effect;
            const showFallback = () => {
              if (seq !== tapState.seq) return;
              if (fallback.expression) setExpression(fallback.expression);
            };
            if (!action) {
              showFallback();
              return;
            }
            void (async () => {
              if (action.expression) await model?.expression(action.expression).catch(() => false);
              if (!model || disposed || seq !== tapState.seq) return;
              const started = await model.motion(action.group, action.index, MotionPriority.FORCE);
              if (!started) showFallback();
            })().catch((error: unknown) => {
              console.warn("Live2D interaction motion failed", error);
              showFallback();
            });
            return;
          }
          // reset
          if (effect.reason !== "finished") {
            internal.motionManager.stopAllMotions();
            playIdle();
          }
          if (expressionTimer !== undefined) window.clearTimeout(expressionTimer);
          expressionTimer = undefined;
          internal.motionManager.expressionManager?.resetExpression();
          react(emotionRef.current);
        };
        const armWatchdog = () => {
          if (watchdogTimer !== undefined) window.clearTimeout(watchdogTimer);
          watchdogTimer = undefined;
          if (tapState.phase !== "acting") return;
          watchdogTimer = window.setTimeout(() => {
            watchdogTimer = undefined;
            dispatch({ type: "tick", now: performance.now() });
          }, Math.max(0, tapState.deadline - performance.now()) + 5);
        };
        const dispatch = (event: TapEvent) => {
          const result = reduceTap(tapState, event, {
            actions: tapActions,
            expressions: expressionNames,
            random: Math.random,
            choose: chooseTapAction,
          });
          tapState = result.state;
          // 待机动作每播完一段也会发 motionFinish，不能算「有人在玩」；只有点击才唤醒（动作期间由 isBusy 撑住）
          if (event.type === "tap") governor?.wake();
          result.effects.forEach(runEffect);
          armWatchdog();
        };
        const onMotionFinish = () => dispatch({ type: "motionFinish", seq: tapState.seq });
        internal.motionManager.on("motionFinish", onMotionFinish);
        cleanups.push(() => internal.motionManager.off("motionFinish", onMotionFinish));
        cleanups.push(() => dispatch({ type: "dispose" }));

        // 弹跳：直接改 model 的位置/缩放，和渲染共用同一个 ticker
        const bounceTick = () => {
          if (!model || bounce.amp <= 0) return;
          const t = (performance.now() - bounce.start) / FALLBACK_MS;
          if (t >= 1) {
            bounce.amp = 0;
            model.y = bounce.baseY;
            model.scale.set(bounce.baseScale);
            return;
          }
          const wave = Math.sin(Math.PI * Math.min(1, t * 2.2)) * (1 - t);
          model.y = bounce.baseY - wave * bounce.amp * host.clientHeight;
          model.scale.set(bounce.baseScale * (1 + wave * bounce.amp * 0.8));
        };
        // 共享 ticker 不会随 app.destroy 清掉监听：卸载时自己摘下，免得每来一次漏一个闭包、还去改已销毁的模型。
        const ticker = app.ticker;
        ticker.add(bounceTick);
        cleanups.push(() => ticker.remove(bounceTick));

        model.interactive = true;
        model.buttonMode = true;
        model.cursor = "pointer";
        const local = model.getLocalBounds();
        model.hitArea = new PIXI.Rectangle(local.x, local.y, local.width, local.height);
        model.on("pointertap", (event: PIXI.InteractionEvent) => {
          if (!model) return;
          const { x, y } = event.data.global;
          const names = (model as unknown as { hitTest: (x: number, y: number) => string[] }).hitTest(x, y);
          const b = model.getBounds();
          dispatch({ type: "tap", now: performance.now(), region: classifyTap(names, b, y) });
          callbacks.current.onTap?.();
        });

        // 视线：除掉祖先 CSS transform 的缩放，并且按帧节流
        let gaze: { x: number; y: number } | null = null;
        let gazeFrame: number | undefined;
        const onPointerMove = (event: PointerEvent) => {
          gaze = { x: event.clientX, y: event.clientY };
          governor?.wake();
          if (gazeFrame !== undefined) return;
          gazeFrame = window.requestAnimationFrame(() => {
            gazeFrame = undefined;
            if (!model || !gaze) return;
            const rect = host.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            model.focus(
              ((gaze.x - rect.left) / rect.width) * host.clientWidth,
              ((gaze.y - rect.top) / rect.height) * host.clientHeight,
            );
          });
        };
        window.addEventListener("pointermove", onPointerMove, { passive: true });
        cleanups.push(() => {
          window.removeEventListener("pointermove", onPointerMove);
          if (gazeFrame !== undefined) window.cancelAnimationFrame(gazeFrame);
        });

        // 帧率调度：有动静按刷新率画；静置 2.5 秒后降到 ~10fps（定时器手动推帧，rAF 为 0）；
        // 窗口隐藏 / 舞台离开视口时全停。说话、点击动作、弹跳期间不降档。
        let visible = true;
        const gov = createFrameGovernor({
          ticker: app.ticker,
          isHidden: () => document.hidden || !visible,
          isBusy: () => speakingRef.current || wasSpeaking || tapState.phase === "acting" || bounce.amp > 0,
        });
        governor = gov;
        wakeRef.current = gov.wake;
        const sync = () => gov.sync();
        const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
        io.observe(host);
        document.addEventListener("visibilitychange", sync);
        cleanups.push(() => { gov.dispose(); wakeRef.current = null; io.disconnect(); document.removeEventListener("visibilitychange", sync); });

        playIdle();
        react(emotionRef.current);

        // tap 动作放后台加载；加载完成前点击走兜底反应
        void loadTapActions(internal.motionManager as never)
          .then((actions) => { if (!disposed) tapActions = actions; })
          .catch(() => {});

        // 摆位后的下一帧再报 ready，淡入从正确构图开始
        app.ticker.addOnce(() => {
          if (disposed) return;
          setPhase("ready");
          setAvatarStatus("ready", token);
          callbacks.current.onReady?.();
        });
      } catch (error) {
        fail(error);
      }
    })();

    return () => {
      disposed = true;
      if (layoutFrame !== undefined) window.cancelAnimationFrame(layoutFrame);
      if (expressionTimer !== undefined) window.clearTimeout(expressionTimer);
      if (watchdogTimer !== undefined) window.clearTimeout(watchdogTimer);
      reactRef.current = null;
      cleanups.forEach((fn) => { try { fn(); } catch { /* 清理尽力而为 */ } });
      try {
        if (model && app) app.stage.removeChild(model);
        model?.destroy({ children: true, texture: true, baseTexture: true });
        app?.destroy(true, { children: true, texture: true, baseTexture: true });
        gl?.getExtension("WEBGL_lose_context")?.loseContext();
      } catch (error) {
        console.warn("Live2D dispose failed", error);
      }
      host.replaceChildren();
    };
  }, [modelUrl, attempt]);

  return (
    <>
      <div className="live2d" ref={mount} aria-hidden="true" data-stage={phase} />
      <StageStatus phase={phase} onRetry={retry} failureMessage={failureMessage} />
    </>
  );
}
