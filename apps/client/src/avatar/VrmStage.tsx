import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { claimAvatar, setAvatarStatus } from "./avatar-state";
import { fetchModelBuffer } from "./model-cache";
import { StageStatus, type StagePhase } from "./StageStatus";
import type { AvatarEmotion } from "./model.config";

interface Props {
  modelUrl: string;
  emotion: AvatarEmotion;
  speaking: boolean;
  onReady?: () => void;
  onError?: (error: Error) => void;
}

/** 像素比上限 1.5：MToon 本身不吃超采样，2x 只是多花 78% 的填充率。 */
const MAX_DPR = 1.5;

const EXPRESSIONS = ["happy", "sad", "angry", "surprised", "relaxed"] as const;
const EMOTION_HOLD_MS = 6000;

/** 把情绪权重、口型和眨眼平滑地推向目标值。 */
function approach(current: number, target: number, rate: number, dt: number) {
  return current + (target - current) * Math.min(1, rate * dt);
}

/**
 * 舞台构图：VRM 与 Live2D 共用同一条规则，比例只写在 tokens.css。
 *   --stage-char-h    角色高度 / 可画区高度（见 tokens.css；手机在 chat.css 覆写）
 *   --stage-char-gap  底边离可画区底边的间隙 / 可画区高度
 *   --stage-char-max  角色最多占「对话框以上」的比例，空间不够就按这条缩
 * 分母取可画区（.scene__safe / 组件自己这块盒子），对话框再长也只是等比缩小，不换构图。
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
    ratio: num("--stage-char-h", 0.9),
    gap: num("--stage-char-gap", 0.05),
    maxFill: num("--stage-char-max", 0.96),
    top: num("--stage-char-top", 0.05),
    vrmH: num("--stage-vrm-h", 1.3),
  };
}

/**
 * 对话框安全区：把 .scene__chrome 的真实高度写进 --scene-safe，
 * .scene__figure 的 inset 用同一个变量，于是她的脚正好停在这条线上，
 * 腰以上永远在对话框之上（chat.css 里那套裁剪规则也读它）。
 */
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

/**
 * 灯组。参数放在这里而不是散在场景里：三盏灯各有一条职责，
 * 调的时候一次只动一组，截图对比（`window.__vrmRig = { key: 2.2 }` 可在控制台临时覆盖）。
 */
interface Rig {
  exposure: number;
  /** 环境光：打底。超过 0.6 阴影面就会顶到高光，脸和脖子糊成一片。 */
  ambient: number;
  /** 主光：正面偏上偏右，暖。要够亮，皮肤才不会掉进 MToon 的 shade 色。 */
  key: number;
  keyColor: number;
  keyPos: [number, number, number];
  /** 补光：左前方，冷，压住暗面的灰。 */
  fill: number;
  fillColor: number;
  fillPos: [number, number, number];
  /** 轮廓光：背后，勾头发外缘。 */
  rim: number;
  rimColor: number;
  rimPos: [number, number, number];
}

const DEFAULT_RIG: Rig = {
  exposure: 1.0,
  ambient: 0.42,
  key: 2.6,
  keyColor: 0xfff3e6,
  keyPos: [1.6, 1.7, 2.8],
  fill: 0.42,
  fillColor: 0xcfe2ff,
  fillPos: [-1.8, 0.8, 2.0],
  rim: 0.55,
  rimColor: 0x9be8ff,
  rimPos: [-1.6, 1.9, -1.6],
};

/** 控制台可临时覆盖：`window.__vrmRig = { key: 2.4 }`，刷新即生效。 */
function readRig(): Rig {
  const override = (window as unknown as { __vrmRig?: Partial<Rig> }).__vrmRig;
  return override ? { ...DEFAULT_RIG, ...override } : DEFAULT_RIG;
}

/**
 * MToon 的阴影色是烤在模型里的：很多二创模型把 shadeColor 调成了灰蓝，
 * 环境光一压低，脸和脖子就从「肤色」掉成「灰」。这里做两件小事：
 *   1. 阴影色往底色拉 30% —— 阴影保留色相，不再发灰；
 *   2. 硬边软一半 —— toon 的分界不明显，脸不会出现一条直愣愣的明暗线。
 * 只动材质参数，不碰贴图，所以不会改模。
 */
