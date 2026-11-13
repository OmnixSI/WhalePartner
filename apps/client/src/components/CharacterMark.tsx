/**
 * CharacterMark：每个角色一枚克制的矢量徽记，取代旧的手绘贴纸。
 *
 * - 画板 96×96，一枚圆章：底是强调色的淡纸色，下半是一线海（平涂），中间是该角色自己的一个意象，
 *   外圈一道细墨线。只有平涂和干净的几何线条，没有抖动线、没有脸。
 * - 意象：鲸汐 = 水面上的鲸尾；大肥鱼 = 一滴水（鲸喷出的水柱）；小克 = 摊开的书与一缕茶气；小智 = 新芽。
 * - 颜色全部走 token（--accent / --ink / --sheet / --coral），换主题、换角色自动跟着变。
 * - `mood` 只是为了兼容旧调用：sleep 类把徽记放低一点（像沉进水里），其余一律不变。
 */
import { useId, type CSSProperties } from "react";
import { useCharacter, type CharacterId } from "../characters";
import "../styles/mark.css";

/** 页面推给小角的姿态；徽记几乎不变，只用来选择台词（见 CompanionCorner）。 */
export type CharacterMood =
  | "idle" | "happy" | "think" | "write" | "sleep" | "sorry" | "wave" | "hold" | "phone" | "paper"
  | "calm" | "sad" | "sleepy" | "curious" | "thinking" | "surprised" | "shy" | "proud" | "worried";

type Props = {
  /** 不传就是当前角色 */
  character?: CharacterId;
  mood?: CharacterMood;
  className?: string;
  /** 不传就是纯装饰（aria-hidden） */
  label?: string;
};

const SLEEPY = new Set<CharacterMood>(["sleep", "sleepy", "sorry", "sad", "worried"]);

/** 水平线在 y=62；海在其下。 */
function Emblem({ id }: { id: CharacterId }) {
  switch (id) {
    case "whale":
      return (
        <>
          {/* 鲸尾：两瓣对称，尾柄入水 */}
          <path
            className="mark__fill"
            d="M48 66 C48.4 58 47.4 52 44.6 47.6 C40 47.6 33.4 45.4 27.5 38.6 C34.2 38.4 39.6 39.6 44 42.4 C46.2 42.4 47.4 41 48 38.8 C48.6 41 49.8 42.4 52 42.4 C56.4 39.6 61.8 38.4 68.5 38.6 C62.6 45.4 56 47.6 51.4 47.6 C48.6 52 47.6 58 48 66 Z"
          />
          <circle className="mark__sun" cx="68" cy="27" r="5" />
          <path className="mark__ripple" d="M37 66 Q48 70.4 59 66" />
        </>
      );
    case "deepseek":
      return (
        <>
          <path className="mark__fill" d="M48 24 C54 33 61 40 61 49 A13 13 0 0 1 35 49 C35 40 42 33 48 24 Z" />
          <path className="mark__shine" d="M42.4 50 A6 6 0 0 0 47 56" />
          <circle className="mark__sun" cx="67" cy="32" r="3.6" />
          <path className="mark__ripple" d="M36 66 Q48 71 60 66" />
        </>
      );
    case "claude":
      return (
        <>
          {/* 摊开的书 */}
          <path className="mark__fill" d="M48 43 L26 38.5 L26 63 L48 67.5 Z" />
          <path className="mark__fill mark__fill--2" d="M48 43 L70 38.5 L70 63 L48 67.5 Z" />
          <path className="mark__line" d="M48 43 V67.5" />
          <path className="mark__line mark__line--thin" d="M31 46 L43 48.4 M31 51 L43 53.4 M53 48.4 L65 46 M53 53.4 L65 51" />
          {/* 一缕茶气 */}
          <path className="mark__steam" d="M48 34 C45 30 51 27 48 22" />
        </>
      );
    default:
      return (
        <>
          {/* 新芽 */}
          <path className="mark__line mark__line--stem" d="M48 66 V45" />
          <path className="mark__fill" d="M48 53 C37.5 53 31 47 30 37 C41 37 48 43 48 53 Z" />
          <path className="mark__fill mark__fill--2" d="M48 46 C48 35 55 29 66 29 C66 40 59 46 48 46 Z" />
        </>
      );
  }
}

export function CharacterMark({ character, mood = "idle", className = "", label }: Props) {
  const current = useCharacter();
  const id = character ?? current.id;
  // 每枚徽记一个独立的 clipPath id：同一角色常有好几枚（侧栏、小角、设置页），
  // id 重复时浏览器只认第一枚，那枚在 display:none 的侧栏里（手机宽）就整个不裁切，下半片海变成方块。
  const clipId = `mark-clip-${useId().replace(/:/g, "")}`;
  const style: CSSProperties | undefined = SLEEPY.has(mood) ? { ["--mark-dip" as string]: "2px" } : undefined;
  return (
    <svg
      className={`mark ${className}`.trim()}
      style={style}
      viewBox="0 0 96 96"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      data-character={id}
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="48" cy="48" r="44" />
        </clipPath>
      </defs>
      <circle className="mark__disc" cx="48" cy="48" r="44" />
      <g clipPath={`url(#${clipId})`}>
        <rect className="mark__sea" x="0" y="66" width="96" height="30" />
        <g className="mark__figure">
          <Emblem id={id} />
        </g>
        <path className="mark__horizon" d="M0 66 H96" />
      </g>
      <circle className="mark__ring" cx="48" cy="48" r="44" />
    </svg>
  );
}
