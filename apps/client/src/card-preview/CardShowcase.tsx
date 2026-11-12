import { lazy, Suspense, useEffect, useState, type PointerEvent } from "react";
// 按需加载：静态 import 会让 pixi 落进两个入口共享的 chunk，连带进主应用首屏（#151 性能预算）
const Live2DStage = lazy(() => import("../avatar/Live2DStage").then((m) => ({ default: m.Live2DStage })));
import type { AvatarEmotion } from "../avatar/model.config";
import { CharacterMark } from "../components/CharacterMark";
import { CardParticles } from "./CardParticles";
import { RELATIONSHIP_SAMPLES, type CardCharacter, type RelationshipProgress, type RelationshipSample } from "./data";
import "./card-showcase.css";

type Props = {
  character: CardCharacter;
  sample: RelationshipSample;
  showProgress?: boolean;
  relationship?: RelationshipProgress | null;
  relationshipStatus?: "loading" | "error";
};

const EXPRESSIONS: ReadonlyArray<{ value: AvatarEmotion; label: string }> = [
  { value: "neutral", label: "自然" },
  { value: "happy", label: "开心" },
  { value: "surprised", label: "惊讶" },
  { value: "relaxed", label: "害羞" },
  { value: "sad", label: "难过" },
];

function updateTilt(event: PointerEvent<HTMLElement>, level: number) {
  if (level < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    resetTilt(event);
    return;
  }
  if (event.pointerType === "touch" && event.buttons === 0) return;
  const rect = event.currentTarget.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width - 0.5;
  const y = (event.clientY - rect.top) / rect.height - 0.5;
  event.currentTarget.dataset.tiltX = x.toFixed(3);
  event.currentTarget.dataset.tiltY = y.toFixed(3);
  event.currentTarget.style.setProperty("--tilt-x", `${-y * 18}deg`);
  event.currentTarget.style.setProperty("--tilt-y", `${x * 24}deg`);
  event.currentTarget.style.setProperty("--light-x", `${(x + 0.5) * 100}%`);
  event.currentTarget.style.setProperty("--light-y", `${(y + 0.5) * 100}%`);
  event.currentTarget.style.setProperty("--parallax-back-x", `${-x * 36}px`);
  event.currentTarget.style.setProperty("--parallax-back-y", `${-y * 26}px`);
  event.currentTarget.style.setProperty("--parallax-light-x", `${x * 48}px`);
  event.currentTarget.style.setProperty("--parallax-light-y", `${y * 36}px`);
  event.currentTarget.style.setProperty("--parallax-model-x", `${x * 24}px`);
  event.currentTarget.style.setProperty("--parallax-model-y", `${y * 18}px`);
}

function resetTilt(event: PointerEvent<HTMLElement>) {
  event.currentTarget.style.setProperty("--tilt-x", "0deg");
  event.currentTarget.style.setProperty("--tilt-y", "0deg");
  event.currentTarget.style.setProperty("--light-x", "50%");
  event.currentTarget.style.setProperty("--light-y", "35%");
  event.currentTarget.dataset.tiltX = "0";
  event.currentTarget.dataset.tiltY = "0";
  event.currentTarget.style.setProperty("--parallax-back-x", "0px");
  event.currentTarget.style.setProperty("--parallax-back-y", "0px");
  event.currentTarget.style.setProperty("--parallax-light-x", "0px");
  event.currentTarget.style.setProperty("--parallax-light-y", "0px");
  event.currentTarget.style.setProperty("--parallax-model-x", "0px");
  event.currentTarget.style.setProperty("--parallax-model-y", "0px");
}

