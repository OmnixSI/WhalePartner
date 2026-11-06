/**
 * 名字牌（规范 §6.7）：对话框左上「探出」的一块纸，高 36，底 `--accent-wash`，
 * 上边与左右边用手绘框画（InkFrame 的下边压在对话框上沿里），文字 18 文楷，
 * 前缀一枚 8px 实心 --accent 圆点；右侧紧跟「AI 角色」邮戳，永远可见。
 * 窄屏放不下时邮戳换到下一行（chat.css 负责）。
 */
import { hashSeed } from "../../lib/ink";
import { InkFrame, Stamp } from "../ink";

type Props = {
  name: string;
  className?: string;
};

export function NameTab({ name, className = "" }: Props) {
  return (
    <div className={`nametab ${className}`.trim()} role="group" aria-label={`${name}，AI 角色`}>
      <InkFrame
        className="nametab__ink"
        radius={8}
        stroke={1.6}
        tone="accent"
        fill="none"
        openCorner
        seed={hashSeed(`nametab:${name}`)}
      >
        <span className="nametab__hole" aria-hidden />
      </InkFrame>
      <span className="nametab__dot" aria-hidden />
      <span className="nametab__name">{name}</span>
      <Stamp kind="label" lines={["AI 角色"]} className="nametab__stamp" />
    </div>
  );
}
