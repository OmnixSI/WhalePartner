import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE, currentToken } from "../../lib/api";
import { logVoiceDiagnostic } from "../../lib/voice-diagnostics";
import pcmWorkletUrl from "./pcm16-worklet.ts?worker&url";
import { m } from "../../i18n";

export type VoicePhase = "off" | "permission" | "preparing" | "ready" | "listening" | "recognizing" | "thinking" | "speaking" | "interrupted" | "error";
export interface VoiceModelStatus {
  state: "idle" | "waiting_reference" | "loading" | "ready" | "failed";
  progress: number | null;
  message: string;
  model?: string;
  offlineRefinement?: "idle" | "loading" | "ready" | "unavailable";
}

const FINISH_TIMEOUT_MS = 20_000;

interface Props {
  assistantBusy: boolean;
  assistantSpeaking?: boolean;
  onTranscript: (text: string) => void;
  onInterrupt: (reason: string) => void;
}

interface AsrMessage {
  type: "ready" | "partial" | "final" | "segment-end" | "finished" | "error";
  text?: string;
  message?: string;
  model?: string;
  offlineRefinement?: VoiceModelStatus["offlineRefinement"];
}

interface PcmFrame {
  pcm: ArrayBuffer;
}

interface FinishWaiter {
  resolve(): void;
  reject(error: Error): void;
  timer: number;
}

function mergeTranscriptParts(parts: string[]): string {
  return parts.reduce((merged, part) => {
    const next = part.trim();
    if (!next) return merged;
    if (!merged) return next;
    const lastCharacter = Array.from(merged).at(-1) ?? "";
    const firstCharacter = Array.from(next)[0] ?? "";
    const touchesCjk = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(lastCharacter)
      || /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(firstCharacter);
    return `${merged}${touchesCjk ? "" : " "}${next}`;
  }, "").replace(/([，。！？、；：])\s+/gu, "$1").trim(); // i18n-ignore：中文标点后空白清理正则
}

function startErrorMessage(error: unknown): string {
  const cause = error as DOMException;
  if (cause?.name === "NotAllowedError" || cause?.name === "SecurityError") {
    return m.chat.voiceMode.micDenied;
  }
  if (cause?.name === "NotFoundError") return m.chat.voiceMode.micNotFound;
  if (cause?.name === "NotReadableError") return m.chat.voiceMode.micBusy;
  return error instanceof Error ? error.message : m.chat.voiceMode.startFailed;
}

