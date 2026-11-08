import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE, currentToken } from "../../lib/api";
import pcmWorkletUrl from "./pcm16-worklet.ts?worker&url";

export type VoicePhase = "off" | "permission" | "preparing" | "listening" | "recognizing" | "thinking" | "speaking" | "interrupted" | "error";
export interface VoiceModelStatus {
  state: "idle" | "loading" | "ready" | "failed";
  progress: number | null;
  message: string;
  model?: string;
}

const SPEECH_RMS = 0.018;
const SPEECH_CONFIRM_MS = 120;

interface Props {
  assistantBusy: boolean;
  assistantSpeaking?: boolean;
  onTranscript: (text: string) => void;
  onInterrupt: () => void;
}

interface AsrMessage {
  type: "ready" | "partial" | "final" | "segment-end" | "error";
  text?: string;
  message?: string;
  model?: string;
}

interface PcmFrame {
  pcm: ArrayBuffer;
  rms: number;
}

export function useVoiceMode({ assistantBusy, assistantSpeaking = false, onTranscript, onInterrupt }: Props) {
  const [phase, setPhase] = useState<VoicePhase>("off");
  const [message, setMessage] = useState("");
  const [model, setModel] = useState<VoiceModelStatus>({ state: "idle", progress: null, message: "" });
  const active = useRef(false);
  const phaseRef = useRef<VoicePhase>("off");
  const generation = useRef(0);
  const stream = useRef<MediaStream | null>(null);
  const context = useRef<AudioContext | null>(null);
  const source = useRef<MediaStreamAudioSourceNode | null>(null);
  const processor = useRef<AudioWorkletNode | null>(null);
  const silence = useRef<GainNode | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const speakingSince = useRef<number | null>(null);
  const interrupted = useRef(false);
  const assistantBusyRef = useRef(assistantBusy);
  const assistantSpeakingRef = useRef(false);
  const transcriptRef = useRef(onTranscript);
  const interruptRef = useRef(onInterrupt);
  const preparingRequest = useRef<AbortController | null>(null);

  assistantBusyRef.current = assistantBusy;
  assistantSpeakingRef.current = assistantSpeaking;
  phaseRef.current = phase;
  transcriptRef.current = onTranscript;
  interruptRef.current = onInterrupt;

  const release = useCallback(() => {
    active.current = false;
    generation.current += 1;
    preparingRequest.current?.abort();
    preparingRequest.current = null;
    const ws = socket.current;
    socket.current = null;
    if (ws && ws.readyState < WebSocket.CLOSING) ws.close(1000, "voice mode stopped");
    processor.current?.disconnect();
    source.current?.disconnect();
    silence.current?.disconnect();
    processor.current = null;
    source.current = null;
    silence.current = null;
    speakingSince.current = null;
    interrupted.current = false;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    const audioContext = context.current;
    context.current = null;
    if (audioContext && audioContext.state !== "closed") void audioContext.close();
  }, []);

  const showFailure = useCallback((detail: string, token: number) => {
    if (!active.current || token !== generation.current) return;
    setPhase("error");
    setMessage(detail);
    release();
  }, [release]);

  const consumeFrame = useCallback((frame: PcmFrame, token: number) => {
    if (!active.current || token !== generation.current) return;
    const now = performance.now();
    if (!assistantBusyRef.current && !assistantSpeakingRef.current) interrupted.current = false;
    if (frame.rms >= SPEECH_RMS) {
      speakingSince.current ??= now;
      if (now - speakingSince.current >= SPEECH_CONFIRM_MS) {
        if ((assistantBusyRef.current || assistantSpeakingRef.current) && !interrupted.current) {
          interrupted.current = true;
          interruptRef.current();
          setPhase("interrupted");
          setMessage("听到你开始说话，已停止她当前的回答。继续说即可。");
        } else if (!assistantBusyRef.current && !assistantSpeakingRef.current && phaseRef.current !== "recognizing") {
          setMessage("正在听你说话，X-ASR 会边听边识别。");
        }
      }
    } else {
      speakingSince.current = null;
    }

    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(frame.pcm);
  }, []);

  const openStream = useCallback((token: number) => new Promise<void>((resolve, reject) => {
    const endpoint = new URL(`${API_BASE}/api/voice/asr/stream`, window.location.href);
    endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
    const authToken = currentToken();
    if (authToken) endpoint.searchParams.set("token", authToken);
    const ws = new WebSocket(endpoint);
    socket.current = ws;
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("连接本机 X-ASR 超时，请重试。"));
        ws.close();
      }
    }, 15_000);
    ws.binaryType = "arraybuffer";
    ws.onmessage = (event) => {
      let data: AsrMessage;
      try { data = JSON.parse(String(event.data)) as AsrMessage; }
      catch { return; }
      if (data.type === "ready") {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        if (data.model) setModel((current) => ({ ...current, state: "ready", model: data.model }));
        resolve();
        return;
      }
      if (data.type === "partial") {
        const text = data.text?.trim();
        if (text) {
          setPhase("recognizing");
          setMessage(`X-ASR 正在识别：「${text}」`);
        }
      } else if (data.type === "final") {
        const text = data.text?.trim();
        if (text) {
          setMessage(`听到了：「${text}」`);
          if (!assistantBusyRef.current && !assistantSpeakingRef.current) setPhase("listening");
          transcriptRef.current(text);
        }
      } else if (data.type === "segment-end") {
        if (!assistantBusyRef.current && !assistantSpeakingRef.current) setPhase("listening");
      } else if (data.type === "error") {
        showFailure(data.message || "X-ASR 识别失败，请重试。", token);
      }
    };
    ws.onerror = () => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timeout);
        reject(new Error("无法连接本机 X-ASR 语音服务。"));
      }
    };
    ws.onclose = (event) => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timeout);
        reject(new Error(event.code === 1006 ? "X-ASR 语音连接中断，请重新进入语音模式。" : `X-ASR 语音服务已断开（${event.code}）。`));
      } else if (active.current && token === generation.current) {
        showFailure("X-ASR 语音连接已断开，请重试。", token);
      }
    };
  }), [showFailure]);

  const connectAudio = useCallback(async (token: number) => {
    const audioContext = context.current;
    const input = stream.current;
    if (!audioContext || !input) throw new Error("麦克风音频节点没有准备好。");
    if (!audioContext.audioWorklet || typeof AudioWorkletNode === "undefined") {
      throw new Error("当前系统不支持实时语音音频处理。请更新 macOS 或使用最新版 Safari/Chrome。");
    }
    await audioContext.audioWorklet.addModule(pcmWorkletUrl);
    if (!active.current || token !== generation.current) return;
    const inputNode = audioContext.createMediaStreamSource(input);
    const worklet = new AudioWorkletNode(audioContext, "whale-pcm16", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const mute = audioContext.createGain();
    mute.gain.value = 0;
    worklet.port.onmessage = (event: MessageEvent<PcmFrame>) => consumeFrame(event.data, token);
    inputNode.connect(worklet);
    worklet.connect(mute);
    mute.connect(audioContext.destination);
    source.current = inputNode;
    processor.current = worklet;
    silence.current = mute;
  }, [consumeFrame]);

  const warmModel = useCallback(async (token: number) => {
    const controller = new AbortController();
    preparingRequest.current = controller;
    const poll = async () => {
      while (active.current && token === generation.current && !controller.signal.aborted) {
        const response = await fetch(`${API_BASE}/api/voice/asr/status`, { signal: controller.signal });
        if (!response.ok) throw new Error("读取本地 X-ASR 状态失败。");
        const status = await response.json() as VoiceModelStatus;
        setModel(status);
        if (status.state === "ready") return;
        if (status.state === "failed") throw new Error(status.message || "X-ASR 模型准备失败。");
        await new Promise((resolve) => window.setTimeout(resolve, status.state === "loading" ? 900 : 200));
      }
    };
    try {
      const pending = fetch(`${API_BASE}/api/voice/asr/warm`, { method: "POST", signal: controller.signal });
      await Promise.all([pending, poll()]);
      const response = await pending;
      if (!response.ok) {
        const failure = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(failure.message || "X-ASR 模型准备失败，请检查本机语音组件后重试。");
      }
    } finally {
      if (preparingRequest.current === controller) preparingRequest.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    if (active.current) return;
    setPhase("permission");
    setMessage("正在请求麦克风权限。");
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase("error");
      setMessage("当前浏览器无法访问麦克风。请在 WhalePartner 桌面版或最新版 Safari/Chrome 中使用。");
      return;
    }
    const token = ++generation.current;
    active.current = true;
    try {
      const input = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (!active.current || token !== generation.current) {
        input.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = input;
      input.getAudioTracks().forEach((track) => track.addEventListener("ended", () => {
        showFailure("麦克风连接中断，请检查输入设备后重试。", token);
      }, { once: true }));
      const audioContext = new AudioContext({ latencyHint: "interactive" });
      await audioContext.resume();
      if (!active.current || token !== generation.current) {
        input.getTracks().forEach((track) => track.stop());
        void audioContext.close();
        return;
      }
      context.current = audioContext;
      setPhase("preparing");
      setMessage("正在准备本地 X-ASR 模型。麦克风音频不会保存。");
      await warmModel(token);
      if (!active.current || token !== generation.current) return;
      await openStream(token);
      if (!active.current || token !== generation.current) return;
      await connectAudio(token);
      setPhase("listening");
      setMessage("语音模式已就绪。停顿后会自动提交识别结果，可以随时打断她。");
    } catch (error) {
      if (!active.current || token !== generation.current) return;
      const cause = error as DOMException;
      const detail = cause?.name === "NotAllowedError" || cause?.name === "SecurityError"
        ? "麦克风权限未允许。到系统设置 › 隐私与安全性 › 麦克风中允许 WhalePartner 后重试。"
        : cause?.name === "NotFoundError"
          ? "没有检测到可用麦克风。接入麦克风后重试。"
          : cause?.name === "NotReadableError"
            ? "麦克风正被其他应用占用，请关闭占用后重试。"
            : error instanceof Error ? error.message : "语音模式启动失败，请检查麦克风和本地语音服务后重试。";
      setPhase("error");
      setMessage(detail);
      release();
    }
  }, [connectAudio, openStream, release, showFailure, warmModel]);

  const stop = useCallback(() => {
    release();
    setPhase("off");
    setMessage("");
  }, [release]);

  const retry = useCallback(() => {
    stop();
    void start();
  }, [start, stop]);

  useEffect(() => () => release(), [release]);

  useEffect(() => {
    if (!active.current || ["permission", "preparing", "recognizing", "error", "off"].includes(phase)) return;
    if (assistantSpeaking) setPhase("speaking");
    else if (assistantBusy) setPhase("thinking");
    else if (["speaking", "thinking", "interrupted"].includes(phase)) setPhase("listening");
  }, [assistantBusy, assistantSpeaking, phase]);

  return { active: phase !== "off", phase, message, model, start, stop, retry };
}
