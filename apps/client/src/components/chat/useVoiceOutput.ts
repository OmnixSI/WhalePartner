import { useCallback, useEffect, useRef, useState } from "react";
import type { AvatarEmotion } from "../../avatar/model.config";
import { API_BASE } from "../../lib/api";
import type { VoiceModelStatus } from "./useVoiceMode";

interface Segment {
  text: string;
  emotion: AvatarEmotion;
}

interface TtsMessage {
  type: "meta" | "audio" | "done" | "error";
  sampleRate?: number;
  pcm16?: string;
  message?: string;
}

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
  const playbackAt = useRef(0);
  const sources = useRef(new Set<AudioBufferSourceNode>());
  const queue = useRef<Segment[]>([]);
  const pendingText = useRef("");
  const running = useRef(false);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const warmRequest = useRef<AbortController | null>(null);
  const warmPromise = useRef<Promise<void> | null>(null);
  const frame = useRef(0);

  const ensureAudio = useCallback(() => {
    if (!audioContext.current || audioContext.current.state === "closed") {
      const context = new AudioContext();
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
    if (!node || !data || sources.current.size === 0) {
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
    const active = sources.current.size > 0;
    setSpeaking(active);
    if (active && !frame.current) frame.current = window.requestAnimationFrame(updateLevel);
    if (!active) {
      audioLevel.current = 0;
      if (frame.current) window.cancelAnimationFrame(frame.current);
      frame.current = 0;
    }
  }, [updateLevel]);

  const playChunk = useCallback(async (chunk: TtsMessage, token: number) => {
    if (token !== generation.current || !enabledRef.current) return;
    const context = ensureAudio();
    if (context.state !== "running") await context.resume();
    if (token !== generation.current || !enabledRef.current || !chunk.pcm16 || !chunk.sampleRate) return;
    const raw = atob(chunk.pcm16);
    const samples = new Float32Array(Math.floor(raw.length / 2));
    for (let i = 0; i < samples.length; i += 1) {
      const value = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
      samples[i] = (value >= 0x8000 ? value - 0x10000 : value) / 32768;
    }
    const buffer = context.createBuffer(1, samples.length, chunk.sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(analyser.current ?? context.destination);
    sources.current.add(source);
    source.onended = () => {
      sources.current.delete(source);
      source.disconnect();
      if (queue.current.length === 0 && !running.current && sources.current.size === 0) updateSpeaking();
    };
    const startsAt = Math.max(context.currentTime + 0.025, playbackAt.current);
    source.start(startsAt);
    playbackAt.current = startsAt + buffer.duration;
    updateSpeaking();
  }, [ensureAudio, updateSpeaking]);

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
    const readLine = async (line: string) => {
      if (!line.trim()) return;
      const message = JSON.parse(line) as TtsMessage;
      if (message.type === "audio") await playChunk(message, token);
      else if (message.type === "error") throw new Error(message.message || "本地语音生成失败。");
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
    } finally {
      reader.releaseLock();
      if (request.current === controller) request.current = null;
    }
  }, [playChunk]);

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
        else if (sources.current.size === 0) updateSpeaking();
      }
    }
  }, [synthesize, updateSpeaking]);

  const enqueueText = useCallback((text: string, emotion: AvatarEmotion, flush: boolean) => {
    if (!enabledRef.current || (!text && !flush)) return;
    pendingText.current += text;
    while (pendingText.current) {
      const boundary = /[。！？!?；;\n]|\.(?=\s|$)/g;
      let match: RegExpExecArray | null;
      let cut = -1;
      while ((match = boundary.exec(pendingText.current)) !== null) cut = match.index + match[0].length;
      if (cut < 0 && pendingText.current.length > 120) {
        const limit = Math.min(120, pendingText.current.length);
        for (const mark of ["，", "、", ",", " "]) {
          const idx = pendingText.current.lastIndexOf(mark, limit);
          if (idx >= 60) { cut = idx + mark.length; break; }
        }
        if (cut < 0) cut = limit;
      }
      if (cut < 0 && !flush) break;
      if (cut < 0) cut = pendingText.current.length;
      const sentence = pendingText.current.slice(0, cut).trim();
      pendingText.current = pendingText.current.slice(cut);
      if (sentence) queue.current.push({ text: sentence, emotion });
    }
    void pump();
  }, [pump]);

  const append = useCallback((text: string, emotion: AvatarEmotion) => {
    setError((current) => current ? "" : current);
    enqueueText(text, emotion, false);
  }, [enqueueText]);
  const finish = useCallback(() => enqueueText("", "neutral", true), [enqueueText]);

  const stop = useCallback(() => {
    generation.current += 1;
    request.current?.abort();
    request.current = null;
    queue.current = [];
    pendingText.current = "";
    running.current = false;
    playbackAt.current = 0;
    for (const source of sources.current) {
      try { source.stop(); } catch { /* 已结束的片段 */ }
      source.disconnect();
    }
    sources.current.clear();
    updateSpeaking();
  }, [updateSpeaking]);

  const setEnabled = useCallback((value: boolean) => {
    if (enabledRef.current === value) return;
    enabledRef.current = value;
    setEnabledState(value);
    if (value) {
      ensureAudio();
      void warm().catch(() => {});
    } else {
      stop();
      warmRequest.current?.abort();
      warmRequest.current = null;
      warmPromise.current = null;
      const context = audioContext.current;
      audioContext.current = null;
      analyser.current = null;
      waveform.current = null;
      if (context && context.state !== "closed") void context.close();
    }
  }, [ensureAudio, stop, warm]);

  const activate = useCallback((value: boolean) => {
    setEnabled(value);
    if (value) {
      const context = ensureAudio();
      if (context.state !== "running") void context.resume();
    }
  }, [ensureAudio, setEnabled]);

  useEffect(() => () => {
    stop();
    warmRequest.current?.abort();
    const context = audioContext.current;
    audioContext.current = null;
    if (context && context.state !== "closed") void context.close();
  }, [stop]);

  return { enabled, speaking, error, model, audioLevel, activate, setEnabled, append, finish, stop, isEnabled: () => enabledRef.current };
}
