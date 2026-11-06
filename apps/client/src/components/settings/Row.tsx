/**
 * 设置页的两块骨架（规范 §7.4.1）：`SettingGroup` 是"她 / 额度 / 我的数据"这样的一组，
 * `SettingRow` 是一行——左图标 + 标题 + 一句说明，右侧控件；行高 ≥72（老人 ≥88）。
 */
import { useId, type ReactNode } from "react";
import { Icon, type IconName } from "../../icons";

type GroupProps = {
  title: string;
  children: ReactNode;
  /** 组下面的一句补充（quiet） */
  note?: ReactNode;
  /** 锚点用（额度 `#quota`） */
  id?: string;
};

export function SettingGroup({ title, children, note, id }: GroupProps) {
  const titleId = useId();
  return (
    <section className="set-group" id={id} aria-labelledby={titleId}>
      <h2 className="set-group__title" id={titleId}>
        {title}
      </h2>
      {note && <p className="set-group__note">{note}</p>}
      <div className="set-group__body">{children}</div>
    </section>
  );
}

type RowProps = {
  title: string;
  desc?: ReactNode;
  icon?: IconName;
  children?: ReactNode;
  /** 右侧控件换行到下面（输入框、卡片组用） */
  stacked?: boolean;
  /** 整行可点：点标题/说明也能切换（开关类设置用它，别逼用户去点小圆点） */
  onActivate?: () => void;
};

export function SettingRow({ title, desc, icon, children, stacked = false, onActivate }: RowProps) {
  return (
    <div
      className="set-row"
      data-stacked={stacked ? "on" : "off"}
      data-tap={onActivate ? "on" : "off"}
      onClick={onActivate ? (event) => {
        // 点到右侧控件本身时让它自己处理，避免一次点击切两次
        const target = event.target as HTMLElement;
        if (target.closest("button, input, label, a")) return;
        onActivate();
      } : undefined}
    >
      <div className="set-row__text">
        <p className="set-row__title">
          {icon && <Icon name={icon} size={24} className="set-row__icon" />}
          <span>{title}</span>
        </p>
        {desc && <p className="set-row__desc">{desc}</p>}
      </div>
      {children && <div className="set-row__control">{children}</div>}
    </div>
  );
}
