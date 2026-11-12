/**
 * 设置页的两块骨架：`SettingGroup` 是一张卡（标题 + 一句补充 + 若干行），
 * `SettingRow` 是卡里的一行——左边标题 + 一句说明，右边控件；
 * 控件太宽（输入框、选项卡）时用 `stacked` 换到下一行。
 */
import { useId, type ReactNode } from "react";

type GroupProps = {
  title: string;
  children: ReactNode;
  /** 标题下面的一句补充（次要色） */
  note?: ReactNode;
  /** 锚点用（额度 `#quota`） */
  id?: string;
};

export function SettingGroup({ title, children, note, id }: GroupProps) {
  const titleId = useId();
  return (
    <section className="set-group" id={id} aria-labelledby={titleId}>
      <h3 className="set-group__title" id={titleId}>
        {title}
      </h3>
      {note && <p className="set-group__note">{note}</p>}
      <div className="set-group__body">{children}</div>
    </section>
  );
}

type RowProps = {
  title: string;
  desc?: ReactNode;
  children?: ReactNode;
  /** 右侧控件换行到下面（输入框、卡片组用） */
  stacked?: boolean;
  /** 整行可点：点标题/说明也能切换（开关类设置用它，别逼用户去点小圆点） */
  onActivate?: () => void;
};

export function SettingRow({ title, desc, children, stacked = false, onActivate }: RowProps) {
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
        <p className="set-row__title">{title}</p>
        {desc && <p className="set-row__desc">{desc}</p>}
      </div>
      {children && <div className="set-row__control">{children}</div>}
    </div>
  );
}
