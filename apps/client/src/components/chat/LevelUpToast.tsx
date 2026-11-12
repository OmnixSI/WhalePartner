/**
 * 聊天页的升档提示（#160）：好感度跨档后弹一条现成的吐司，点「去看看」跳到设置页打开卡面。
 * 整个文件只在真的升档时才下载（ChatPanel 里 lazy），Toaster 也只在这时挂上；卡面动画仍在设置页播。
 */
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Toaster, toast } from "../ui/Toast";

export default function LevelUpToast({ level }: { level: number }) {
  const navigate = useNavigate();
  const shown = useRef(false);
  const id = useRef<number | null>(null);
  useEffect(() => {
    if (!shown.current) {
      shown.current = true;
      id.current = toast({
        title: `好感度升到 Lv.${level}，去看看她的新卡面`,
        tone: "success",
        action: { label: "去看看", onClick: () => navigate("/settings?card=1") },
      });
    }
  }, [level, navigate]);
  // 离开聊天页时收掉：Toaster 跟着卸载，别让它留到别的页面再冒出来。
  // 延后一拍确认真的卸载了（开发模式的 StrictMode 会先卸载再立刻挂回来，那一下不能收）。
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      setTimeout(() => { if (!alive.current && id.current !== null) toast.dismiss(id.current); }, 0);
    };
  }, []);
  return <Toaster />;
}
