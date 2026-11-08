import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "../../lib/api";
import type { VoiceModelStatus } from "./useVoiceMode";
import { takeSpeechSegments } from "./voice-segments";
import pcmPlaybackWorkletUrl from "./pcm-playback-worklet.ts?worker&url";

interface Segment {
  text: string;
  turnId: string;
}

interface TtsMessage {
  type: "meta" | "audio" | "done" | "error";
  sampleRate?: number;
  pcm16?: string;
  message?: string;
  turnId?: string;
}

const PLAYBACK_SAMPLE_RATE = 24_000;
const PLAYBACK_PREROLL_SECONDS = 1.92;

export function useVoiceOutput() {
  const [enabled, setEnabledState] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");
  const [model, setModel] = useState<VoiceModelStatus>({ state: "idle", progress: null, message: "" });
  const enabledRef = useRef(false);
  const audioContext = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const waveform = useRef<Float32Array<ArrayBuffer> | null>(null);
  const audioLevel = useRef(0);
  const playbackNode = useRef<AudioWorkletNode | null>(null);
  const playbackReady = useRef<Promise<AudioWorkletNode> | null>(null);
  const playbackActive = useRef(false);
  const queue = useRef<Segment[]>([]);
  const pendingText = useRef("");
  const activeTurnId = useRef<string | null>(null);
  const running = useRef(false);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const warmRequest = useRef<AbortController | null>(null);
  const warmPromise = useRef<Promise<void> | null>(null);
  const frame = useRef(0);

  const ensureAudio = useCallback(() => {
    if (!audioContext.current || audioContext.current.state === "closed") {
      const context = new AudioContext({ latencyHint: "interactive", sampleRate: PLAYBACK_SAMPLE_RATE });
      const node = context.createAnalyser();
      node.fftSize = 512;
      node.connect(context.destination);
      audioContext.current = context;
      analyser.current = node;
      waveform.current = new Float32Array(node.fftSize);
    }
    return audioContext.current;
  }, []);

  const warm = useCallback(() => {
    if (warmPromise.current) return warmPromise.current;
    const controller = new AbortController();
    warmRequest.current = controller;
    setModel({ state: "loading", progress: null, message: "正在准备本地语音模型。首次使用会下载模型。" });
    const poll = async () => {
      while (!controller.signal.aborted) {
        const response = await fetch(`${API_BASE}/api/voice/tts/status`, { signal: controller.signal });
        if (!response.ok) throw new Error("读取本地语音模型状态失败。");
        const status = await response.json() as VoiceModelStatus;
        setModel(status);
        if (status.state === "ready") return;
        if (status.state === "failed") throw new Error(status.message || "本地语音模型准备失败。");
        await new Promise((resolve) => window.setTimeout(resolve, 900));
      }
    };
    const work = (async () => {
      try {
        const pending = fetch(`${API_BASE}/api/voice/tts/warm`, { method: "POST", signal: controller.signal });
        await Promise.all([pending, poll()]);
        const response = await pending;
        if (!response.ok) {
          const result = await response.json().catch(() => ({})) as { message?: string };
          throw new Error(result.message || "本地语音模型准备失败，请重试。");
        }
        setModel(await response.json() as VoiceModelStatus);
        setError("");
      } catch (error) {
        if (!controller.signal.aborted) {
          const message = error instanceof Error ? error.message : "本地语音模型准备失败。";
          setModel({ state: "failed", progress: null, message });
          setError(message);
          throw error;
        }
      } finally {
        if (warmRequest.current === controller) {
          warmRequest.current = null;
          warmPromise.current = null;
        }
      }
    })();
    warmPromise.current = work;
    return work;
  }, []);

  const updateLevel = useCallback(() => {
    const node = analyser.current;
    const data = waveform.current;
    if (!node || !data || !playbackActive.current) {
      audioLevel.current = 0;
      frame.current = 0;
      return;
    }
    node.getFloatTimeDomainData(data);
    let total = 0;
    for (const sample of data) total += sample * sample;
    audioLevel.current = Math.min(1, Math.sqrt(total / data.length) * 3.8);
    frame.current = window.requestAnimationFrame(updateLevel);
  }, []);

  const updateSpeaking = useCallback(() => {
    const active = playbackActive.current;
    setSpeaking(active);
    if (active && !frame.current) frame.current = window.requestAnimationFrame(updateLevel);
    if (!active) {
      audioLevel.current = 0;
      if (frame.current) window.cancelAnimationFrame(frame.current);
      frame.current = 0;
    }
  }, [updateLevel]);

  const ensurePlayback = useCallback(async () => {
    const context = ensureAudio();
    if (playbackNode.current) return playbackNode.current;
    if (playbackReady.current) return playbackReady.current;
    const pending = (async () => {
      await context.audioWorklet.addModule(pcmPlaybackWorkletUrl);
      if (audioContext.current !== context || context.state === "closed") throw new Error("语音播放设备已关闭。");
      const node = new AudioWorkletNode(context, "whale-pcm-playback", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      node.port.onmessage = ({ data }: MessageEvent<{ type?: string }>) => {
        if (data.type === "started") {
          playbackActive.current = true;
          updateSpeaking();
        } else if (data.type === "drained") {
          playbackActive.current = false;
          updateSpeaking();
        }
      };
      node.port.postMessage({ type: "configure", prerollSamples: Math.ceil(context.sampleRate * PLAYBACK_PREROLL_SECONDS) });
      node.connect(analyser.current ?? context.destination);
      playbackNode.current = node;
      return node;
    })();
    playbackReady.current = pending;
    try {
      return await pending;
    } catch (error) {
      if (playbackReady.current === pending) playbackReady.current = null;
      throw error;
    }
  }, [ensureAudio, updateSpeaking]);

  const playChunk = useCallback(async (chunk: TtsMessage, token: number, turnId: string) => {
    if (token !== generation.current || activeTurnId.current !== turnId || !enabledRef.current || !chunk.pcm16 || !chunk.sampleRate) return;
    const raw = atob(chunk.pcm16);
    const samples = new Float32Array(Math.floor(raw.length / 2));
    for (let i = 0; i < samples.length; i += 1) {
      const value = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
      samples[i] = (value >= 0x8000 ? value - 0x10000 : value) / 32768;
    }
    const context = ensureAudio();
    if (chunk.sampleRate !== context.sampleRate) throw new Error("语音采样率与播放设备不匹配。");
    const node = await ensurePlayback();
    if (context.state !== "running") await context.resume();
    if (token !== generation.current || activeTurnId.current !== turnId || !enabledRef.current) return;
    node.port.postMessage({ type: "push", samples }, [samples.buffer]);
  }, [ensureAudio, ensurePlayback]);

  const synthesize = useCallback(async (segment: Segment, token: number) => {
    const controller = new AbortController();
    request.current = controller;
    const response = await fetch(`${API_BASE}/api/voice/tts/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(segment),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      const result = await response.json().catch(() => ({})) as { message?: string };
      throw new Error(result.message || `本地语音生成失败（HTTP ${response.status}）。`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let carry = "";
    let completed = false;
    const readLine = async (line: string) => {
      if (!line.trim()) return;
      const message = JSON.parse(line) as TtsMessage;
      if (message.turnId !== segment.turnId || activeTurnId.current !== segment.turnId || token !== generation.current) return;
      if (message.type === "audio") await playChunk(message, token, segment.turnId);
      else if (message.type === "error") throw new Error(message.message || "本地语音生成失败。");
      else if (message.type === "done") {
        completed = true;
        playbackNode.current?.port.postMessage({ type: "finish" });
      }
    };
    try {
      while (true) {
        const result = await reader.read();
        if (token !== generation.current || controller.signal.aborted) break;
        carry += decoder.decode(result.value, { stream: !result.done });
        const lines = carry.split("\n");
        carry = lines.pop() ?? "";
        for (const line of lines) await readLine(line);
        if (result.done) break;
      }
      await readLine(carry);
      if (!completed && token === generation.current && activeTurnId.current === segment.turnId) {
        throw new Error("本地语音流没有正常结束。");
      }
    } catch (error) {
      if (token === generation.current && activeTurnId.current === segment.turnId) {
        playbackNode.current?.port.postMessage({ type: "stop" });
        playbackActive.current = false;
        updateSpeaking();
      }
      throw error;
    } finally {
      reader.releaseLock();
      if (request.current === controller) request.current = null;
    }
  }, [playChunk, updateSpeaking]);

  const pump = useCallback(async () => {
    if (running.current || !enabledRef.current) return;
    running.current = true;
    const token = generation.current;
    try {
      while (enabledRef.current && token === generation.current && queue.current.length > 0) {
        const segment = queue.current.shift();
        if (segment) await synthesize(segment, token);
      }
    } catch (error) {
      if (token === generation.current && !(error instanceof DOMException && error.name === "AbortError")) {
        setError(error instanceof Error ? error.message : "本地语音播放失败。");
      }
    } finally {
      if (token === generation.current) {
        running.current = false;
        if (queue.current.length > 0 && enabledRef.current) void pump();
        else if (!playbackActive.current) updateSpeaking();
      }
    }
  }, [synthesize, updateSpeaking]);

  const enqueueText = useCallback((turnId: string, text: string, flush: boolean) => {
    if (activeTurnId.current !== turnId || !enabledRef.current || (!text && !flush)) return;
    pendingText.current += text;
    const segments = takeSpeechSegments(pendingText.current, flush);
    pendingText.current = segments.remainder;
    queue.current.push(...segments.ready.map((segment) => ({ text: segment, turnId })));
    if (segments.ready.length > 0) void pump();
  }, [pump]);

  const append = useCallback((text: string, turnId: string) => {
    setError((current) => current ? "" : current);
    enqueueText(turnId, text, false);
  }, [enqueueText]);
  const finish = useCallback((turnId: string) => enqueueText(turnId, "", true), [enqueueText]);

  const stop = useCallback(() => {
    generation.current += 1;
    activeTurnId.current = null;
    request.current?.abort();
    request.current = null;
    queue.current = [];
    pendingText.current = "";
    running.current = false;
    playbackNode.current?.port.postMessage({ type: "stop" });
    playbackActive.current = false;
    updateSpeaking();
  }, [updateSpeaking]);

  const beginTurn = useCallback((turnId: string) => {
    stop();
    activeTurnId.current = turnId;
  }, [stop]);

  const setEnabled = useCallback((value: boolean) => {
    if (enabledRef.current === value) return;
    enabledRef.current = value;
    setEnabledState(value);
    if (value) {
      ensureAudio();
      void ensurePlayback().catch((error: unknown) => setError(error instanceof Error ? error.message : "语音播放设备准备失败。"));
      void warm().catch(() => {});
    } else {
      stop();
      warmRequest.current?.abort();
      warmRequest.current = null;
      warmPromise.current = null;
      const context = audioContext.current;
      audioContext.current = null;
      playbackNode.current?.disconnect();
      playbackNode.current = null;
      playbackReady.current = null;
      analyser.current = null;
      waveform.current = null;
      if (context && context.state !== "closed") void context.close();
    }
  }, [ensureAudio, ensurePlayback, stop, warm]);

  const activate = useCallback((value: boolean) => {
    setEnabled(value);
    if (value) {
      const context = ensureAudio();
      if (context.state !== "running") void context.resume();
      void ensurePlayback().catch((error: unknown) => setError(error instanceof Error ? error.message : "语音播放设备准备失败。"));
    }
  }, [ensureAudio, ensurePlayback, setEnabled]);

  useEffect(() => () => {
    stop();
    warmRequest.current?.abort();
    const context = audioContext.current;
    audioContext.current = null;
    playbackNode.current?.disconnect();
    playbackNode.current = null;
    playbackReady.current = null;
    if (context && context.state !== "closed") void context.close();
  }, [stop]);

  return { enabled, speaking, error, model, audioLevel, activate, setEnabled, beginTurn, append, finish, stop, isEnabled: () => enabledRef.current };
}
