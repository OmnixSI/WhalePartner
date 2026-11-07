/**
 * 见闻页的空 / 加载 / 错误态（规范 §7.7.4 的表，换成她自己的口吻）。
 * 不用任何角色形象：一张摆在桌上的明信片 + 一枚手绘小图标，墨线和文楷就够了。
 */
import { useState, type ReactNode } from "react";
import { InkLine } from "../ink";
import { Icon, type IconName } from "../ink-icons";
import { useInkEnv } from "../ink/useCalm";

type Props = {
  kind: "empty" | "loading" | "error";
  icon?: IconName;
  title: string;
  body?: ReactNode;
  action?: { label: string; onClick: () => void } | null;
  secondary?: { label: string; onClick: () => void } | null;
  /** 错误详情：只进折叠。 */
  detail?: string;
};

export function SurfEmpty({ kind, icon = "postcard", title, body, action = null, secondary = null, detail }: Props) {
  const calm = useInkEnv().calm;
  const [open, setOpen] = useState(false);
  return (
    <div className={`surf-empty surf-empty--${kind}`} role={kind === "error" ? "alert" : kind === "loading" ? "status" : undefined}>
      <div className="surf-empty__card" aria-hidden>
        <span className="surf-empty__tape" />
        <span className="surf-empty__icon">
          <Icon name={icon} size={44} />
        </span>
        <span className="surf-empty__lines">
          <InkLine className="surf-empty__line" id={`surf-empty-a-${kind}`} draw={kind === "loading" && !calm ? "loop" : "none"} />
          <InkLine className="surf-empty__line surf-empty__line--short" id={`surf-empty-b-${kind}`} />
        </span>
        <span className="surf-empty__postmark" />
      </div>
      <h3 className="surf-empty__title">{title}</h3>
      {body ? <p className="surf-empty__body">{body}</p> : null}
      {(action || secondary || detail) && (
        <div className="surf-empty__actions">
          {action && (
            <button type="button" className="btn btn--primary" onClick={action.onClick}>
              {action.label}
            </button>
          )}
          {secondary && (
            <button type="button" className="btn btn--quiet" onClick={secondary.onClick}>
              {secondary.label}
            </button>
          )}
          {detail && (
            <button type="button" className="btn btn--quiet" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
              详情
            </button>
          )}
        </div>
      )}
      {detail && open && <p className="surf-empty__detail">{detail}</p>}
    </div>
  );
}