export function useVoiceMode({ assistantBusy, assistantSpeaking = false, onTranscript, onInterrupt }: Props) {
  const [phase, setPhase] = useState<VoicePhase>("off");
  const [message, setMessage] = useState("");
  const [recording, setRecording] = useState(false);
  const [model, setModel] = useState<VoiceModelStatus>({ state: "idle", progress: null, message: "" });
  const active = useRef(false);
  const generation = useRef(0);
  const stream = useRef<MediaStream | null>(null);
  const context = useRef<AudioContext | null>(null);
  const source = useRef<MediaStreamAudioSourceNode | null>(null);
  const processor = useRef<AudioWorkletNode | null>(null);
  const silence = useRef<GainNode | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const recordingRef = useRef(false);
  const finishing = useRef(false);
  const transcriptParts = useRef<string[]>([]);
  const finishWaiter = useRef<FinishWaiter | null>(null);
  const assistantBusyRef = useRef(assistantBusy);
  const assistantSpeakingRef = useRef(false);
  const transcriptRef = useRef(onTranscript);
  const interruptRef = useRef(onInterrupt);
  const preparingRequest = useRef<AbortController | null>(null);

  assistantBusyRef.current = assistantBusy;
  assistantSpeakingRef.current = assistantSpeaking;
  transcriptRef.current = onTranscript;
  interruptRef.current = onInterrupt;

  const interruptAssistant = useCallback(() => {
    const assistantBusyNow = assistantBusyRef.current;
    const assistantSpeakingNow = assistantSpeakingRef.current;
    if (!assistantBusyNow && !assistantSpeakingNow) return;
    const reason = "voice-button-started-recording";
    logVoiceDiagnostic("voice-interruption", {
      reason,
      assistantBusy: assistantBusyNow,
      assistantSpeaking: assistantSpeakingNow,
    });
    interruptRef.current(reason);
  }, []);

  const releaseCapture = useCallback(() => {
    recordingRef.current = false;
    setRecording(false);
    processor.current?.disconnect();
    source.current?.disconnect();
    silence.current?.disconnect();
    processor.current = null;
    source.current = null;
    silence.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    const audioContext = context.current;
    context.current = null;
    if (audioContext && audioContext.state !== "closed") void audioContext.close();
  }, []);

  const release = useCallback(() => {
    active.current = false;
    generation.current += 1;
    preparingRequest.current?.abort();
    preparingRequest.current = null;
    const pendingFinish = finishWaiter.current;
    finishWaiter.current = null;
    if (pendingFinish) {
      window.clearTimeout(pendingFinish.timer);
      pendingFinish.reject(new Error(m.chat.voiceMode.ended));
    }
    const ws = socket.current;
    socket.current = null;
    if (ws && ws.readyState < WebSocket.CLOSING) ws.close(1000, "voice mode stopped");
    releaseCapture();
    finishing.current = false;
    transcriptParts.current = [];
  }, [releaseCapture]);

  const showFailure = useCallback((detail: string, token: number) => {
    if (!active.current || token !== generation.current) return;
    setPhase("error");
    setMessage(detail);
    release();
  }, [release]);

  const consumeFrame = useCallback((frame: PcmFrame, token: number) => {
    const ws = socket.current;
    if (!active.current || token !== generation.current || !recordingRef.current || ws?.readyState !== WebSocket.OPEN) return;
    ws.send(frame.pcm);
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
        reject(new Error(m.chat.voiceMode.connectTimeout));
        ws.close();
      }
    }, 15_000);
    ws.binaryType = "arraybuffer";
    ws.onmessage = (event) => {
      if (!active.current || token !== generation.current) return;
      let data: AsrMessage;
      try { data = JSON.parse(String(event.data)) as AsrMessage; }
      catch { return; }
      if (data.type === "ready") {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        if (data.model) setModel((current) => ({
          ...current,
          state: "ready",
          model: data.model,
          offlineRefinement: data.offlineRefinement,
        }));
        resolve();
        return;
      }
      if (data.type === "partial") {
        const text = data.text?.trim();
        if (text) {
          setPhase("recognizing");
          setMessage(m.chat.voiceMode.recognized(text));
        }
      } else if (data.type === "final") {
        const text = data.text?.trim();
        if (text) {
          transcriptParts.current.push(text);
          if (recordingRef.current) {
            setPhase("listening");
            setMessage(m.chat.voiceMode.recognized(text));
          }
        }
      } else if (data.type === "segment-end") {
        if (recordingRef.current) setMessage(m.chat.voiceMode.keepGoing);
      } else if (data.type === "finished") {
        const pendingFinish = finishWaiter.current;
        finishWaiter.current = null;
        if (pendingFinish) {
          window.clearTimeout(pendingFinish.timer);
          pendingFinish.resolve();
        }
      } else if (data.type === "error") {
        const pendingFinish = finishWaiter.current;
        finishWaiter.current = null;
        if (pendingFinish) {
          window.clearTimeout(pendingFinish.timer);
          pendingFinish.reject(new Error(data.message || m.chat.voiceMode.asrFailed));
        }
        showFailure(data.message || m.chat.voiceMode.asrFailed, token);
      }
    };
    ws.onerror = () => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timeout);
        reject(new Error(m.chat.voiceMode.cannotConnect));
      }
    };
    ws.onclose = (event) => {
      const pendingFinish = finishWaiter.current;
      finishWaiter.current = null;
      if (pendingFinish) {
        window.clearTimeout(pendingFinish.timer);
        pendingFinish.reject(new Error(m.chat.voiceMode.disconnected));
      }
      if (!settled) {
        settled = true;
        window.clearTimeout(timeout);
        reject(new Error(event.code === 1006 ? m.chat.voiceMode.interrupted : m.chat.voiceMode.closedWithCode(event.code)));
      } else if (active.current && token === generation.current) {
        showFailure(m.chat.voiceMode.disconnected, token);
      }
    };
  }), [showFailure]);

  const connectAudio = useCallback(async (token: number) => {
    const audioContext = context.current;
    const input = stream.current;
    if (!audioContext || !input) throw new Error(m.chat.voiceMode.audioNodeNotReady);
    if (!audioContext.audioWorklet || typeof AudioWorkletNode === "undefined") {
      throw new Error(m.chat.voiceMode.audioUnsupported);
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

  const startCapture = useCallback(async (token: number) => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error(m.chat.voiceMode.browserNoMic);
    setPhase("permission");
    setMessage(m.chat.voiceMode.waitingMic);
    const input = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: false },
    });
    if (!active.current || token !== generation.current) {
      input.getTracks().forEach((track) => track.stop());
      return;
    }
    stream.current = input;
    input.getAudioTracks().forEach((track) => {
      const settings = track.getSettings();
      logVoiceDiagnostic("microphone-settings", {
        echoCancellation: settings.echoCancellation ?? null,
        noiseSuppression: settings.noiseSuppression ?? null,
        autoGainControl: settings.autoGainControl ?? null,
        sampleRate: settings.sampleRate ?? null,
      });
      track.addEventListener("ended", () => {
        showFailure(m.chat.voiceMode.micDisconnected, token);
      }, { once: true });
    });
    const audioContext = new AudioContext({ latencyHint: "interactive" });
    await audioContext.resume();
    if (!active.current || token !== generation.current) {
      input.getTracks().forEach((track) => track.stop());
      void audioContext.close();
      return;
    }
    context.current = audioContext;
    await connectAudio(token);
    if (!active.current || token !== generation.current) return;
    transcriptParts.current = [];
    recordingRef.current = true;
    setRecording(true);
    setPhase("listening");
    setMessage(m.chat.voiceMode.recording);
  }, [connectAudio, showFailure]);

  const warmModel = useCallback(async (token: number) => {
    const controller = new AbortController();
    preparingRequest.current = controller;
    try {
      const pending = fetch(`${API_BASE}/api/voice/asr/warm`, { method: "POST", signal: controller.signal });
      // warm 一返回就停止轮询：不然要再等完一个 900 ms 的轮询间隔才进入录音（#149）。
      let settled = false;
      const done = pending.then(() => { settled = true; }, () => { settled = true; });
      const poll = async () => {
        while (!settled && active.current && token === generation.current && !controller.signal.aborted) {
          const response = await fetch(`${API_BASE}/api/voice/asr/status`, { signal: controller.signal });
          if (!response.ok) throw new Error(m.chat.voiceMode.statusReadFailed);
          const status = await response.json() as VoiceModelStatus;
          setModel(status);
          if (status.state === "ready") return;
          if (status.state === "failed") throw new Error(status.message || m.chat.voiceMode.modelFailed);
          await Promise.race([new Promise((resolve) => window.setTimeout(resolve, status.state === "loading" ? 900 : 200)), done]);
        }
      };
      await Promise.all([pending, poll()]);
      const response = await pending;
      if (!response.ok) {
        const failure = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(failure.message || m.chat.voiceMode.modelFailedRetry);
      }
      setModel(await response.json() as VoiceModelStatus);
    } finally {
      if (preparingRequest.current === controller) preparingRequest.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    if (active.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase("error");
      setMessage(m.chat.voiceMode.browserNoMic);
      return;
    }
    const token = ++generation.current;
    active.current = true;
    transcriptParts.current = [];
    interruptAssistant();
    try {
      setPhase("preparing");
      setMessage(m.chat.voiceMode.preparing);
      await warmModel(token);
      if (!active.current || token !== generation.current) return;
      await openStream(token);
      if (!active.current || token !== generation.current) return;
      await startCapture(token);
    } catch (error) {
      if (!active.current || token !== generation.current) return;
      setPhase("error");
      setMessage(startErrorMessage(error));
      release();
    }
  }, [interruptAssistant, openStream, release, startCapture, warmModel]);

  const finishRecording = useCallback(async () => {
    if (!active.current || !recordingRef.current || finishing.current) return;
    const token = generation.current;
    recordingRef.current = false;
    setRecording(false);
    finishing.current = true;
    setPhase("recognizing");
    setMessage(m.chat.voiceMode.finishing);
    const ws = socket.current;
    if (ws?.readyState !== WebSocket.OPEN) {
      finishing.current = false;
      showFailure(m.chat.voiceMode.disconnected, generation.current);
      return;
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          if (finishWaiter.current?.timer === timer) finishWaiter.current = null;
          reject(new Error(m.chat.voiceMode.finishTimeout));
        }, FINISH_TIMEOUT_MS);
        finishWaiter.current = {
          resolve: () => { window.clearTimeout(timer); resolve(); },
          reject: (error) => { window.clearTimeout(timer); reject(error); },
          timer,
        };
        try {
          ws.send(JSON.stringify({ type: "finish" }));
        } catch (error) {
          window.clearTimeout(timer);
          finishWaiter.current = null;
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
      if (!active.current || token !== generation.current) return;
      const text = mergeTranscriptParts(transcriptParts.current);
      transcriptParts.current = [];
      releaseCapture();
      finishing.current = false;
      if (!text) {
        setPhase("ready");
        setMessage(m.chat.voiceMode.nothingHeard);
        return;
      }
      setPhase("ready");
      setMessage(m.chat.voiceMode.sent(text));
      transcriptRef.current(text);
    } catch (error) {
      if (!active.current || token !== generation.current) return;
      finishing.current = false;
      showFailure(error instanceof Error ? error.message : m.chat.voiceMode.finishFailed, token);
    }
  }, [releaseCapture, showFailure]);

  const cancelRecording = useCallback(async () => {
    if (!active.current || (!recordingRef.current && !finishing.current)) return;
    const token = ++generation.current;
    const pendingFinish = finishWaiter.current;
    finishWaiter.current = null;
    if (pendingFinish) pendingFinish.resolve();
    const ws = socket.current;
    socket.current = null;
    if (ws && ws.readyState < WebSocket.CLOSING) ws.close(1000, "recording canceled");
    releaseCapture();
    finishing.current = false;
    transcriptParts.current = [];
    setPhase("preparing");
    setMessage(m.chat.voiceMode.preparing);
    try {
      await openStream(token);
      if (!active.current || token !== generation.current) return;
      setPhase("ready");
      setMessage(m.chat.voiceMode.cancelled);
    } catch (error) {
      if (!active.current || token !== generation.current) return;
      setPhase("error");
      setMessage(startErrorMessage(error));
      release();
    }
  }, [openStream, release, releaseCapture]);

  const toggleRecording = useCallback(() => {
    if (!active.current) {
      void start();
      return;
    }
    if (finishing.current) return;
    if (recordingRef.current) {
      void finishRecording();
      return;
    }
    interruptAssistant();
    transcriptParts.current = [];
    const token = generation.current;
    void startCapture(token).catch((error: unknown) => {
      if (!active.current || token !== generation.current) return;
      setPhase("error");
      setMessage(startErrorMessage(error));
      release();
    });
  }, [finishRecording, interruptAssistant, release, start, startCapture]);

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
    else if (["speaking", "thinking", "interrupted"].includes(phase)) {
      setPhase(recordingRef.current ? "listening" : "ready");
      setMessage(m.chat.voiceMode.answerDone);
    }
  }, [assistantBusy, assistantSpeaking, phase]);

  return { active: phase !== "off", phase, message, model, recording, start, stop, retry, toggleRecording, finishRecording, cancelRecording };
}
