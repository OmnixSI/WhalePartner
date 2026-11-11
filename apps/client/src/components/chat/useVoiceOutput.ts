import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "../../lib/api";
import { logVoiceDiagnostic } from "../../lib/voice-diagnostics";
import type { CharacterId } from "../../characters";
import type { AvatarEmotion } from "../../avatar/model.config";
import type { VoiceModelStatus } from "./useVoiceMode";
import { createSpeechSegment, splitSpeechText, type SpeechSegment } from "./voice-segments";
import pcmPlaybackWorkletUrl from "./pcm-playback-worklet.ts?worker&url";

type Segment = SpeechSegment;

interface TtsMessage {
  type: "meta" | "audio" | "done" | "error";
  sampleRate?: number;
  pcm16?: string;
  chunkIndex?: number;
  elapsedMs?: number;
  audioDurationMs?: number;
  segmentIndex?: number;
  message?: string;
  turnId?: string;
}

interface PlaybackMessage {
  type?: string;
  phase?: string;
  turnId?: string;
  segmentIndex?: number;
  previousSegmentIndex?: number;
  chunkIndex?: number;
  bufferedSamples?: number;
  bufferedMs?: number;
  underrunCount?: number;
  durationMs?: number;
  gapMs?: number;
  reason?: string;
  expectedTurnId?: string;
  receivedTurnId?: string;
  outputRms?: number;
}

