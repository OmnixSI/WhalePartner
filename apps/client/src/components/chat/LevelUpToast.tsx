/**
 * 聊天页的升档提示（#160）：好感度跨档后弹一条现成的吐司，点「去看看」跳到设置页打开卡面。
 * 整个文件只在真的升档时才下载（ChatPanel 里 lazy），吐司由 App 根部的 ToastHost 画；卡面动画仍在设置页播。
 */
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "../ui/toast-store";

export default function LevelUpToast({ level }: { level: number }) {
  const navigate = useNavigate();
  const shown = useRef(false);
  useEffect(() => {
    if (!shown.current) {
      shown.current = true;
      toast({
        title: `好感度升到 Lv.${level}，去看看她的新卡面`,
        tone: "success",
        action: { label: "去看看", onClick: () => navigate("/settings?card=1") },
      });
    }
  }, [level, navigate]);
  // 离开聊天页时 ToastHost 会清空队列，这里不用再收。
  return null;
}
