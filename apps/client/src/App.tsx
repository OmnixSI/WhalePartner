import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { Nav } from "./components/Nav";
import { Ocean } from "./components/Ocean";
import { ChatPage } from "./pages/ChatPage";
import { DiaryPage } from "./pages/DiaryPage";
import { MemoryPage } from "./pages/MemoryPage";
import { SettingsPage } from "./pages/SettingsPage";

// 隐藏样品页：只在 /__kit 打到时才加载，不进主包（规范 §10.4 P0-⑦）
const KitPage = lazy(() => import("./pages/KitPage"));

export default function App() {
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
        </main>
      </div>
    </>
  );
}