function softenMToon(root: THREE.Object3D) {
  const seen = new Set<unknown>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh & { material?: unknown };
    const raw = mesh.material as
      | { color?: THREE.Color; shadeColorFactor?: THREE.Color; shadingToonyFactor?: number }
      | undefined;
    // 这三个模型的材质是 VRM0/VRM1 两代 MToon，`isMToonMaterial` 标记不一定有；
    // 按属性判定更稳（shadeColorFactor 是 MToon 才有的）。
    if (!raw || seen.has(raw)) return;
    if (typeof raw.shadingToonyFactor !== "number") return;
    seen.add(raw);
    if (raw.color && raw.shadeColorFactor) raw.shadeColorFactor.lerp(raw.color, 0.3);
    if (typeof raw.shadingToonyFactor === "number") raw.shadingToonyFactor = Math.min(raw.shadingToonyFactor, 0.55);
  });
}

export function VrmStage({ modelUrl, emotion, speaking, onReady, onError }: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const live = useRef({ emotion: "neutral" as AvatarEmotion, speaking: false });
  const callbacks = useRef({ onReady, onError });
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<StagePhase>("loading");

  useEffect(() => {
    callbacks.current = { onReady, onError };
  }, [onReady, onError]);

  const retry = useCallback(() => {
    setAvatarStatus("loading");
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    live.current.speaking = speaking;
  }, [speaking]);

  useEffect(() => {
    live.current.emotion = emotion;
    if (emotion === "neutral") return;
    const timer = setTimeout(() => { live.current.emotion = "neutral"; }, EMOTION_HOLD_MS);
    return () => clearTimeout(timer);
  }, [emotion]);

  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const token = claimAvatar();
    setPhase("loading");

    // 关掉 MSAA：toon 描边/色块本来就是硬边，MSAA 在集成显卡上是最贵的一项。
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // 之前不做色调映射，高光直接削平：肤色和浅金发一起变成「灰白 + 银白」。
    // 换成 Neutral（Khronos PBR Neutral）而不是 ACES——它压高光但不抽色，皮肤和发色留得住；
    // 曝光 0.9 把整体压回 0.8–0.9 这一档，白裙子不再顶到 255。
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 0.9;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(26, 1, 0.05, 40);
    const rig = readRig();
    renderer.toneMappingExposure = rig.exposure;

    // 三盏灯各管一件事：环境打底（不能高，高了阴影面糊成一片）、
    // 主光塑造（正面偏上，脸才不落在 MToon 的 shade 带里）、
    // 补光提亮暗面（冷色，别让暗面掉进灰色）、轮廓光勾边（背后，把头发从纸上分出来）。
    // 半球光：上暖下冷，比纯环境光多一层「地上的反光」，脸不会整片糊平。
    scene.add(new THREE.HemisphereLight(0xfff6ea, 0xcfe0f2, rig.ambient));
    const key = new THREE.DirectionalLight(rig.keyColor, rig.key);
    key.position.set(...rig.keyPos);
    scene.add(key);
    const fill = new THREE.DirectionalLight(rig.fillColor, rig.fill);
    fill.position.set(...rig.fillPos);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(rig.rimColor, rig.rim);
    rim.position.set(...rig.rimPos);
    scene.add(rim);

    const lookTarget = new THREE.Object3D();
    scene.add(lookTarget);
    const pointer = { x: 0, y: 0 };
    const onPointer = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      pointer.x = THREE.MathUtils.clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1.5, 1.5);
      pointer.y = THREE.MathUtils.clamp(-(((event.clientY - rect.top) / rect.height) * 2 - 1), -1.5, 1.5);
    };
    window.addEventListener("pointermove", onPointer);

    let vrm: VRM | undefined;
    let disposed = false;
    let frame = 0;
    const clock = new THREE.Clock();
    const weights: Record<string, number> = { happy: 0, sad: 0, angry: 0, surprised: 0, relaxed: 0, aa: 0, blink: 0 };
    let nextBlink = 1.5;
    let blinkPhase = -1;
    let elapsed = 0;

    /**
     * 统一构图：整个人（头顶到脚底）约舞台高度的 --stage-char-h，
     * 水平按「头/躯干中轴」对齐舞台中线，脚底停在对话框安全线之上。
     */
    const fit = () => {
      if (!vrm) return;
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h) return;
      const { top, vrmH } = stageMetrics(host);
      // 全身模型取景到膝上：头顶留 top，整人高 vrmH 倍可画区，多出来的部分落到框外被裁掉
      // （框外正好是浪和对话框，看起来就是「站在水里」）。
      const topPx = top * h;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();

      const box = new THREE.Box3().setFromObject(vrm.scene);
      const size = box.getSize(new THREE.Vector3());
      const worldH = Math.max(size.y, 1e-3);
      /*
       * 放大倍数按模型自己的宽高比来：全身高瘦的（鲸汐、小智）取景到膝上，
       * 人能占满舞台、脸看得清；Q 版的（小克）必须整体入画，按 1.3 倍会把脑袋裁掉一半。
       */
      const aspect = worldH / Math.max(size.x, 1e-3);
      const zoom = THREE.MathUtils.clamp(0.88 + (aspect - 1.35) * 0.4, 0.88, vrmH);
      const targetPx = zoom * h;
      const head = vrm.humanoid.getNormalizedBoneNode("head");
      const headPos = head ? head.getWorldPosition(new THREE.Vector3()) : null;
      // 中轴取头部骨骼的 x：马尾、裙摆偏一边也不会把身体推歪。
      const centerX = headPos ? headPos.x : (box.min.x + box.max.x) / 2;

      const visibleH = (worldH * h) / targetPx;
      const dist = visibleH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      const perPx = visibleH / h;
      // 再往下压 2%：脚尖要落进浪里，别停在浪线上「悬」着（模型包围盒比脚底略大）。
      const bottomPx = topPx + targetPx + h * 0.02;
      // 脚底落在 bottomPx 处 → 反推镜头中心的 y
      const camY = box.min.y + (bottomPx - h / 2) * perPx;
      camera.near = 0.05;
      camera.far = dist + visibleH * 4;
      camera.position.set(centerX, camY, dist);
      camera.lookAt(centerX, camY, 0);
      if (headPos) lookTarget.position.set(headPos.x, headPos.y, Math.max(0.4, dist - 0.8));
    };

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host;
      if (!w || !h) return;
      // 窗口换屏（DPR 不同）后要重读，不能只在创建时读一次
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
      renderer.setSize(w, h, false);
      fit();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    const stopSafe = watchSafeArea(host, resize);

    const fail = (error: unknown) => {
      if (disposed) return;
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("VRM model load failed", err);
      stopLoop();
      setPhase("failed");
      setAvatarStatus("failed", token);
      callbacks.current.onError?.(err);
    };
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    void (async () => {
      try {
        // 二进制走 Cache Storage：第二次进入不再下载，直接解析
        const buffer = await fetchModelBuffer(modelUrl);
        if (disposed) return;
        const gltf = await new Promise<{ scene: THREE.Group; userData: Record<string, unknown> }>((resolve, reject) =>
          loader.parse(buffer, "", resolve as never, reject),
        );
        const loaded = gltf.userData.vrm as VRM | undefined;
        if (!loaded) throw new Error("not a VRM file");
        if (disposed) {
          VRMUtils.deepDispose(gltf.scene);
          return;
        }
        // 后处理拆到不同帧里，避免一整段主线程阻塞
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        await nextFrame();
        if (disposed) {
          VRMUtils.deepDispose(gltf.scene);
          return;
        }
        VRMUtils.combineSkeletons(gltf.scene);
        VRMUtils.rotateVRM0(loaded);
        vrm = loaded;
        softenMToon(loaded.scene);
        scene.add(loaded.scene);

        // 放下手臂（默认是 T 字站姿）；VRM 0.x 经 rotateVRM0 转过 180°，转动方向相反。
        const humanoid = loaded.humanoid;
        const armSign = loaded.meta.metaVersion === "0" ? 1 : -1;
        humanoid.getNormalizedBoneNode("leftUpperArm")?.rotation.set(0, 0, 1.3 * armSign);
        humanoid.getNormalizedBoneNode("rightUpperArm")?.rotation.set(0, 0, -1.3 * armSign);
        loaded.scene.updateMatrixWorld(true);
        fit();
        // 先渲染一帧（着色器编译发生在这里，此时画布还是透明的），再淡入
        vrm.update(0);
        renderer.render(scene, camera);
        await nextFrame();
        if (disposed) return;
        setPhase("ready");
        setAvatarStatus("ready", token);
        callbacks.current.onReady?.();
      } catch (error) {
        fail(error);
      }
    })();

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.1);
      elapsed += dt;
      if (!vrm) return;
      const expressions = vrm.expressionManager;

      if (expressions) {
        const wanted = live.current.emotion;
        for (const name of EXPRESSIONS) {
          weights[name] = approach(weights[name], wanted === name ? 1 : 0, 6, dt);
          if (expressions.getExpression(name)) expressions.setValue(name, weights[name]);
          else if (name === "surprised") expressions.setValue("oh", weights[name] * 0.7); // VRM 0.x 没有 surprised，用 “哦” 的口型
        }

        // 眨眼：随机间隔，一次约 0.18 秒。
        nextBlink -= dt;
        if (nextBlink <= 0 && blinkPhase < 0) blinkPhase = 0;
        if (blinkPhase >= 0) {
          blinkPhase += dt / 0.18;
          weights.blink = Math.sin(Math.min(blinkPhase, 1) * Math.PI);
          if (blinkPhase >= 1) { blinkPhase = -1; weights.blink = 0; nextBlink = 2 + Math.random() * 3.5; }
        }
        expressions.setValue("blink", weights.blink);

        // 说话时用 aa 做口型。
        const mouth = live.current.speaking ? (0.25 + 0.4 * Math.abs(Math.sin(elapsed * 9))) * (0.65 + 0.35 * Math.sin(elapsed * 3.1)) : 0;
        weights.aa = approach(weights.aa, mouth, 18, dt);
        expressions.setValue("aa", weights.aa);
      }

      if (!reduced) {
        const humanoid = vrm.humanoid;
        const breath = Math.sin(elapsed * 1.6);
        const spine = humanoid.getNormalizedBoneNode("spine");
        if (spine) spine.rotation.x = breath * 0.012;
        const chest = humanoid.getNormalizedBoneNode("chest");
        if (chest) chest.rotation.x = breath * 0.018;
        const neck = humanoid.getNormalizedBoneNode("neck");
        if (neck) {
          neck.rotation.y = approach(neck.rotation.y, pointer.x * 0.28, 4, dt);
          neck.rotation.x = approach(neck.rotation.x, -pointer.y * 0.12, 4, dt);
        }
        lookTarget.position.x = approach(lookTarget.position.x, camera.position.x + pointer.x * 0.8, 6, dt);
        lookTarget.position.y = approach(lookTarget.position.y, camera.position.y + pointer.y * 0.4, 6, dt);
      }

      vrm.update(dt);
      renderer.render(scene, camera);
    };

    // 页面隐藏或舞台离开视口时暂停 rAF，回来再继续
    let visible = true;
    const startLoop = () => {
      if (frame || disposed || document.hidden || !visible) return;
      clock.getDelta();
      frame = requestAnimationFrame(tick);
    };
    function stopLoop() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }
    const syncLoop = () => (document.hidden || !visible ? stopLoop() : startLoop());
    const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; syncLoop(); });
    io.observe(host);
    document.addEventListener("visibilitychange", syncLoop);
    startLoop();

    return () => {
      disposed = true;
      stopLoop();
      io.disconnect();
      document.removeEventListener("visibilitychange", syncLoop);
      stopSafe();
      window.removeEventListener("pointermove", onPointer);
      observer.disconnect();
      if (vrm) {
        scene.remove(vrm.scene);
        VRMUtils.deepDispose(vrm.scene);
      }
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [modelUrl, attempt]);

  return (
    <>
      <div className="vrm" ref={mount} aria-hidden data-stage={phase} />
      <StageStatus phase={phase} onRetry={retry} />
    </>
  );
}
