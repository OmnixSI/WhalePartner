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
const TAP_ACTIONS = [
  { motion: "Hammer", expression: "感叹号", durationMs: 4767 },
  { motion: "BubbleGum", expression: "吐舌", durationMs: 5000 },
  { motion: "SprayWater", expression: "流汗", durationMs: 1500 },
  { motion: "OpenCase", expression: "问号", durationMs: 2000 },
  { motion: "Selfie", expression: "爱心眼", durationMs: 3300 },
  { motion: "SelfieQuick", expression: "双手比耶", durationMs: 1600 },
  { motion: "Ketchup", expression: "调皮", durationMs: 5000 },
] as const;
/** 量墨迹最多试几帧；每帧一次 readPixels，量完立刻停。 */
const FIT_MAX_FRAMES = 90;

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

/**
 * 舞台构图：和 VrmStage 同一条规则，比例只写在 tokens.css。
 *   --stage-char-h    角色高度 / 可画区高度
 *   --stage-char-gap  底边离可画区底边的间隙 / 可画区高度
 *   --stage-char-max  角色最多占「对话框以上」的比例
 */
function stageMetrics(host: HTMLElement) {
  const scene = host.closest<HTMLElement>(".scene") ?? host;
  const css = getComputedStyle(scene);
  const num = (name: string, fallback: number) => {
    const value = parseFloat(css.getPropertyValue(name));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  // 分母是「可画区」= 舞台组件自己这块盒子（对话框以上）；整块舞台当分母会把角色撑到天花板。
  const stageH = host.clientHeight || scene.clientHeight;
  return {
    stageH,
    ratio: num("--stage-char-h", 0.6),
    gap: num("--stage-char-gap", 0.02),
    maxFill: num("--stage-char-max", 0.94),
  };
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

/** 画布上真正画出来的东西：范围 + 「头/躯干」那一段的水平中轴（尾巴不算中轴）。 */
interface Ink {
  top: number;
  bottom: number;
  bodyX: number;
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
    let actionTimer: number | undefined;
    let onPointerMove: ((event: PointerEvent) => void) | undefined;
    let removePointerListener: (() => void) | undefined;
    let mouthId: string | undefined;
    let removeDetach: (() => void) | undefined;
    let tapped = 0;
    let wasSpeaking = false;
    /** 还没量准就一直是 true；量准一次就关掉，之后只在改尺寸时重新打开。 */
    let fitting = true;
    let fitFrames = 0;
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

        modelRef.current = model;
        app.stage.addChild(model);

        const internal = model.internalModel as Cubism4InternalModel;
        const hasParameter = (id: string) => internal.coreModel.getParameterIndex(id) >= 0;
        mouthId = hasParameter("ParamMouthOpenY") ? "ParamMouthOpenY" : undefined;
        internal.on("afterMotionUpdate", coreUpdate);

        /**
         * 量一帧画布：Cubism 的遮挡/蒙版都在同一帧里画完，直接读帧缓冲最准
         * （getLocalBounds 会把尾巴和空白算进去，之前「偏左」就是这么来的）。
         */
        const measureInk = (): Ink | null => {
          if (!app || !model) return null;
          const gl = renderer.gl;
          const width = gl.drawingBufferWidth;
          const height = gl.drawingBufferHeight;
          if (!width || !height) return null;
          const buffer = new Uint8Array(width * height * 4);
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
          let minY = Infinity;
          let maxY = -Infinity;
          const rowMin: number[] = new Array(height).fill(Infinity);
          const rowMax: number[] = new Array(height).fill(-Infinity);
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              if (buffer[(y * width + x) * 4 + 3] < 8) continue;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
              if (x < rowMin[y]) rowMin[y] = x;
              if (x > rowMax[y]) rowMax[y] = x;
            }
          }
          if (!Number.isFinite(minY)) return null;
          // gl 的 y 轴朝上，换成 CSS 的「从上往下」
          const top = height - 1 - maxY;
          const bottom = height - 1 - minY;
          // 头 + 肩那一段：每行取左右边缘的中点，再平均。尾巴把宽度拉宽也不影响中轴。
          const bandFrom = Math.round(top + (bottom - top) * 0.06);
          const bandTo = Math.round(top + (bottom - top) * 0.42);
          const mids: number[] = [];
          for (let y = bandFrom; y <= bandTo; y++) {
            const glY = height - 1 - y;
            if (!Number.isFinite(rowMin[glY])) continue;
            mids.push((rowMin[glY] + rowMax[glY]) / 2);
          }
          if (mids.length === 0) return null;
          // 设备像素 → CSS 像素（Retina 上 resolution ≠ 1，用 screen 而不是 view 的像素宽）
          const cssX = renderer.screen.width / width;
          const cssY = renderer.screen.height / height;
          return {
            top: top * cssY,
            bottom: bottom * cssY,
            bodyX: (mids.reduce((sum, v) => sum + v, 0) / mids.length) * cssX,
          };
        };

        /** 先按模型 bounds 摆一个大概，再按量到的墨迹一次修正到位。 */
        const placeModel = () => {
          if (!app || !model || !host.clientWidth || !host.clientHeight) return;
          renderer.resize(host.clientWidth, host.clientHeight);
          const { stageH, ratio, gap, maxFill } = stageMetrics(host);
          const target = Math.min(ratio * stageH, host.clientHeight * maxFill);
          const bounds = model.getLocalBounds();
          const scale = target / Math.max(bounds.height, 1);
          model.anchor.set(0.5, 1);
          model.scale.set(scale);
          model.position.set(host.clientWidth / 2, host.clientHeight - gap * stageH);
          fitting = true;
          fitFrames = 0;
        };

        const correct = (ink: Ink) => {
          if (!model || !host.clientWidth) return;
          const { stageH, ratio, gap, maxFill } = stageMetrics(host);
          const target = Math.min(ratio * stageH, host.clientHeight * maxFill);
          const measured = ink.bottom - ink.top;
          if (measured < 8) return;
          const k = target / measured; // 还差多少比例
          // 围绕 anchor（p.x, p.y）缩放：墨迹也跟着缩，所以要把位移算在同一次里
          const anchorX = model.position.x;
          const anchorY = model.position.y;
          model.scale.set(model.scale.x * k);
          const bottomAfter = anchorY + (ink.bottom - anchorY) * k;
          const bodyAfter = anchorX + (ink.bodyX - anchorX) * k;
          const wantedBottom = host.clientHeight - gap * stageH;
          model.position.set(anchorX + (host.clientWidth / 2 - bodyAfter), anchorY + (wantedBottom - bottomAfter));
          if (Math.abs(k - 1) < 0.01) fitting = false;
        };

        const onPostRender = () => {
          if (!fitting || disposed) return;
          fitFrames += 1;
          if (fitFrames > FIT_MAX_FRAMES) { fitting = false; return; }
          const ink = measureInk();
          if (!ink || ink.bottom - ink.top < 32) return; // 还没画出来，等下一帧
          correct(ink);
        };
        renderer.on("postrender", onPostRender);

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
          const action = TAP_ACTIONS[tapped % TAP_ACTIONS.length];
          tapped += 1;
          if (actionTimer !== undefined) window.clearTimeout(actionTimer);
          void model?.motion(action.motion, 0, MotionPriority.FORCE);
          express(action.expression, action.durationMs);
          actionTimer = window.setTimeout(() => {
            if (!model) return;
            internal.motionManager.stopAllMotions();
            playIdle();
            actionTimer = undefined;
          }, action.durationMs);
        });

        onPointerMove = (event: PointerEvent) => {
          const rect = host.getBoundingClientRect();
          model?.focus(event.clientX - rect.left, event.clientY - rect.top);
        };
        window.addEventListener("pointermove", onPointerMove);
        removePointerListener = () => window.removeEventListener("pointermove", onPointerMove!);

        observer = new ResizeObserver(placeModel);
        observer.observe(host);
        placeModel();
        const stopSafe = watchSafeArea(host, placeModel);
        setAvatarStatus("ready");

        // 卸载时顺手摘掉 postrender 与安全区监听
        removeDetach = () => {
          renderer.off("postrender", onPostRender);
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
      if (expressionTimer !== undefined) window.clearTimeout(expressionTimer);
      if (actionTimer !== undefined) window.clearTimeout(actionTimer);
      reactRef.current = null;
      modelRef.current = null;
      removeDetach?.();
      observer?.disconnect();
      if (model) {
        model.internalModel.off("afterMotionUpdate", coreUpdate);
      }
      app?.destroy(true, { children: true, texture: false, baseTexture: false });
      removePointerListener?.();
    };
  }, [modelUrl]);

  return <div className="live2d" ref={mount} aria-hidden="true" />;
}
