import { NavLink } from "react-router-dom";
import { TailMark } from "./Icons";

const ITEMS = [
  { to: "/", label: "聊天", end: true },
  { to: "/diary", label: "日记" },
  { to: "/memory", label: "记忆" },
  { to: "/settings", label: "设置" },
];

export function Nav() {
  return (
    <nav className="nav" aria-label="主导航">
      <div className="nav__brand"><TailMark /></div>
      {ITEMS.map(({ to, label, end }) => (
        <NavLink key={to} to={to} end={end} className="nav__link">{label}</NavLink>
      ))}
    </nav>
  );
}
