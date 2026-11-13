import type { ReactNode } from "react";
import "./shell.css";

type Props = {
  title: string;
  /** 跟在标题右边同一行的一句小字（比标题浅一档），例如见闻页的「今天逛了几个地方」 */
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

/**
 * 页面模板的页头：一行标题（可带一句小字）+ 右侧操作 + 一条分割线。
 * 不放眉题和说明段，四个内容页的标题位置、字号、到正文的距离由 shell.css 的 page 规则统一。
 */
export function PageHeader({ title, meta, actions, className }: Props) {
  return (
    <header className={`page-head${className ? ` ${className}` : ""}`}>
      <div className="page-head__text">
        <h1 className="page-head__title">{title}</h1>
        {meta && <p className="page-head__meta">{meta}</p>}
      </div>
      {actions && <div className="page-head__actions">{actions}</div>}
    </header>
  );
}
