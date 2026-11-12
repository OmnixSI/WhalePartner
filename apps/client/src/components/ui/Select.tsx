/**
 * 下拉选择（Radix Select）：触发器长得像输入框，弹层是 popover 表面。
 * 选项少于 4 个、又都要一眼看到时，用 Tabs 的分段样式或单选，不用下拉。
 *
 *   <Field label="声音"><Select value={v} onValueChange={setV} options={[{ value: "a", label: "温柔" }]} /></Field>
 */
import { Select as S } from "radix-ui";
import { cx } from "./cx";
import { useFieldProps } from "./Field";
import { Check, ChevronDown } from "./glyphs";
import "./shared.css";
import "./Field.css";
import "./Select.css";

export type SelectOption = { value: string; label: string; disabled?: boolean };

export function Select({ value, defaultValue, onValueChange, open, options, placeholder = "请选择", disabled, className, id, ...aria }: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  /** 受控展开；只给预览页钉住截图用 */
  open?: boolean;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "data-preview"?: "hover" | "focus";
}) {
  const field = useFieldProps({ id, disabled, "aria-describedby": aria["aria-describedby"], "aria-invalid": aria["aria-invalid"] });
  return (
    <S.Root open={open} value={value} defaultValue={defaultValue} onValueChange={onValueChange} disabled={field.disabled}>
      <S.Trigger
        id={field.id}
        className={cx("ui-input ui-select", className)}
        aria-label={aria["aria-label"]}
        aria-describedby={field["aria-describedby"]}
        aria-invalid={field["aria-invalid"] as boolean | undefined}
        data-preview={aria["data-preview"]}
      >
        <S.Value placeholder={placeholder} />
        <S.Icon className="ui-select__chevron"><ChevronDown /></S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content className="ui-select__content ui-pop" position="popper" sideOffset={6} collisionPadding={12}>
          <S.Viewport className="ui-select__viewport">
            {options.map((o) => (
              <S.Item key={o.value} value={o.value} disabled={o.disabled} className="ui-select__item ui-press">
                <S.ItemText>{o.label}</S.ItemText>
                <S.ItemIndicator className="ui-select__check"><Check /></S.ItemIndicator>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
