import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { setAvatarStatus } from "./avatar-state";
import { AVATAR_MODEL, type AvatarEmotion } from "./model.config";

interface Props {
  emotion: AvatarEmotion;
  speaking: boolean;
}

const EXPRESSIONS = ["happy", "sad", "surprised", "relaxed"] as const;
const EMOTION_HOLD_MS = 6000;

/** 把情绪权重、口型和眨眼平滑地推向目标值。 */
function approach(current: number, target: number, rate: number, dt: number) {
  return current + (target - current) * Math.min(1, rate * dt);
}

export function VrmStage({ emotion, speaking }: Props) {
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
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 20);
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1.2, 2, 2.4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9be8ff, 0.9);
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

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let vrm: VRM | undefined;
    let disposed = false;
    let frame = 0;
    const clock = new THREE.Clock();
    const weights: Record<string, number> = { happy: 0, sad: 0, surprised: 0, relaxed: 0, aa: 0, blink: 0 };
    let nextBlink = 1.5;
    let blinkPhase = -1;
    let elapsed = 0;

    setAvatarStatus("loading");
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.load(
      AVATAR_MODEL.url,
      (gltf) => {
        const loaded = gltf.userData.vrm as VRM | undefined;
        if (disposed || !loaded) return;
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.combineSkeletons(gltf.scene);
        VRMUtils.rotateVRM0(loaded);
        vrm = loaded;
        scene.add(loaded.scene);

        // 放下手臂（默认是 T 字站姿），并按头部高度对准镜头。
        const humanoid = loaded.humanoid;
        humanoid.getNormalizedBoneNode("leftUpperArm")?.rotation.set(0, 0, -1.35);
        humanoid.getNormalizedBoneNode("rightUpperArm")?.rotation.set(0, 0, 1.35);
        loaded.scene.updateMatrixWorld(true);
        const head = humanoid.getNormalizedBoneNode("head");
        const headY = head ? head.getWorldPosition(new THREE.Vector3()).y : 1.4;
        camera.position.set(0, headY - 0.12, 2.3);
        camera.lookAt(0, headY - 0.2, 0);
        lookTarget.position.set(0, headY, 1.4);
        if (loaded.lookAt) loaded.lookAt.target = lookTarget;
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
          expressions.setValue(name, weights[name]);
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
        lookTarget.position.x = approach(lookTarget.position.x, pointer.x * 0.8, 6, dt);
        lookTarget.position.y = approach(lookTarget.position.y, camera.position.y + pointer.y * 0.4, 6, dt);
      }

      vrm.update(dt);
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointer);
      observer.disconnect();
      if (vrm) VRMUtils.deepDispose(vrm.scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div className="vrm" ref={mount} aria-hidden />;
}