const PLAYBACK_SAMPLE_RATE = 24_000;
const PLAYBACK_PREROLL_SECONDS = 0.35;

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
  const pendingEmotion = useRef<AvatarEmotion>("neutral");
  const pendingCharacterId = useRef<CharacterId>("deepseek");
  const turnFinished = useRef<string | null>(null);
  const finishSent = useRef<string | null>(null);
  const nextSegmentIndex = useRef(0);
  const lastSegmentDoneAt = useRef<number | null>(null);
  const bufferedMs = useRef(0);
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
        if (status.state === "waiting_reference") throw new Error(status.message || "请先导入大肥鱼的 CosyVoice 音色配置。");
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
      node.port.onmessage = ({ data }: MessageEvent<PlaybackMessage>) => {
        if (data.type === "buffer") bufferedMs.current = data.bufferedMs ?? 0;
        if (data.type === "buffer" || data.type === "started" || data.type === "drained" || data.type?.startsWith("underrun") || data.type === "segment-boundary" || data.type === "turn-mismatch" || data.type === "stopped") {
          logVoiceDiagnostic(`worklet-${data.type}`, {
            turnId: data.turnId,
            phase: data.phase,
            segmentIndex: data.segmentIndex,
            previousSegmentIndex: data.previousSegmentIndex,
            chunkIndex: data.chunkIndex,
            bufferedSamples: data.bufferedSamples,
            bufferedMs: data.bufferedMs === undefined ? undefined : Math.round(data.bufferedMs * 10) / 10,
            underrunCount: data.underrunCount,
            durationMs: data.durationMs === undefined ? undefined : Math.round(data.durationMs * 10) / 10,
            gapMs: data.gapMs === undefined ? undefined : Math.round(data.gapMs * 10) / 10,
            reason: data.reason,
            expectedTurnId: data.expectedTurnId,
            receivedTurnId: data.receivedTurnId,
            outputRms: data.outputRms === undefined ? undefined : Math.round(data.outputRms * 10000) / 10000,
          });
        }
        if (data.type === "started") {
          playbackActive.current = true;
          updateSpeaking();
        } else if (data.type === "drained") {
          playbackActive.current = false;
          updateSpeaking();
        }
      };
      node.port.postMessage({
        type: "configure",
        prerollSamples: Math.ceil(context.sampleRate * PLAYBACK_PREROLL_SECONDS),
      });
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

  const playChunk = useCallback(async (chunk: TtsMessage, token: number, segment: Segment) => {
    if (token !== generation.current || activeTurnId.current !== segment.turnId || !enabledRef.current || !chunk.pcm16 || !chunk.sampleRate) return;
    const receivedAt = performance.now();
    const interSegmentMs = chunk.chunkIndex !== 0 || lastSegmentDoneAt.current === null
      ? null
      : receivedAt - lastSegmentDoneAt.current;
    logVoiceDiagnostic("client-tts-chunk", {
      turnId: segment.turnId,
      segmentIndex: segment.segmentIndex,
      chunkIndex: chunk.chunkIndex,
      elapsedMs: chunk.elapsedMs,
      audioDurationMs: chunk.audioDurationMs,
      interSegmentMs: interSegmentMs === null ? null : Math.round(interSegmentMs * 10) / 10,
      bufferedMs: Math.round(bufferedMs.current * 10) / 10,
    });
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
    if (token !== generation.current || activeTurnId.current !== segment.turnId || !enabledRef.current) return;
    node.port.postMessage({
      type: "push",
      samples,
      turnId: segment.turnId,
      segmentIndex: segment.segmentIndex,
      chunkIndex: chunk.chunkIndex,
    }, [samples.buffer]);
  }, [ensureAudio, ensurePlayback]);

  const stop = useCallback((reason = "cancelled") => {
    const turnId = activeTurnId.current;
    logVoiceDiagnostic("client-voice-stop", {
      turnId,
      reason,
      queuedSegments: queue.current.length,
      bufferedMs: Math.round(bufferedMs.current * 10) / 10,
      requestInFlight: request.current !== null,
    });
    generation.current += 1;
    activeTurnId.current = null;
    turnFinished.current = null;
    finishSent.current = null;
    request.current?.abort();
    request.current = null;
    queue.current = [];
    pendingText.current = "";
    running.current = false;
    nextSegmentIndex.current = 0;
    lastSegmentDoneAt.current = null;
    pendingEmotion.current = "neutral";
    pendingCharacterId.current = "deepseek";
    bufferedMs.current = 0;
    playbackNode.current?.port.postMessage({ type: "stop", reason });
    const sampleRate = audioContext.current?.sampleRate ?? PLAYBACK_SAMPLE_RATE;
    playbackNode.current?.port.postMessage({
      type: "configure",
      prerollSamples: Math.ceil(sampleRate * PLAYBACK_PREROLL_SECONDS),
    });
    playbackActive.current = false;
    updateSpeaking();
  }, [updateSpeaking]);

  const synthesize = useCallback(async (segment: Segment, token: number) => {
    const controller = new AbortController();
    request.current = controller;
    const startedAt = performance.now();
    logVoiceDiagnostic("client-tts-segment-start", {
      turnId: segment.turnId,
      segmentIndex: segment.segmentIndex,
      textLength: segment.text.length,
      emotion: segment.emotion,
      characterId: segment.characterId,
      previousSegmentDoneMsAgo: lastSegmentDoneAt.current === null ? null : Math.round((startedAt - lastSegmentDoneAt.current) * 10) / 10,
    });
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
      if (message.turnId !== segment.turnId || message.segmentIndex !== segment.segmentIndex || activeTurnId.current !== segment.turnId || token !== generation.current) return;
      if (message.type === "audio") await playChunk(message, token, segment);
      else if (message.type === "error") throw new Error(message.message || "本地语音生成失败。");
      else if (message.type === "done") {
        completed = true;
        lastSegmentDoneAt.current = performance.now();
        logVoiceDiagnostic("client-tts-segment-done", {
          turnId: segment.turnId,
          segmentIndex: segment.segmentIndex,
          elapsedMs: Math.round((lastSegmentDoneAt.current - startedAt) * 10) / 10,
          bufferedMs: Math.round(bufferedMs.current * 10) / 10,
        });
        playbackNode.current?.port.postMessage({ type: "segment-done", turnId: segment.turnId, segmentIndex: segment.segmentIndex });
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
        stop("tts-error");
        playbackActive.current = false;
        updateSpeaking();
      }
      throw error;
    } finally {
      reader.releaseLock();
      if (request.current === controller) request.current = null;
    }
  }, [playChunk, stop, updateSpeaking]);

  const pump = useCallback(async () => {
    if (running.current || !enabledRef.current) return;
    running.current = true;
    const token = generation.current;
    try {
      while (enabledRef.current && token === generation.current && queue.current.length > 0) {
        const first = queue.current.shift();
        if (first) await synthesize(first, token);
      }
    } catch (error) {
      if (token === generation.current && !(error instanceof DOMException && error.name === "AbortError")) {
        setError(error instanceof Error ? error.message : "本地语音播放失败。");
      }
    } finally {
      if (token === generation.current) {
        running.current = false;
        if (queue.current.length > 0 && enabledRef.current) void pump();
        else {
          const turnId = activeTurnId.current;
          if (turnId && turnFinished.current === turnId && finishSent.current !== turnId) {
            finishSent.current = turnId;
            logVoiceDiagnostic("client-turn-playback-finish", {
              turnId,
              bufferedMs: Math.round(bufferedMs.current * 10) / 10,
              segmentCount: nextSegmentIndex.current,
            });
            playbackNode.current?.port.postMessage({ type: "finish", turnId });
          }
          if (!playbackActive.current) updateSpeaking();
        }
      }
    }
  }, [synthesize, updateSpeaking]);

  const append = useCallback((text: string, turnId: string, emotion: AvatarEmotion, characterId: CharacterId) => {
    setError((current) => current ? "" : current);
    if (activeTurnId.current !== turnId || !enabledRef.current) return;
    if (!pendingText.current) {
      pendingEmotion.current = emotion;
      pendingCharacterId.current = characterId;
    }
    pendingText.current += text;
  }, []);
  const finish = useCallback((turnId: string) => {
    if (activeTurnId.current !== turnId || !enabledRef.current) return;
    turnFinished.current = turnId;
    // 服务端一次最多收 1200 字：正常长度仍是整段一次；超长才按句切成几段，依次合成播放。
    const segments = splitSpeechText(pendingText.current).flatMap((text, offset) => createSpeechSegment(
      text,
      turnId,
      nextSegmentIndex.current + offset,
      pendingEmotion.current,
      pendingCharacterId.current,
    ) ?? []);
    pendingText.current = "";
    if (segments.length > 0) {
      nextSegmentIndex.current += segments.length;
      queue.current.push(...segments);
      void pump();
      return;
    }
    if (!running.current && queue.current.length === 0 && pendingText.current.length === 0 && finishSent.current !== turnId) {
      finishSent.current = turnId;
      logVoiceDiagnostic("client-turn-playback-finish", {
        turnId,
        bufferedMs: Math.round(bufferedMs.current * 10) / 10,
        segmentCount: nextSegmentIndex.current,
      });
      playbackNode.current?.port.postMessage({ type: "finish", turnId });
    }
  }, [pump, updateSpeaking]);

  const beginTurn = useCallback((turnId: string) => {
    stop("superseded-by-new-turn");
    turnFinished.current = null;
    finishSent.current = null;
    nextSegmentIndex.current = 0;
    lastSegmentDoneAt.current = null;
    pendingEmotion.current = "neutral";
    pendingCharacterId.current = "deepseek";
    logVoiceDiagnostic("client-turn-start", { turnId });
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
