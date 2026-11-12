/**
 * 「换一位」里的当前角色卡（#160）：好感度卡 + 卡外的进度说明。
 *
 * 卡面等级就是 /api/relationship 返回的真实等级（读到之前不画卡，只占位）。升档时自动播一次升级动画，
 * 「上次看到的等级」按角色记在本地，见 useCardUpgrade。卡面代码是懒加载的，设置页首屏不带它。
 * 有 Live2D 模型的角色（大肥鱼）每一档都在立绘槽里实时画 Live2D，各档的底、框、镭射和扫光叠在它上下；其余角色用默认徽记。
 * 设置页没有聊天页的舞台，这里的 Live2D 是页面上唯一的 WebGL 上下文（运行库的着色器是全局单例，同页两个舞台会互相打断）。
 *
 * 解锁高档后可以切回低档看卡面（useCardView）：只改卡面显示的档位，卡外的真实等级、进度不变；选择按角色存在本地。
 */
import { lazy, Suspense } from "react";
import type { CardCharacter, RelationshipProgress } from "../../card-preview/data";
import { LazyAffinityCard, clampLevel, tierOf } from "../../card-preview/tier";
import { nextStageText } from "../../card-preview/relationship-copy";
import type { CharacterId } from "../../characters";
import { useCardUpgrade } from "./useCardUpgrade";
import { useCardView } from "./useCardView";
import "../../styles/card-view.css";

// Live2D 单独成块：pixi 不进设置页首屏，也不跟卡面绑在一起
const Live2DStage = lazy(() => import("../../avatar/Live2DStage").then((m) => ({ default: m.Live2DStage })));

type Props = {
  character: CardCharacter;
  snapshot: RelationshipProgress | null;
  status: "loading" | "ready" | "error";
};

export function AffinityShowcase({ character, snapshot, status }: Props) {
  const level = snapshot ? clampLevel(snapshot.level) : null;
  const { upgradeFrom, onUpgradeEnd } = useCardUpgrade(character.id, level);
  const { shown, choose, unlocked } = useCardView(character.id, level, upgradeFrom !== undefined);
  const model = character.model;
  const tier = level ? tierOf(level) : null;
  // 立绘不随档位变：切档、升级时 Live2D 舞台不重建
  const art = model && level
    ? (
      <Suspense fallback={null}>
        <Live2DStage modelUrl={model.url} emotion="neutral" speaking={false} failureMessage="Live2D 暂时没有载入，不影响卡面。" />
      </Suspense>
    )
    : undefined;

  return (
    <section className="set-card" aria-label={`${character.name}的好感度卡`}>
      <div className="set-card__stage" data-state={snapshot ? "ready" : status}>
        {level && shown ? (
          <Suspense fallback={<div className="set-card__ph" aria-hidden="true" />}>
            <LazyAffinityCard
              character={character.id as CharacterId}
              level={shown}
              upgradeFrom={upgradeFrom}
              onUpgradeEnd={onUpgradeEnd}
              art={art}
              size="md"
            />
          </Suspense>
        ) : (
          <div className="set-card__ph" aria-hidden="true" />
        )}
      </div>
      <div className="set-card__details" aria-live="polite">
        <p className="set-card__label">当前卡面</p>
        <h2 className="set-card__title">
          {character.name}
          {tier && <span>Lv.{tier.level} {tier.label} · {tier.finish}卡面</span>}
        </h2>
        {snapshot ? (
          <div className="set-card__progress">
            <div className="set-card__progress-head">
              <span>真实好感度 · {snapshot.points} 点</span>
              <span>Lv.{snapshot.level} {snapshot.label}</span>
            </div>
            <div className="set-card__bar" role="progressbar" aria-label="当前角色好感度进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={snapshot.progress}>
              <span style={{ width: `${snapshot.progress}%` }} />
            </div>
            <p className="set-card__next">{nextStageText(snapshot)}</p>
          </div>
        ) : status === "error" ? (
          <p className="set-card__next" role="status">好感度暂不可读取，请重试。</p>
        ) : (
          <p className="set-card__next" role="status">正在读取真实好感度…</p>
        )}
        {level && shown && unlocked.length > 1 && (
          <div className="card-view">
            <p className="card-view__label" id="card-view-label">卡面显示档位（已解锁 Lv.1–Lv.{level}）</p>
            <div className="card-view__levels" role="group" aria-labelledby="card-view-label">
              {[1, 2, 3, 4, 5].map((n) => {
                const open = unlocked.includes(n);
                return (
                  <button
                    key={n}
                    type="button"
                    className="card-view__btn ui-press ui-focus"
                    aria-pressed={n === shown}
                    disabled={!open || upgradeFrom !== undefined}
                    title={open ? `看 Lv.${n} ${tierOf(n).label}卡面` : "还没解锁"}
                    onClick={() => choose(n)}
                  >
                    Lv.{n}
                  </button>
                );
              })}
            </div>
            {shown < level && <p className="card-view__note" data-testid="card-view-note">正在看 Lv.{shown} {tierOf(shown).label}卡面，真实等级仍是 Lv.{level}。</p>}
          </div>
        )}
        {model && level && (
          <details className="set-card__attribution">
            <summary>模型来源与许可</summary>
            <p>{model.source}</p>
            <p>{model.licenseNote}</p>
          </details>
        )}
      </div>
    </section>
  );
}
