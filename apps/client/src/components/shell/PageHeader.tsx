import type { ReactNode } from "react";
import "./shell.css";

type Props = {
  /** 小字眉题，例如「手帐 · 日记」 */
  eyebrow?: string;
  title: string;
  lead?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

/**
 * 页面模板的页头（参照 astryx 页面模板的 heading + actions 区域）：
 * 标题、说明和右侧操作统一排版；内容宽度和间距由 shell.css 的 page 规则统一。
 */
export function PageHeader({ eyebrow, title, lead, actions, className }: Props) {
  return (
    <header className={`page-head${className ? ` ${className}` : ""}`}>
      <div className="page-head__text">
        {eyebrow && <p className="page-head__eyebrow">{eyebrow}</p>}
        <h1 className="page-head__title">{title}</h1>
        {lead && <div className="page-head__lead">{lead}</div>}
      </div>
      {actions && <div className="page-head__actions">{actions}</div>}
    </header>
  );
}
