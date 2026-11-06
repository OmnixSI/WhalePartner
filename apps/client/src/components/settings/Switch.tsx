/**
 * 开关（规范 §7.4 / §9.2.5）：`role="switch"` + `aria-checked`，并且**常显「开 / 关」**——
 * 状态不能只靠颜色区分。老人模式轨道 72×40、整块 ≥56 高。
 */
type Props = {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** 读屏与无图也能认的名字，例如「老人模式」 */
  label: string;
  disabled?: boolean;
};

export function Switch({ checked, onChange, label, disabled = false }: Props) {
  return (
    <button
      type="button"
      role="switch"
      className="set-switch"
      aria-checked={checked}
      aria-label={label}
      data-on={checked ? "on" : "off"}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="set-switch__track" aria-hidden="true">
        <span className="set-switch__knob" />
      </span>
      <span className="set-switch__state" aria-hidden="true">
        {checked ? "开" : "关"}
      </span>
    </button>
  );
}
