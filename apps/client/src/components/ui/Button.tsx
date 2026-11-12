/**
 * 按钮：主按钮 / 次按钮 / 幽灵按钮 / 危险按钮，外加 IconButton（图标按钮）。
 *
 * - 一屏只放一个主按钮；危险按钮只用在「确认删除」这类不可撤销的最后一步，平时的删除入口用幽灵或次按钮。
 * - loading 时保持宽度、不可点、读屏读到「忙」；disabled 的按钮仍可聚焦说明原因时，用 aria-disabled 而不是 disabled。
 *
 * 结构改写自 meta/astryx 的 Button（MIT，见 THIRD_PARTY_NOTICES.md）：hover 叠层、按下微缩（触屏与降级动效下不缩）、
 * 危险按钮焦点环同色。样式改为普通 CSS + 鲸汐 token。
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";
import { Spinner } from "./glyphs";
import "./shared.css";
import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "lg";

type Common = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** 只给 /__kit 预览页钉住状态拍图 */
  "data-preview"?: "hover" | "active" | "focus";
};

export type ButtonProps = Common & {
  children: ReactNode;
  /** 文字前的图标（16–20px，装饰性） */
  icon?: ReactNode;
  /** 撑满父容器宽度（窄屏底部操作条） */
  block?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, icon, block, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx("ui-btn ui-press ui-focus", `ui-btn--${variant}`, size === "lg" && "ui-btn--lg", block && "ui-btn--block", className)}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      data-loading={loading || undefined}
      {...rest}
      onClick={loading ? undefined : rest.onClick}
    >
      {loading ? <span className="ui-btn__spin"><Spinner /></span> : null}
      <span className="ui-btn__body">
        {icon ? <span className="ui-btn__icon">{icon}</span> : null}
        <span>{children}</span>
      </span>
    </button>
  );
});

export type IconButtonProps = Common & {
  /** 必填：图标按钮没有可见文字，读屏和提示都靠它 */
  label: string;
  children: ReactNode;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = "ghost", size = "md", loading = false, label, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={cx("ui-btn ui-btn--icon ui-press ui-focus", `ui-btn--${variant}`, size === "lg" && "ui-btn--lg", className)}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      data-loading={loading || undefined}
      {...rest}
      onClick={loading ? undefined : rest.onClick}
    >
      {loading ? <span className="ui-btn__spin"><Spinner /></span> : null}
      <span className="ui-btn__body ui-btn__icon">{children}</span>
    </button>
  );
});
