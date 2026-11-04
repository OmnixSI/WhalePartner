import { Route, Routes } from "react-router-dom";
import { Nav } from "./components/Nav";
import { Ocean } from "./components/Ocean";
import { ChatPage } from "./pages/ChatPage";
import { DiaryPage } from "./pages/DiaryPage";
import { MemoryPage } from "./pages/MemoryPage";
import { SettingsPage } from "./pages/SettingsPage";

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
          </Routes>
        </main>
      </div>
    </>
  );
}
