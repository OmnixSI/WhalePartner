import { useState, type ReactNode } from "react";
import { SideNav } from "./SideNav";
import "./shell.css";

/**
 * 应用外壳（参照 meta/astryx `packages/core/src/AppShell/AppShell.tsx` 的槽位结构）：
 * 左侧 SideNav + 右侧 main。鲸汐没有 TopNav，页面标题由每个页面自己的 PageHeader 提供。
 * 收起状态放在壳上，父级网格列宽才能跟着 232px → 72px，主内容不会留出空洞。
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [navCollapsed, setNavCollapsed] = useState(false);

  return (
    <div className={`app-shell${navCollapsed ? " is-nav-collapsed" : ""}`}>
      <a className="app-shell__skip" href="#main">跳到主要内容</a>
      <SideNav collapsed={navCollapsed} onToggle={() => setNavCollapsed((value) => !value)} />
      <main className="app-shell__main" id="main">
        {children}
      </main>
    </div>
  );
}
