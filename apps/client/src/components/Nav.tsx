import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { Icon, type IconName } from "../icons";
import { TailMark } from "./Icons";

/** 主导航：鲸尾 + 手绘图标；图标是装饰，认路靠旁边的字。 */
const ITEMS: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: "/", label: "聊天", icon: "chat", end: true },
  { to: "/diary", label: "日记", icon: "diary" },
  { to: "/memory", label: "记忆", icon: "memory" },
  { to: "/surf", label: "见闻", icon: "bottle" },
  { to: "/settings", label: "设置", icon: "settings" },
];

function useElderMode() {
  const read = () => document.documentElement.getAttribute("data-elder") === "on";
  const [elder, setElder] = useState(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setElder(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-elder"] });
    return () => mo.disconnect();
  }, []);
  return elder;
}

export function Nav() {
  // 老人模式把记忆收在设置里；见闻保留主导航入口。
  const elder = useElderMode();
  const items = elder ? ITEMS.filter((item) => item.to !== "/memory") : ITEMS;
  return (
    <nav className="nav" aria-label="主导航">
      <div className="nav__brand">
        <TailMark />
      </div>
      {items.map(({ to, label, icon, end }) => (
        <NavLink key={to} to={to} end={end} className="nav__link">
          <Icon name={icon} size={24} className="nav__icon" />
          <span className="nav__label">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
