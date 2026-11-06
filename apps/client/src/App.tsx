import { lazy, Suspense } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { CompanionCorner } from "./components/CompanionCorner";
import { Nav } from "./components/Nav";
import { Ocean } from "./components/Ocean";
import { Onboarding } from "./components/Onboarding";
import { ChatPage } from "./pages/ChatPage";
import { DiaryPage } from "./pages/DiaryPage";
import { MemoryPage } from "./pages/MemoryPage";
import { SettingsPage } from "./pages/SettingsPage";

// 隐藏样品页：只在 /__kit 打到时才加载，不进主包（规范 §10.4 P0-⑦）
const KitPage = lazy(() => import("./pages/KitPage"));

export default function App() {
  const { pathname } = useLocation();
  // 聊天页有自己的舞台，日记页与记忆页自己挂了小角（§5.7）；剩下的页面在这一层补上。
  const cornerHere = pathname !== "/" && !pathname.startsWith("/diary") && !pathname.startsWith("/memory");

  return (
    <>
      <Ocean />
      <div className="app">
        <Nav />
        <main className="main">
          <Routes>
            <Route path="/" element={<ChatPage />} />
            <Route path="/diary" element={<DiaryPage />} />
            <Route path="/memory" element={<MemoryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/__kit" element={<Suspense fallback={null}><KitPage /></Suspense>} />
          </Routes>
          {cornerHere && <CompanionCorner />}
        </main>
      </div>
      <Onboarding />
    </>
  );
}
