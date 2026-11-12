/**
 * StateBlock（规范 §6.10）：空 / 加载 / 错误 / 离线通用。
 * 加载 = 海平线 + 角色名；空 / 错误 = 角色徽记。标题（20 文楷）+ 正文（16）+ 至多 1 个 primary + 可选 quiet「详情」；居中，最大宽 360。
 * `loading` 用 `role="status"`，`error` 用 `role="alert"`。
 *
 * 日记页与记忆页共用（两页的 WRITE 范围只有 `components/diary` 与 `components/memory`，
 * 所以放在 diary 一侧，记忆页 import 过来）。
 */
import { useState, type ReactNode } from "react";
import { InkLine } from "../ink";
import "../../styles/diary.css"; // 记忆页也用这个组件；日记页懒加载后，样式得跟着组件走
import { CharacterMark, type CharacterMood } from "../CharacterMark";
import { Horizon } from "../Horizon";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { useInkEnv } from "../ink/useCalm";

type Props = {
  kind: "loading" | "empty" | "error";
  title?: string;
  body?: string;
  action?: { label: string; onClick: () => void } | null;
  /** 错误详情：只进折叠，不进正文。 */
  detail?: string;
  mood?: CharacterMood;
  children?: ReactNode;
};

export function StateBlock({ kind, title, body, action = null, detail, mood, children }: Props) {
  const calm = useInkEnv().calm;
  const [showDetail, setShowDetail] = useState(false);
  const sticker: CharacterMood = mood ?? (kind === "error" ? "worried" : kind === "loading" ? "sleepy" : "hold");

  return (
    <Card variant="flat" padding="lg" className={`state state--${kind}`} role={kind === "error" ? "alert" : kind === "loading" ? "status" : undefined}>
      {kind === "loading" ? <Horizon className="state__horizon" /> : <CharacterMark mood={sticker} className="state__sticker" />}
      {title && <h3 className="state__title">{title}</h3>}
      {body ? <p className="state__body">{body}</p> : null}
      {kind === "loading" && <InkLine className="state__ink" id="state-ink" draw={calm ? "none" : "loop"} />}
      {children}
      <div className="state__actions">
        {action && (
          <Button variant="primary" onClick={action.onClick}>
            {action.label}
          </Button>
        )}
        {detail && (
          <Button variant="ghost" aria-expanded={showDetail} onClick={() => setShowDetail((v) => !v)}>
            详情
          </Button>
        )}
      </div>
      {detail && showDetail && <p className="state__detail">{detail}</p>}
    </Card>
  );
}