export function CardShowcase({ character, sample, showProgress = true, relationship, relationshipStatus }: Props) {
  const [emotion, setEmotion] = useState<AvatarEmotion>("neutral");
  const [stage, setStage] = useState<"loading" | "ready" | "failed" | "static">(character.model ? "loading" : "static");
  const [tapCount, setTapCount] = useState(0);
  const model = character.model;
  const nextSample = RELATIONSHIP_SAMPLES.find((item) => item.level === sample.level + 1);

  useEffect(() => {
    setEmotion("neutral");
    setStage(model ? "loading" : "static");
    setTapCount(0);
  }, [character.id, model]);

  return (
    <section className="card-preview__showcase" aria-label={`${character.name} 闪卡预览`}>
      <article
        className="card-preview__hero"
        data-character={character.id}
        data-level={sample.level}
        data-tilt-x="0"
        data-tilt-y="0"
        onPointerMove={(event) => updateTilt(event, sample.level)}
        onPointerLeave={resetTilt}
        onPointerCancel={resetTilt}
      >
        <div className="card-preview__hero-back" aria-hidden="true" />
        <div className="card-preview__hero-face">
          <div className="card-preview__hero-sheen" aria-hidden="true" />
          <div className="card-preview__hero-art" aria-label={`${character.name} 的形象预览`}>
            <div className="card-preview__hero-light" aria-hidden="true" />
            {sample.level >= 3 && (
              <>
                <div className="card-preview__hero-orbit card-preview__hero-orbit--outer" aria-hidden="true" />
                <div className="card-preview__hero-orbit card-preview__hero-orbit--inner" aria-hidden="true" />
              </>
            )}
            {model ? (
              <div className="card-preview__hero-model">
                <Suspense fallback={null}>
                <Live2DStage
                  modelUrl={model.url}
                  emotion={emotion}
                  speaking={false}
                  failureMessage="Live2D 暂时没有载入，不影响卡面预览。"
                  onReady={() => setStage("ready")}
                  onError={() => setStage("failed")}
                  onTap={() => setTapCount((count) => count + 1)}
                />
                </Suspense>
              </div>
            ) : (
              <div className="card-preview__hero-mark"><CharacterMark character={character.id} /></div>
            )}
            {sample.level >= 4 && <CardParticles />}
          </div>
        </div>
      </article>

      <div className="card-preview__showcase-details" aria-live="polite">
        <p className="card-preview__section-label">当前卡面</p>
        <h2>{character.name}<span>{model?.label ?? "固定矢量默认形象"}</span></h2>
        <p className="card-preview__showcase-intro">
          {showProgress
            ? model
              ? `这张卡直接使用应用里已绑定给大肥鱼的 Live2D 模型，悬停和卡面特效不会重载。Lv.${sample.level} ${sample.effect}：${sample.detail}。`
              : "此人格目前没有可合法接入的 Live2D 文件，预览保留自己的固定默认形象，不借用其他角色的模型。"
            : relationshipStatus === "loading"
              ? "当前角色卡使用已绑定的默认形象，正在读取真实好感度与对应卡面等级。"
              : relationshipStatus === "error"
                ? "当前角色卡使用已绑定的默认形象；暂时无法读取好感度，重试后会显示对应等级。"
                : "当前角色卡使用已绑定的默认形象。"}
        </p>
        {relationship && (
          <div className="card-preview__live-progress">
            <div className="card-preview__live-progress-head">
              <span>真实好感度 · {relationship.points} 点</span>
              <span>Lv.{relationship.level} {relationship.label}</span>
            </div>
            <div
              className="card-preview__progress"
              role="progressbar"
              aria-label="当前角色好感度进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={relationship.progress}
            >
              <span style={{ width: `${relationship.progress}%` }} />
            </div>
            <p className="card-preview__tier-next">
              {relationship.nextThreshold === null
                ? "已解锁最高级专属特效"
                : `下一阶段还需 ${Math.max(0, relationship.nextThreshold - relationship.points)} 点好感`}
            </p>
          </div>
        )}
        {relationshipStatus === "loading" && <p className="card-preview__tier-next" role="status">正在读取好感度…</p>}
        {relationshipStatus === "error" && <p className="card-preview__tier-next" role="status">好感度暂不可读取，请重试。</p>}
        {showProgress && (
          <p className="card-preview__tier-next">
            {nextSample ? `下一阶段：Lv.${nextSample.level} ${nextSample.effect} · 待解锁` : "最高级专属特效已解锁"}
          </p>
        )}

        {model ? (
          <>
            <p className="card-preview__model-status" role="status">
              <span data-status={stage} />
              {stage === "ready" ? "Live2D 已载入，可点击互动" : stage === "failed" ? "模型暂时未载入，可在舞台上重试" : "正在载入本机 Live2D 模型"}
              {tapCount > 0 && <span className="card-preview__tap-note">她刚回应了你 {tapCount} 次</span>}
            </p>
            <div className="card-preview__expressions" role="group" aria-label="预览 Live2D 表情">
              <span>表情</span>
              {EXPRESSIONS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className="card-preview__expression"
                  aria-pressed={emotion === item.value}
                  onClick={() => setEmotion(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <details className="card-preview__attribution">
              <summary>模型来源与许可</summary>
              <p>{model.source}</p>
              <p>{model.licenseNote}</p>
            </details>
          </>
        ) : (
          <p className="card-preview__showcase-note">
            {showProgress
              ? "大肥鱼的 Live2D 只归大肥鱼使用；GPT、Claude 和鲸汐不会显示或复用它。"
              : "该角色目前没有可用的 Live2D 模型，卡面展示其固定默认形象。"}
          </p>
        )}

        <p className="card-preview__showcase-boundary">
          {showProgress ? "只更改本页演示选择，不会切换应用角色或写入业务数据。" : "选择本卡会立即切换当前人格；聊天、记忆、日记和见闻仍共享。"}
        </p>
      </div>
    </section>
  );
}
