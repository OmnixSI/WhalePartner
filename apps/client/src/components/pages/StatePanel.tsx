/**
 * 页面里的整块状态：加载 / 空 / 出错。记忆页和见闻页共用，底座是 ui/Card + ui/Button。
 * 改写参考 meta/astryx 的 EmptyState：图标块 + 标题 + 一句说明 + 一个动作。
 */
import type { ReactNode } from "react";
import { Card, Spinner } from "../ui";
import { Icon, type IconName } from "../ink-icons";
import "./pages.css";

type Props = {
  kind: "loading" | "empty" | "error";
  title: string;
  body?: string;
  /** error 时的技术细节，折叠在「看详情」里 */
  detail?: string;
  icon?: IconName;
  children?: ReactNode;
};

export function StatePanel({ kind, title, body, detail, icon, children }: Props) {
  return (
    <Card className="spanel" data-state={kind} padding="lg" role={kind === "error" ? "alert" : kind === "loading" ? "status" : undefined}>
      <span className="spanel__icon" aria-hidden>
        {kind === "loading" ? <Spinner /> : <Icon name={icon ?? (kind === "error" ? "bottle" : "shell")} size={28} />}
      </span>
      <h2 className="spanel__title">{title}</h2>
      {body && <p className="spanel__body">{body}</p>}
      {detail && (
        <details className="spanel__detail">
          <summary>看详情</summary>
          <code>{detail}</code>
        </details>
      )}
      {children && <div className="spanel__actions">{children}</div>}
    </Card>
  );
}
