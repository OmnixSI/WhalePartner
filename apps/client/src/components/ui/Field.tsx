/**
 * 表单字段：标签 + 控件 + 说明 / 错误。Field 通过 context 把 id、aria-describedby、aria-invalid
 * 交给里面的 Input / Textarea / Select，页面不用手写这几个属性。
 *
 *   <Field label="昵称" hint="她会这样叫你" error={err}><Input value={v} onChange={…} /></Field>
 */
import { createContext, forwardRef, useContext, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cx } from "./cx";
import "./shared.css";
import "./Field.css";

type FieldCtx = { id: string; describedBy?: string; invalid: boolean; disabled: boolean };
const Ctx = createContext<FieldCtx | null>(null);
export const useField = () => useContext(Ctx);

export function Field({ label, hint, error, disabled = false, children, className }: {
  label: ReactNode;
  hint?: ReactNode;
  /** 有值即进入错误态；写清「怎么改」而不是「错了」 */
  error?: ReactNode;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [errId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <Ctx.Provider value={{ id, describedBy, invalid: Boolean(error), disabled }}>
      <div className={cx("ui-field", className)} data-disabled={disabled || undefined}>
        <label className="ui-field__label" htmlFor={id}>{label}</label>
        {children}
        {error ? <p className="ui-field__error" id={errId}>{error}</p> : null}
        {hint ? <p className="ui-field__hint" id={hintId}>{hint}</p> : null}
      </div>
    </Ctx.Provider>
  );
}

/** 把 Field 的 id / 描述 / 错误态合并进控件自己的属性（控件自己写了的优先） */
export function useFieldProps<T extends { id?: string; "aria-describedby"?: string; "aria-invalid"?: unknown; disabled?: boolean }>(props: T) {
  const f = useField();
  if (!f) return props;
  return {
    ...props,
    id: props.id ?? f.id,
    "aria-describedby": props["aria-describedby"] ?? f.describedBy,
    "aria-invalid": props["aria-invalid"] ?? (f.invalid || undefined),
    disabled: props.disabled ?? f.disabled,
  };
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { "data-preview"?: "hover" | "focus" };
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cx("ui-input", className)} {...useFieldProps(props)} />;
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { "data-preview"?: "hover" | "focus" };
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, rows = 3, ...props }, ref) {
  return <textarea ref={ref} rows={rows} className={cx("ui-input ui-input--area", className)} {...useFieldProps(props)} />;
});
