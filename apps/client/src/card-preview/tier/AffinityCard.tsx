/**
 * 好感度卡（#159）：五档卡面 + 逐档升级动画。
 *
 * - 卡面只由 `level` 决定（1–5，越界会夹住）；底色、光色跟 `character` 的强调色走。
 * - 升级：给 `upgradeFrom`（< level）就从那一档逐档播到 `level`；播完或跳过调用 `onUpgradeEnd`。
 *   跨多档时整段等比快进到 ≤3 秒。点卡面或「跳过」立即落到新卡面。
 * - 动画只动 transform / opacity。静置时没有任何循环动画；光泽只在升级瞬间和精确指针 hover 时播放一次。
 * - `prefers-reduced-motion` 或 `data-motion="calm"`：升级只淡入新卡面，并显示「升到 Lv.N」，不位移、不闪；也不跟指针倾斜。
 * - `art` 是立绘槽：不传就画角色徽记。整张卡只渲染一次 `art`（升级时旧卡面只复制底和框），所以可以放 Live2D。
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { CHARACTERS, type CharacterId } from "../../characters";
import { CharacterMark } from "../../components/CharacterMark";
import { Caustics, FoilLeaf, Horizon, Signature } from "./motifs";
import { clampLevel, tierOf, upgradeSteps, type CardLevel, type UpgradeStep } from "./tiers";
import "./affinity-card.css";

export type UpgradeEnd = { from: CardLevel; to: CardLevel; skipped: boolean };

export type AffinityCardProps = {
  character: CharacterId;
  /** 当前档位 1–5 */
  level: number;
  /** 设了且小于 level 时播放 upgradeFrom → level 的升级动画；改回 undefined 再设一次即可重播 */
  upgradeFrom?: number;
  onUpgradeEnd?: (info: UpgradeEnd) => void;
  /** 立绘槽，默认是角色徽记 */
  art?: ReactNode;
  /** md：主卡；sm：缩略卡（静态，不倾斜、不响应 hover） */
  size?: "md" | "sm";
  /** 卡上的名字，默认取角色名 */
  name?: string;
  className?: string;
};

/** 粒子坐标（百分比）固定写死，截图可复现。Lv3 用前 6 颗气泡，Lv4 用 18 颗星芒，Lv5 再加 12 个闪点。 */
const SPARKS: ReadonlyArray<[number, number, number]> = [
  [14, 30, 1], [84, 24, 0.7], [22, 58, 0.6], [80, 52, 0.9], [12, 74, 0.8], [88, 70, 0.6],
  [30, 16, 0.6], [68, 12, 0.8], [50, 8, 0.5], [8, 46, 0.5], [92, 40, 0.7], [36, 40, 0.4],
  [64, 36, 0.5], [18, 88, 0.6], [82, 86, 0.6], [44, 22, 0.4], [58, 52, 0.4], [26, 70, 0.5],
  [72, 64, 0.5], [40, 82, 0.4], [60, 80, 0.5], [6, 20, 0.5], [94, 14, 0.6], [6, 62, 0.4],
  [94, 58, 0.5], [34, 6, 0.4], [76, 30, 0.4], [48, 66, 0.4], [16, 10, 0.5], [86, 92, 0.5],
];
const SPARK_COUNT: Record<CardLevel, number> = { 1: 0, 2: 0, 3: 6, 4: 18, 5: 30 };

