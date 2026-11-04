import { NavLink } from "react-router-dom";
import { ChatIcon, DiaryIcon, MemoryIcon, SettingsIcon, TailMark } from "./Icons";

const ITEMS = [
  { to: "/", label: "聊天", icon: ChatIcon, end: true },
  { to: "/diary", label: "日记", icon: DiaryIcon },
  { to: "/memory", label: "记忆", icon: MemoryIcon },
  { to: "/settings", label: "设置", icon: SettingsIcon },
];

export function Nav() {
  return (
    <nav className="nav" aria-label="主导航">
      <div className="nav__brand"><TailMark /></div>
      {ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className="nav__link">
          <Icon />
          <span>{label}</span>
        </NavLink>
      ))}
      <div className="nav__spacer" />
    </nav>
  );
}
