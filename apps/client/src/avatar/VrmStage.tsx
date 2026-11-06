import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { setAvatarStatus } from "./avatar-state";
import type { AvatarEmotion } from "./model.config";

interface Props {
  modelUrl: string;
  emotion: AvatarEmotion;
  speaking: boolean;
}

const EXPRESSIONS = ["happy", "sad", "angry", "surprised", "relaxed"] as const;
const EMOTION_HOLD_MS = 6000;

/** 把情绪权重、口型和眨眼平滑地推向目标值。 */
function approach(current: number, target: number, rate: number, dt: number) {
  return current + (target - current) * Math.min(1, rate * dt);
}

/**
 * 舞台构图：VRM 与 Live2D 共用同一条规则，比例只写在 tokens.css。
 *   --stage-char-h    角色高度 / 舞台高度（desktop .6，手机 .9，见 chat.css）
 *   --stage-char-gap  底边离安全线的间隙 / 舞台高度
 *   --stage-char-max  角色最多占「对话框以上」的比例，空间不够就按这条缩
 * 舞台高度取 .scene（整块舞台），所以对话框再长，人物也只是等比缩小，不会换构图。
 */
function stageMetrics(host: HTMLElement) {
  const scene = host.closest<HTMLElement>(".scene") ?? host;
  const css = getComputedStyle(scene);
  const num = (name: string, fallback: number) => {
    const value = parseFloat(css.getPropertyValue(name));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  const stageH = scene.clientHeight || host.clientHeight;
  return {
    stageH,
    ratio: num("--stage-char-h", 0.6),
    gap: num("--stage-char-gap", 0.02),
    maxFill: num("--stage-char-max", 0.94),
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
    const px = Math.round(chrome.getBoundingClientRect().height);
    if (px <= 0) return;
    scene.style.setProperty("--scene-safe", `${px}px`);
    onChange();
  };
  const observer = new ResizeObserver(apply);
  observer.observe(chrome);
  apply();
  return () => observer.disconnect();
}

export function VrmStage({ modelUrl, emotion, speaking }: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const live = useRef({ emotion: "neutral" as AvatarEmotion, speaking: false });

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

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // 之前不做色调映射，高光直接削平：肤色和浅金发一起变成「灰白 + 银白」。
    // 换成 Neutral（Khronos PBR Neutral）而不是 ACES——它压高光但不抽色，皮肤和发色留得住；
    // 曝光 0.9 把整体压回 0.8–0.9 这一档，白裙子不再顶到 255。
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 0.9;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(26, 1, 0.05, 40);
    // 环境光 0.9 → 0.78：这一档抬高会把阴影面也顶到高光，脸和脖子就糊成一片；
    // 但留够补光，皮肤才不会掉进 MToon 的 shade 色（那才是「发灰」的来源）。
    scene.add(new THREE.AmbientLight(0xffffff, 0.78));
    // 主光 1.6 → 1.3（−19%，按评审的「主光降 20%」），前移到 (1.0, 1.4, 3.0)：
    // 脸原本落在 toon 的阴影带里，正面受光后皮肤才回到 lit 色，下颌和脖子留下层次。
    const key = new THREE.DirectionalLight(0xfff4e8, 1.3);
    key.position.set(1.0, 1.4, 3.0);
    scene.add(key);
    // 轮廓光 0.9 → 0.3（−67%）：浅金发原来被这盏冷光打成银白，现在只勾一圈边。
    const rim = new THREE.DirectionalLight(0x9be8ff, 0.3);
    rim.position.set(-2, 1.4, -1.5);
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
      const { stageH, ratio, gap, maxFill } = stageMetrics(host);
      const targetPx = Math.min(ratio * stageH, h * maxFill);
      const gapPx = gap * stageH;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();

      const box = new THREE.Box3().setFromObject(vrm.scene);
      const size = box.getSize(new THREE.Vector3());
      const worldH = Math.max(size.y, 1e-3);
      const head = vrm.humanoid.getNormalizedBoneNode("head");
      const headPos = head ? head.getWorldPosition(new THREE.Vector3()) : null;
      // 中轴取头部骨骼的 x：马尾、裙摆偏一边也不会把身体推歪。
      const centerX = headPos ? headPos.x : (box.min.x + box.max.x) / 2;

      const visibleH = (worldH * h) / targetPx;
      const dist = visibleH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      const perPx = visibleH / h;
      const bottomPx = h - gapPx;
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
      renderer.setSize(w, h, false);
      fit();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    const stopSafe = watchSafeArea(host, resize);

    setAvatarStatus("loading");
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.load(
      modelUrl,
      (gltf) => {
        const loaded = gltf.userData.vrm as VRM | undefined;
        if (disposed || !loaded) return;
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.combineSkeletons(gltf.scene);
        VRMUtils.rotateVRM0(loaded);
        vrm = loaded;
        scene.add(loaded.scene);

        // 放下手臂（默认是 T 字站姿）；VRM 0.x 经 rotateVRM0 转过 180°，转动方向相反。
        const humanoid = loaded.humanoid;
        const armSign = loaded.meta.metaVersion === "0" ? 1 : -1;
        humanoid.getNormalizedBoneNode("leftUpperArm")?.rotation.set(0, 0, 1.3 * armSign);
        humanoid.getNormalizedBoneNode("rightUpperArm")?.rotation.set(0, 0, -1.3 * armSign);
        loaded.scene.updateMatrixWorld(true);
        fit();
        setAvatarStatus("ready");
      },
      undefined,
      () => setAvatarStatus("failed"),
    );

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
    frame = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      stopSafe();
      window.removeEventListener("pointermove", onPointer);
      observer.disconnect();
      if (vrm) VRMUtils.deepDispose(vrm.scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [modelUrl]);

  return <div className="vrm" ref={mount} aria-hidden />;
}
