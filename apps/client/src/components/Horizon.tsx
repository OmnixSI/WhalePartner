/**
 * Horizon：加载与占位。纸面上一条慢慢呼吸的海平线，下面是角色名（文楷）。
 * 没有任何图形；淡入 ≤240ms；calm / reduced-motion 下线不动。
 */
import { useCharacter } from "../characters";
import "../styles/mark.css";

type Props = {
  /** 默认是当前角色名 */
  name?: string;
  /** 线下面的小字（可选），例如「正在翻小本子」 */
  note?: string;
  className?: string;
  /** 给读屏用；不传就当装饰 */
  label?: string;
};

export function Horizon({ name, note, className = "", label }: Props) {
  const character = useCharacter();
  return (
    <div
      className={`horizon ${className}`.trim()}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <span className="horizon__name">{name ?? character.name}</span>
      <span className="horizon__line" />
      {note && <span className="horizon__note">{note}</span>}
    </div>
  );
}
