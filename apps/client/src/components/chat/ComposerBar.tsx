/**
 * 回信条（规范 §7.1.4）。
 * `[+ 分享]` 44 图标按钮 | `<textarea>` 52→160 自动增高 | `[发送 ▷]` primary 88×56。
 * Enter 换行、Cmd/Ctrl+Enter 发送（输入法组合期不拦）；≥1800 字右下显示计数，≥1950 变 --alert。
 * 离线时仍可输入（草稿保留），发送键禁用，条上方一行 14px「连上之后就能发出去。」
 * 听写说明收进右侧 `?` 的 Popover；桌面在条下方一行 13px 快捷键提示，手机隐藏。
 */
import { Popover } from "radix-ui";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "../../icons";
import { InkFrame, InkLine } from "../ink";

type Props = {
  name: string;
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string) => void;
  busy: boolean;
  online: boolean;
  /** 自增即把焦点还给输入框（一轮说完后）。 */
  focusSignal?: number;
  /** 自增即打开「给她看个视频」这个弹层（空态芯片用）。 */
  shareSignal?: number;
};

const MAX = 2000;

export function ComposerBar({ name, value, onChange, onSend, busy, online, focusSignal = 0, shareSignal = 0 }: Props) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [url, setUrl] = useState("");
  const canSend = online && !busy && value.trim().length > 0;

  // 52 → 160 自动增高（沿用原来的手写逻辑，不引第三方）。
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(160, Math.max(52, el.scrollHeight))}px`;
  }, [value]);

  useEffect(() => {
    if (focusSignal > 0) ref.current?.focus();
  }, [focusSignal]);

  useEffect(() => {
    if (shareSignal > 0) setShareOpen(true);
  }, [shareSignal]);

  const submit = () => {
    if (!canSend) return;
    onSend(value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (!event.metaKey && !event.ctrlKey) return; // 不按修饰键 = 换行
    event.preventDefault();
    submit();
  };

  const share = () => {
    const link = url.trim();
    if (!link) return;
    setUrl("");
    setShareOpen(false);
    onSend(link);
  };

  return (
    <div className="composer">
      {!online && <p className="composer__offline">连上之后就能发出去。</p>}

      <InkFrame className="composer__frame" radius={14} stroke={2} tone="ink" fill="sheet" openCorner id="composer">
        <div className="composer__bar">
          <Popover.Root open={shareOpen} onOpenChange={setShareOpen}>
            <Popover.Trigger asChild>
              <button type="button" className="iconbtn" aria-label="发个视频给她">
                <Icon name="video" size={22} />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content className="pop" side="top" align="start" sideOffset={8} collisionPadding={16}>
                <h3 className="pop__title">给她看个视频</h3>
                <p className="pop__lead">
                  把 B 站视频的链接贴在这里，她看完会跟你讲。她只是看，不会替你评论或点赞。
                </p>
                <input
                  className="field"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://www.bilibili.com/video/…"
                  aria-label="视频链接"
                  inputMode="url"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      share();
                    }
                  }}
                />
                <div className="pop__actions">
                  <button type="button" className="btn btn--primary" onClick={share} disabled={!url.trim()}>
                    给她看
                  </button>
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>

          <label className="sr-only" htmlFor="chat-input">
            想和{name}说的话
          </label>
          <textarea
            id="chat-input"
            ref={ref}
            className="composer__input"
            rows={1}
            value={value}
            maxLength={MAX}
            placeholder={`想和${name}说点什么？`}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
          />

          <button
            type="button"
            className="btn btn--primary composer__send"
            onClick={submit}
            disabled={!canSend}
            aria-busy={busy || undefined}
            data-loading={busy || undefined}
          >
            {busy ? (
              <>
                <InkLine id="composer-busy" size={2.4} draw="loop" className="composer__busy" />
                寄出中
              </>
            ) : (
              <>
                发送
                <Icon name="send" size={20} />
              </>
            )}
          </button>
        </div>
      </InkFrame>

      {value.length >= 1800 && (
        <span className="composer__count" data-alert={value.length >= 1950 || undefined}>
          {value.length} / {MAX}
        </span>
      )}

      <div className="composer__hint">
        <span className="composer__keys">Enter 换行 · ⌘/Ctrl + Enter 发送</span>
        <Popover.Root>
          <Popover.Trigger asChild>
            <button type="button" className="iconbtn" aria-label="输入小提示">
              ?
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content className="pop pop--small" side="top" align="end" sideOffset={8} collisionPadding={16}>
              <p className="pop__lead">
                按 macOS 的听写快捷键就能用说的，文字会先放在输入框里，你检查后再发送。没反应的话，到「系统设置 › 键盘 ›
                听写」打开。
              </p>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </div>
  );
}
