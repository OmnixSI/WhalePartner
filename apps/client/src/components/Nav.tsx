import { NavLink } from "react-router-dom";
import { Icon, type IconName } from "../icons";
import { TailMark } from "./Icons";

/** 导航（规范 §7.1.2）：鲸尾 + 四个手绘图标；图标是装饰，认路靠旁边的字。 */
const ITEMS: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: "/", label: "聊天", icon: "chat", end: true },
  { to: "/diary", label: "日记", icon: "diary" },
  { to: "/memory", label: "记忆", icon: "memory" },
  { to: "/settings", label: "设置", icon: "settings" },
];

export function Nav() {
  return (
    <nav className="nav" aria-label="主导航">
      <div className="nav__brand">
        <TailMark />
      </div>
      {ITEMS.map(({ to, label, icon, end }) => (
        <NavLink key={to} to={to} end={end} className="nav__link">
          <Icon name={icon} size={24} className="nav__icon" />
          <span className="nav__label">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
