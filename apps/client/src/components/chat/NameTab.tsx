/**
 * 名字牌（规范 §6.7）：对话框左上探出的一块平纸，底 `--color-accent-muted`，
 * 前缀一枚 8px 实心圆点——颜色跟着她的情绪走（平静/开心/难过/生气/意外/放松），
 * 情绪不写进正文，只在她脸上和这枚点上；右侧紧跟「AI 角色」小字标，永远可见。
 */
import type { AvatarEmotion } from "../../avatar/model.config";
import { EMOTION_LABEL } from "../../lib/emotion";
import { m } from "../../i18n";

type Props = {
  name: string;
  className?: string;
  /** 她现在是什么心情：点会跟着变，读屏也多一句「开心地说」。 */
  emotion?: AvatarEmotion;
};

export function NameTab({ name, className = "", emotion = "neutral" }: Props) {
  const label = emotion === "neutral" ? m.chat.nameTab.label(name) : m.chat.nameTab.labelWithEmotion(name, EMOTION_LABEL[emotion]);
  return (
    <div className={`nametab ${className}`.trim()} role="group" aria-label={label} data-emotion={emotion}>
      <span className="nametab__dot" aria-hidden />
      <span className="nametab__name">{name}</span>
      <span className="nametab__ai" aria-hidden>{m.chat.nameTab.ai}</span>
    </div>
  );
}
