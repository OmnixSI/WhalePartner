import { lazy, Suspense } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { usePrefetchAvatar } from "./avatar/prefetch";
import { CompanionCorner } from "./components/CompanionCorner";
import { Nav } from "./components/Nav";
import { Ocean } from "./components/Ocean";
import { Onboarding, useOnboardingOpen } from "./components/Onboarding";
import { ChatPage } from "./pages/ChatPage";

// 首屏只带聊天页（和引导要用到的设置页样式）；日记、记忆、见闻按需加载，
// 它们的 JS 和 CSS 不进首屏（#151 性能预算）。本地资源，切页时的加载在一帧之内。
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const DiaryPage = lazy(() => import("./pages/DiaryPage").then((m) => ({ default: m.DiaryPage })));
const MemoryPage = lazy(() => import("./pages/MemoryPage").then((m) => ({ default: m.MemoryPage })));
const SurfPage = lazy(() => import("./pages/SurfPage").then((m) => ({ default: m.SurfPage })));

// 隐藏样品页：只在 /__kit 打到时才加载，不进主包（规范 §10.4 P0-⑦）
const KitPage = lazy(() => import("./pages/KitPage"));
// 设计系统组件预览（#151）；手绘基元样品页挪到 /__kit/ink
const UiKitPage = lazy(() => import("./pages/UiKitPage"));

export default function App() {
  const { pathname } = useLocation();
  usePrefetchAvatar();
  // 引导是「第一次进来」的一整屏：它开着时后面整块先不挂——右栏历史、导航、旧聊天都不露，
  // 也避免同一页跑两个 Live2D 舞台（运行库的着色器是全局单例，两个舞台会互相打断）。
  const onboarding = useOnboardingOpen();
  // 聊天页有自己的舞台，日记页与记忆页自己挂了小角（§5.7）；剩下的页面在这一层补上。
  const cornerHere = pathname !== "/" && !pathname.startsWith("/diary") && !pathname.startsWith("/memory") && !pathname.startsWith("/settings") && !pathname.startsWith("/__kit");

  return (
    <>
      <Ocean />
      {!onboarding && (
        <div className="app">
          <Nav />
          <main className="main">
            <Routes>
              <Route path="/" element={<ChatPage />} />
              <Route path="/diary" element={<Suspense fallback={null}><DiaryPage /></Suspense>} />
              <Route path="/memory" element={<Suspense fallback={null}><MemoryPage /></Suspense>} />
              <Route path="/surf" element={<Suspense fallback={null}><SurfPage /></Suspense>} />
              <Route path="/settings" element={<Suspense fallback={null}><SettingsPage /></Suspense>} />
              <Route path="/__kit/*" element={<Suspense fallback={null}><UiKitPage /></Suspense>} />
              <Route path="/__kit/ink" element={<Suspense fallback={null}><KitPage /></Suspense>} />
            </Routes>
            {cornerHere && <CompanionCorner />}
          </main>
        </div>
      )}
      <Onboarding />
    </>
  );
}
