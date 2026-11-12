import type { ReactNode } from "react";
import { SideNav } from "./SideNav";
import "./shell.css";

/**
 * 应用外壳（参照 meta/astryx `packages/core/src/AppShell/AppShell.tsx` 的槽位结构）：
 * 左侧 SideNav + 右侧 main。鲸汐没有 TopNav，页面标题由每个页面自己的 PageHeader 提供。
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <a className="app-shell__skip" href="#main">跳到主要内容</a>
      <SideNav />
      <main className="app-shell__main" id="main">
        {children}
      </main>
    </div>
  );
}