function isCalm() {
  if (typeof window === "undefined") return false;
  return document.documentElement.getAttribute("data-motion") === "calm" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 一档的底、纹样、框和粒子。升级时旧档只复制这一层（不含立绘），淡出露出新档。 */
function Skin({ level, character, ghost = false }: { level: CardLevel; character: CharacterId; ghost?: boolean }) {
  const sparks = SPARK_COUNT[level];
  return (
    <div className={`acard__skin${ghost ? " acard__skin--ghost" : ""}`} data-level={level} aria-hidden="true">
      <div className="acard__base" />
      {level === 5 && <FoilLeaf />}
      <div className="acard__pane">
        {level >= 3 && <Caustics />}
        {level >= 4 && <Signature character={character} />}
        {level >= 4 && <div className="acard__beam" />}
        {level >= 3 && <div className="acard__halo" />}
        {level <= 2 && <Horizon />}
      </div>
      {sparks > 0 && (
        <div className="acard__sparks">
          {SPARKS.slice(0, sparks).map(([x, y, s], i) => (
            <span key={i} className={i >= 18 ? "acard__glint" : ""} style={{ left: `${x}%`, top: `${y}%`, "--s": s, "--i": i } as CSSProperties} />
          ))}
        </div>
      )}
      <div className="acard__frame" />
      {level >= 2 && <div className="acard__frame-inner" />}
    </div>
  );
}

/** 每一步升级专属的一次性图层，按目标档位不同。 */
function UpgradeLayers({ to }: { to: CardLevel }) {
  return (
    <div className="acard__up" data-to={to} aria-hidden="true">
      {to === 3 && (
        <>
          <span className="up-ripple" />
          <span className="up-ripple up-ripple--late" />
          <span className="up-edge"><span className="up-edge__spin" /></span>
        </>
      )}
      {to === 4 && (
        <>
          <span className="up-gold up-gold--b" />
          <span className="up-gold up-gold--l" />
          <span className="up-gold up-gold--r" />
          <span className="up-gold up-gold--t" />
          {Array.from({ length: 10 }, (_, i) => <span key={i} className="up-rise" style={{ "--i": i } as CSSProperties} />)}
        </>
      )}
      {to === 5 && (
        <>
          <span className="up-flash" />
          <span className="up-sweep" />
        </>
      )}
    </div>
  );
}

export function AffinityCard({ character, level, upgradeFrom, onUpgradeEnd, art, size = "md", name, className = "" }: AffinityCardProps) {
  const target = clampLevel(level);
  const [run, setRun] = useState<{ steps: UpgradeStep[]; i: number; calm: boolean } | null>(null);
  const endRef = useRef(onUpgradeEnd);
  endRef.current = onUpgradeEnd;

  useEffect(() => {
    if (upgradeFrom === undefined || upgradeFrom === null) return;
    const calm = isCalm();
    const steps = upgradeSteps(upgradeFrom, target, calm);
    if (steps.length) setRun({ steps, i: 0, calm });
  }, [upgradeFrom, target]);

  const finish = useCallback((skipped: boolean) => {
    setRun((current) => {
      if (current) {
        const info = { from: current.steps[0].from, to: current.steps[current.steps.length - 1].to, skipped };
        queueMicrotask(() => endRef.current?.(info));
      }
      return null;
    });
  }, []);

  useEffect(() => {
    if (!run) return;
    const step = run.steps[run.i];
    const t = window.setTimeout(() => {
      if (run.i + 1 < run.steps.length) setRun({ ...run, i: run.i + 1 });
      else finish(false);
    }, step.ms);
    return () => window.clearTimeout(t);
  }, [run, finish]);

  const step = run?.steps[run.i] ?? null;
  const shown = step ? step.to : target;
  const tier = tierOf(shown);
  const displayName = name ?? CHARACTERS.find((c) => c.id === character)?.name ?? "";
  const interactive = size === "md" && shown >= 2 && !step;

  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!interactive || isCalm()) return;
    if (event.pointerType === "touch" && event.buttons === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) - 0.5;
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)) - 0.5;
    const el = event.currentTarget;
    el.style.setProperty("--px", x.toFixed(3));
    el.style.setProperty("--py", y.toFixed(3));
    el.dataset.pointer = "on";
  };
  const onLeave = (event: PointerEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    el.style.setProperty("--px", "0");
    el.style.setProperty("--py", "0");
    delete el.dataset.pointer;
  };

  return (
    <div
      className={`acard ${className}`.trim()}
      data-character={character}
      data-level={shown}
      data-size={size}
      data-upgrading={step ? step.to : undefined}
      data-calm={run?.calm ? "true" : undefined}
      style={step ? ({ "--up-dur": `${step.ms}ms` } as CSSProperties) : undefined}
      role="group"
      aria-label={`${displayName}的好感度卡，Lv.${tier.level} ${tier.label}，${tier.finish}卡面`}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      onPointerCancel={onLeave}
      onClick={step ? () => finish(true) : undefined}
    >
      <div className="acard__body">
        <Skin level={shown} character={character} />
        {step && <Skin key={`ghost-${run!.i}`} level={step.from} character={character} ghost />}
        <div className="acard__art">{art ?? <CharacterMark character={character} className="acard__mark" />}</div>
        <div className="acard__shine" aria-hidden="true">
          {shown >= 5 && <span className="acard__holo" />}
          {shown >= 2 && <span className="acard__sheen" />}
        </div>
        <div className="acard__pips" aria-hidden="true">
          {Array.from({ length: 5 }, (_, i) => <span key={i} data-on={i < tier.level ? "true" : "false"} />)}
        </div>
        <div className="acard__plate">
          <span className="acard__name">{displayName}</span>
          <span className="acard__tier">Lv.{tier.level} {tier.label}</span>
        </div>
        {step && <UpgradeLayers key={`up-${run!.i}`} to={step.to} />}
      </div>
      {step && (
        <>
          <p className="acard__notice" aria-hidden="true">升到 Lv.{step.to} · {tierOf(step.to).label}</p>
          <button type="button" className="acard__skip" onClick={(e) => { e.stopPropagation(); finish(true); }}>跳过</button>
        </>
      )}
      <span className="sr-only" role="status">{step ? `升到 Lv.${step.to} ${tierOf(step.to).label}` : ""}</span>
    </div>
  );
}

export default AffinityCard;
