/**
 * 名字牌（规范 §6.7）：对话框左上「探出」的一块纸，高 36，底 `--accent-wash`，
 * 上边与左右边用手绘框画（InkFrame 的下边压在对话框上沿里），文字 18 文楷，
 * 前缀一枚 8px 实心圆点——颜色跟着她的情绪走（平静/开心/难过/生气/意外/放松），
 * 情绪不写进正文，只在她脸上和这枚点上；右侧紧跟「AI 角色」邮戳，永远可见。
 * 窄屏放不下时邮戳换到下一行（chat.css 负责）。
 */
import type { AvatarEmotion } from "../../avatar/model.config";
import { EMOTION_LABEL } from "../../lib/emotion";
import { hashSeed } from "../../lib/ink";
import { InkFrame, Stamp } from "../ink";

type Props = {
  name: string;
  className?: string;
  /** 她现在是什么心情：点会跟着变，读屏也多一句「开心地说」。 */
  emotion?: AvatarEmotion;
};

export function NameTab({ name, className = "", emotion = "neutral" }: Props) {
  const label = emotion === "neutral" ? `${name}，AI 角色` : `${name}，AI 角色，${EMOTION_LABEL[emotion]}地说`;
  return (
    <div className={`nametab ${className}`.trim()} role="group" aria-label={label} data-emotion={emotion}>
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
