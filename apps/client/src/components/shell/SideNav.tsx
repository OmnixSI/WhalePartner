import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useCharacter } from "../../characters";
import { Icon, type IconName } from "../../icons";
import { CharacterMark } from "../CharacterMark";
import { TailMark } from "../Icons";

type NavItem = { to: string; label: string; icon: IconName; end?: boolean };
type NavGroup = { id: string; label: string; items: NavItem[] };

/** 参照 astryx SideNav 的分组结构：品牌头 + 可滚动分组 + 页脚，展开 232px / 收起 72px。 */
const GROUPS: NavGroup[] = [
  {
    id: "daily",
    label: "日常",
    items: [{ to: "/", label: "聊天", icon: "chat", end: true }],
  },
  {
    id: "book",
    label: "手帐",
    items: [
      { to: "/diary", label: "日记", icon: "diary" },
      { to: "/memory", label: "记忆", icon: "memory" },
      { to: "/surf", label: "见闻", icon: "bottle" },
    ],
  },
  {
    id: "system",
    label: "系统",
    items: [{ to: "/settings", label: "设置", icon: "settings" }],
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

export function SideNav() {
  const [collapsed, setCollapsed] = useState(false);
  const elder = useElderMode();
  const character = useCharacter();
  const groups = GROUPS.map((group) => ({
    ...group,
    items: elder ? group.items.filter((item) => item.to !== "/memory") : group.items,
  }));

  return (
    <aside className={`shell-nav${collapsed ? " is-collapsed" : ""}`} aria-label="主导航">
      <div className="shell-nav__head">
        <span className="shell-nav__mark" aria-hidden="true"><TailMark /></span>
        <span className="shell-nav__brand">
          <strong>鲸汐</strong>
          <small>WhalePartner</small>
        </span>
      </div>

      <div className="shell-nav__sections">
        {groups.map((group) => (
          <section className="shell-nav__group" key={group.id} aria-labelledby={`shell-nav-${group.id}`}>
            <h2 className="shell-nav__group-label" id={`shell-nav-${group.id}`}>{group.label}</h2>
            <ul className="shell-nav__list">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink to={item.to} end={item.end} className="shell-nav__item" title={item.label}>
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
        <button
          type="button"
          className="shell-nav__toggle"
          aria-label={collapsed ? "展开导航" : "收起导航"}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          <span aria-hidden="true">{collapsed ? "›" : "‹"}</span>
        </button>
      </div>
    </aside>
  );
}
