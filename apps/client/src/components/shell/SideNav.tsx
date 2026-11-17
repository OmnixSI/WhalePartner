import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useCharacter } from "../../characters";
import { Icon, type IconName } from "../../icons";
import { CharacterMark } from "../CharacterMark";
import { TailMark } from "../Icons";
import { m } from "../../i18n";

type NavItem = { to: string; label: string; icon: IconName; end?: boolean };
type NavGroup = { id: string; label: string; items: NavItem[] };

/** 参照 astryx SideNav 的分组结构：品牌头 + 可滚动分组 + 页脚，展开 200px / 收起 72px。 */
const GROUPS: NavGroup[] = [
  {
    id: "daily",
    label: m.common.shell.groupDaily,
    items: [{ to: "/", label: m.common.shell.chat, icon: "chat", end: true }],
  },
  {
    id: "book",
    label: m.common.shell.groupJournal,
    items: [
      { to: "/diary", label: m.common.shell.diary, icon: "diary" },
      { to: "/memory", label: m.common.shell.memory, icon: "memory" },
      { to: "/surf", label: m.common.shell.surf, icon: "bottle" },
    ],
  },
  {
    id: "system",
    label: m.common.shell.groupSystem,
    items: [{ to: "/settings", label: m.common.shell.settings, icon: "settings" }],
  },
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

type Props = { collapsed: boolean; onToggle: () => void };

export function SideNav({ collapsed, onToggle }: Props) {
  const elder = useElderMode();
  const character = useCharacter();
  const groups = GROUPS.map((group) => ({
    ...group,
    items: elder ? group.items.filter((item) => item.to !== "/memory") : group.items,
  }));

  return (
    <aside className={`shell-nav${collapsed ? " is-collapsed" : ""}`} aria-label={m.common.shell.mainNav}>
      {/* 收起按钮在品牌行左端（macOS 侧栏开关的位置）；两态都钉在窄栏正中同一点，鼠标不动再点一下就能展开 */}
      <button
        type="button"
        className="shell-nav__toggle"
        aria-label={collapsed ? m.common.shell.expandNav : m.common.shell.collapseNav}
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        {/* 三角用 SVG 画：16×16 画布里笔画外框约 6×10 居中，两个朝向各自对称，不依赖字体基线 */}
        <svg className="shell-nav__toggle-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
          <path d={collapsed ? "M5.85 3.85 L10.15 8 L5.85 12.15" : "M10.15 3.85 L5.85 8 L10.15 12.15"} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className="shell-nav__head">
        <span className="shell-nav__mark" aria-hidden="true"><TailMark /></span>
        <span className="shell-nav__brand">
          <strong>{m.common.shell.brand}</strong>
        </span>
      </div>

      <div className="shell-nav__sections">
        {groups.map((group) => (
          <section className="shell-nav__group" key={group.id} aria-labelledby={`shell-nav-${group.id}`}>
            <h2 className="shell-nav__group-label" id={`shell-nav-${group.id}`}>{group.label}</h2>
            <ul className="shell-nav__list">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink to={item.to} end={item.end} className="shell-nav__item" title={item.label} aria-label={item.label}>
                    <Icon name={item.icon} size={20} className="shell-nav__icon" />
                    <span className="shell-nav__label">{item.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="shell-nav__foot">
        <div className="shell-nav__her">
          <CharacterMark className="shell-nav__her-mark" />
          <span className="shell-nav__her-text">
            <strong>{character.name}</strong>
            <small>{character.tagline}</small>
          </span>
        </div>
      </div>
    </aside>
  );
}
