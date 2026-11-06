/**
 * 手绘图标（规范 §5.6）：19 个图标，24×24 网格，用来替代「纯文字导航」。
 *
 * 图标本身是**装饰**：`aria-hidden`，每个图标必须由调用方配一条文字标签
 * （老人靠字认路，不靠图形）。`d` 来自 `baked.ts`（构建期用 perfect-freehand 烘好、已提交），
 * 所以运行时零依赖、零计算，同一名字永远同一条抖动。
 */
import { ICON_PATHS, type IconName } from "./baked";
import "../../styles/ink.css";

type Props = {
  name: IconName;
  /** 触控/导航默认 28；小角里可以 20 */
  size?: number;
  className?: string;
};

export function Icon({ name, size = 28, className = "" }: Props) {
  return (
    <svg
      className={`icon ${className}`.trim()}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden
      focusable="false"
    >
      {ICON_PATHS[name].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
