/**
 * 开关（Radix Switch）：立即生效的二选一。常显「开 / 关」——状态不只靠颜色（规范 §7.4）。
 * 需要「保存」才生效的选项用 Checkbox 一类，不用开关。
 *
 *   <Switch label="老人模式" checked={on} onCheckedChange={setOn} />
 * 有可见标签时（例如设置行的标题），传 aria-labelledby 代替 label。
 */
import { Switch as S } from "radix-ui";
import { cx } from "./cx";
import "./shared.css";
import "./Switch.css";

export function Switch({ checked, defaultChecked, onCheckedChange, label, disabled, className, showState = true, ...rest }: {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
  /** 常显「开 / 关」；只有一排开关紧挨着同一个标题时才可以关 */
  showState?: boolean;
  id?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "data-preview"?: "hover" | "active" | "focus";
}) {
  return (
    <S.Root
      className={cx("ui-switch ui-focus", className)}
      checked={checked}
      defaultChecked={defaultChecked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      {...rest}
    >
      <span className="ui-switch__track ui-press" aria-hidden="true" data-preview={rest["data-preview"]}>
        <span className="ui-switch__fill" />
        <S.Thumb className="ui-switch__thumb" />
      </span>
      {showState ? (
        <span className="ui-switch__state" aria-hidden="true">
          <span className="ui-switch__on">开</span>
          <span className="ui-switch__off">关</span>
        </span>
      ) : null}
    </S.Root>
  );
}
