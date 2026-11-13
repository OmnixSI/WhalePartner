/**
 * 回信条（规范 §7.1.4）。文字与语音共用一条稳定高度的输入区域；语音时将文本框替换为状态和明确操作。
 * 文字草稿由 ChatPanel 保管，切换输入模式不会清空；录音发送与取消分别绑定独立操作。
 */
import { Popover } from "radix-ui";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent } from "react";
import { isSendKey, PREFS_EVENT, readSendKey, type SendKey } from "../../lib/chat-prefs";
import { Icon } from "../../icons";
import { Button, IconButton } from "../ui/Button";
import { Card } from "../ui/Card";
import { Tooltip } from "../ui/Tooltip";
import { Input, Textarea } from "../ui/Field";
import type { VoicePhase } from "./useVoiceMode";

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
  voicePhase?: VoicePhase;
  voiceRecording?: boolean;
  voiceMessage?: string;
  onStartVoice?: () => void;
  onFinishVoice?: () => void;
  onCancelRecording?: () => void;
  onStopVoice?: () => void;
  onRetryVoice?: () => void;
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

export function ComposerBar({ name, value, onChange, onSend, onStop, busy, online, focusSignal = 0, shareSignal = 0, voicePhase = "off", voiceRecording = false, voiceMessage = "", onStartVoice, onFinishVoice, onCancelRecording, onStopVoice, onRetryVoice }: Props) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [inputHeight, setInputHeight] = useState(56);
  // 输入框一行字时的高度：两侧按钮组用它做高度、在里面上下居中；多行时按钮组贴底，正好对齐最后一行
  const [rowHeight, setRowHeight] = useState(52);
  const sendKey: SendKey = useSyncExternalStore(subscribePrefs, readSendKey, () => "enter" as SendKey);
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const hasText = value.trim().length > 0;
  const canSend = online && hasText;
  // 生成中且输入框是空的：发送键就是「停」。
  const stopMode = busy && !hasText;
  const voiceMode = voicePhase !== "off";
  const voiceStarting = voicePhase === "preparing" || voicePhase === "permission";
  const voiceCanCancel = voiceRecording || voicePhase === "recognizing";
  const voiceStatus = voicePhase === "preparing"
    ? "正在准备语音"
    : voicePhase === "permission"
      ? "等待麦克风权限"
      : voiceRecording
        ? voiceMessage || "正在录音"
      : voicePhase === "recognizing"
        ? "识别中"
        : voiceMessage || "可以开始说话";
  const composerStyle = { "--composer-input-height": String(inputHeight) + "px", "--composer-row": String(rowHeight) + "px" } as CSSProperties;

  // 52 → 160 自动增高（沿用原来的手写逻辑，不引第三方）。
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const height = Math.min(160, Math.max(52, el.scrollHeight));
    el.style.height = String(height) + "px";
    setInputHeight(height);
    const cs = getComputedStyle(el);
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const line = parseFloat(cs.lineHeight);
    // 只有一行时就取实际高度（和输入框严丝合缝）；多行时按「上下内边距 + 一行」算
    setRowHeight(el.scrollHeight - pad < line * 1.5 ? el.offsetHeight : Math.round(pad + line));
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

      <Card variant="raised" padding="none" className="composer__frame">
        <div className="composer__bar" data-voice={voiceMode || undefined} style={composerStyle}>
          {voicePhase === "error" ? (
            <>
              <div
                className="composer__voice-state"
                role="alert"
                aria-live="assertive"
                aria-label={voiceMessage || "语音暂不可用"}
                title={voiceMessage || "语音暂不可用"}
                data-error
              >
                <span className="composer__voice-dot" aria-hidden />
                <span className="composer__voice-copy">语音暂不可用</span>
              </div>
              <div className="composer__actions">
                <Button variant="ghost" className="composer__text-mode" onClick={onStopVoice} aria-label="返回文字输入">文字</Button>
                <Button className="composer__voice-retry" onClick={onRetryVoice}>重试</Button>
              </div>
            </>
          ) : voiceMode ? (
            <>
              <div
                className="composer__voice-state"
                role="status"
                aria-live="polite"
                aria-label={voiceMessage || voiceStatus}
                title={voiceMessage || voiceStatus}
                data-recording={voiceRecording || undefined}
              >
                {voiceRecording ? (
                  <span className="composer__voice-wave" aria-hidden>
                    <i /><i /><i /><i />
                  </span>
                ) : (
                  <span className="composer__voice-dot" aria-hidden />
                )}
                <span className="composer__voice-copy">{voiceStatus}</span>
              </div>
              <div className="composer__actions">
                <Button variant="ghost" className="composer__text-mode" onClick={onStopVoice} aria-label="返回文字输入">文字</Button>
                {voiceCanCancel && (
                  <Button className="composer__cancel" onClick={onCancelRecording}>取消</Button>
                )}
                {voiceRecording ? (
                  <Button variant="primary" className="composer__send" icon={<Icon name="send" size={20} />} onClick={onFinishVoice} aria-label="结束录音并发送">发送</Button>
                ) : !voiceCanCancel && !voiceStarting ? (
                  <Button variant="primary" className="composer__voice-action" onClick={onStartVoice}>说话</Button>
                ) : null}
              </div>
            </>
          ) : (
            <>
          <div className="composer__toolbar">
          <Popover.Root open={shareOpen} onOpenChange={setShareOpen}>
            <Tooltip content="发个视频给她">
              <Popover.Trigger asChild>
                <IconButton label="发个视频给她"><Icon name="video" size={22} /></IconButton>
              </Popover.Trigger>
            </Tooltip>
            <Popover.Portal>
              <Popover.Content className="pop" side="top" align="start" sideOffset={8} collisionPadding={16}>
                <h3 className="pop__title">给她看个视频</h3>
                <p className="pop__lead">
                  把 B 站视频的链接贴在这里，她看完会跟你讲。她只是看，不会替你评论或点赞。
                </p>
                <Input
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
                  <Button variant="primary" onClick={share} disabled={!url.trim()}>给她看</Button>
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>

          </div>

          <label className="sr-only" htmlFor="chat-input">
            想和{name}说的话
          </label>
          <Textarea
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

          <div className="composer__actions">
          {/* 语音紧挨发送：打字和说话来回切，鼠标不用横跨整条输入框 */}
          <Tooltip content="语音聊天">
            <IconButton label="语音聊天" onClick={onStartVoice}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" />
              </svg>
            </IconButton>
          </Tooltip>
          <Button
            variant="primary"
            className="composer__send"
            icon={stopMode ? <span className="composer__stop" aria-hidden /> : <Icon name="send" size={20} />}
            onClick={submit}
            disabled={stopMode ? false : !canSend}
            aria-label={stopMode ? "停下她" : busy ? "停下她，并发送这句" : "发送"}
            data-stop={stopMode || undefined}
          >
            <span className="composer__send-label">{stopMode ? "停" : "发送"}</span>
          </Button>
          </div>
            </>
          )}
        </div>
      </Card>

      {value.length >= 1800 && (
        <span className="composer__count" data-alert={value.length >= 1950 || undefined}>
          {value.length} / {MAX}
        </span>
      )}

      <div className="composer__hint">
        <span className="composer__keys">{coarse ? "Enter 换行 · ⌘/Ctrl+Enter 发送" : sendKey === "mod-enter" ? "⌘/Ctrl+Enter 发送" : "Enter 发送 · Shift+Enter 换行"}</span>
      </div>
    </div>
  );
}
