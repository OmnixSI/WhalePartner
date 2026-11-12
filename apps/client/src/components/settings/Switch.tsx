/** 设置里的开关：套一层 ui/Switch，保留 `onChange` 的写法，常显「开 / 关」。 */
import { Switch as UiSwitch } from "../ui/Switch";

type Props = {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** 读屏与无图也能认的名字，例如「老人模式」 */
  label: string;
  disabled?: boolean;
};

export function Switch({ checked, onChange, label, disabled = false }: Props) {
  return <UiSwitch checked={checked} onCheckedChange={onChange} label={label} disabled={disabled} />;
}
