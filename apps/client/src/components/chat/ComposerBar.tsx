/**
 * 回信条（规范 §7.1.4）。
 * `[+ 分享]` 44 图标按钮 | `<textarea>` 52→160 自动增高 | `[发送 ▷]` primary 88×56。
 * 默认 Enter 发送、Shift+Enter 换行（设置里可切回 Cmd/Ctrl+Enter 发送；触屏 Enter 恒为换行；输入法组合期不拦）。
 * 生成中发送键变「停」；此时输入框仍可打字，有字时按发送 = 先停后发。≥1800 字右下显示计数，≥1950 变 --alert。
 * 离线时仍可输入（草稿保留），发送键禁用，条上方一行 14px「连上之后就能发出去。」
 * 听写说明收进右侧 `?` 的 Popover；桌面在条下方一行 13px 快捷键提示，手机隐藏。
 */
import { Popover } from "radix-ui";
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { isSendKey, PREFS_EVENT, readSendKey, type SendKey } from "../../lib/chat-prefs";
import { Icon } from "../../icons";
import { InkFrame, InkLine } from "../ink";

type Props = {
  name: string;
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string) => void;
  /** 生成中点「停」。 */
  onStop?: () => void;
  busy: boolean;
  online: boolean;
  /** 自增即把焦点还给输入框（一轮说完后）。 */
  focusSignal?: number;
  /** 自增即打开「给她看个视频」这个弹层（空态芯片用）。 */
  shareSignal?: number;
};

const MAX = 2000;

function subscribePrefs(callback: () => void) {
  window.addEventListener(PREFS_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(PREFS_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function ComposerBar({ name, value, onChange, onSend, onStop, busy, online, focusSignal = 0, shareSignal = 0 }: Props) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [url, setUrl] = useState("");
  const sendKey: SendKey = useSyncExternalStore(subscribePrefs, readSendKey, () => "enter" as SendKey);
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const hasText = value.trim().length > 0;
  const canSend = online && hasText;
  // 生成中且输入框是空的：发送键就是「停」。
  const stopMode = busy && !hasText;

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
    if (stopMode) { onStop?.(); return; }
    if (!canSend) return;
    onSend(value);
    // 发完焦点还在输入框里，连发不用再点。
    ref.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return; // 输入法选词的回车不发送
    if (!isSendKey(event, sendKey, coarse)) return; // Shift+Enter / 触屏 Enter = 换行
    event.preventDefault();
    if (canSend) submit();
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
                    if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
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
            disabled={stopMode ? false : !canSend}
            aria-label={stopMode ? "停下她" : busy ? "停下她，并发送这句" : undefined}
            data-stop={stopMode || undefined}
          >
            {stopMode ? (
              <>
                <InkLine id="composer-busy" size={2.4} draw="loop" className="composer__busy" />
                停
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
        <span className="composer__keys">{coarse || sendKey === "mod-enter" ? "Enter 换行 · ⌘/Ctrl + Enter 发送" : "Enter 发送 · Shift + Enter 换行"}</span>
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
