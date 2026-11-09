export {};

declare const sampleRate: number;
declare const currentTime: number;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

interface PlaybackChunk {
  samples: Float32Array;
  turnId: string;
  segmentIndex: number;
  chunkIndex: number;
}

interface PlaybackMessage {
  type: "configure" | "push" | "segment-done" | "finish" | "stop";
  samples?: Float32Array;
  prerollSamples?: number;
  turnId?: string;
  segmentIndex?: number;
  chunkIndex?: number;
  reason?: string;
}

class PcmPlaybackWorklet extends AudioWorkletProcessor {
  #chunks: PlaybackChunk[] = [];
  #chunkOffset = 0;
  #bufferedSamples = 0;
  #prerollSamples = Math.ceil(sampleRate * 2);
  #finished = false;
  #started = false;
  #turnId: string | null = null;
  #segmentIndex: number | null = null;
  #underrunStartedAt: number | null = null;
  #underrunCount = 0;
  #lastBufferReportAt = 0;

  constructor(options?: AudioWorkletNodeOptions) {
    super(options);
    this.port.onmessage = ({ data }: MessageEvent<PlaybackMessage>) => {
      if (data.type === "configure" && data.prerollSamples) {
        this.#prerollSamples = data.prerollSamples;
      } else if (data.type === "push" && data.samples?.length) {
        const turnId = data.turnId ?? this.#turnId ?? "";
        const segmentIndex = data.segmentIndex ?? 0;
        if (this.#turnId && turnId && this.#turnId !== turnId) {
          this.port.postMessage({ type: "turn-mismatch", expectedTurnId: this.#turnId, receivedTurnId: turnId });
          return;
        }
        this.#turnId = turnId;
        this.#chunks.push({
          samples: data.samples,
          turnId,
          segmentIndex,
          chunkIndex: data.chunkIndex ?? 0,
        });
        this.#bufferedSamples += data.samples.length;
        this.#finished = false;
        this.port.postMessage({
          type: "buffer",
          phase: "queued",
          turnId,
          segmentIndex,
          chunkIndex: data.chunkIndex,
          bufferedSamples: this.#bufferedSamples,
          bufferedMs: this.#bufferedSamples / sampleRate * 1000,
        });
      } else if (data.type === "segment-done") {
        this.port.postMessage({ type: "segment-done", turnId: data.turnId, segmentIndex: data.segmentIndex });
      } else if (data.type === "finish") {
        if (data.turnId && this.#turnId && data.turnId !== this.#turnId) {
          this.port.postMessage({ type: "turn-mismatch", expectedTurnId: this.#turnId, receivedTurnId: data.turnId });
          return;
        }
        this.#finished = true;
        if (this.#underrunStartedAt !== null) this.#endUnderrun("turn-finished");
      } else if (data.type === "stop") {
        this.#chunks = [];
        this.#chunkOffset = 0;
        this.#bufferedSamples = 0;
        this.#finished = false;
        this.#started = false;
        this.#prerollSamples = Math.ceil(sampleRate * 2);
        this.#turnId = null;
        this.#segmentIndex = null;
        this.#underrunStartedAt = null;
        this.#underrunCount = 0;
        this.#lastBufferReportAt = 0;
        this.port.postMessage({ type: "stopped", reason: data.reason ?? "cancelled" });
      }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0]?.[0];
    if (!output) return true;
    output.fill(0);

    if (!this.#started && (this.#bufferedSamples >= this.#prerollSamples || (this.#finished && this.#bufferedSamples > 0))) {
      this.#started = true;
      this.port.postMessage({
        type: "started",
        turnId: this.#turnId,
        bufferedSamples: this.#bufferedSamples,
        bufferedMs: this.#bufferedSamples / sampleRate * 1000,
        underrunCount: this.#underrunCount,
      });
    }
    if (!this.#started) return true;

    let written = 0;
    while (written < output.length && this.#chunks.length > 0) {
      const chunk = this.#chunks[0];
      const now = currentTime * 1000;
      if (this.#segmentIndex !== chunk.segmentIndex) {
        const previousSegmentIndex = this.#segmentIndex;
        const gapMs = this.#underrunStartedAt === null ? 0 : Math.max(0, now - this.#underrunStartedAt);
        if (this.#underrunStartedAt !== null) this.#endUnderrun("audio-resumed");
        if (previousSegmentIndex !== null) {
          this.port.postMessage({
            type: "segment-boundary",
            turnId: chunk.turnId,
            previousSegmentIndex,
            segmentIndex: chunk.segmentIndex,
            gapMs,
          });
        }
        this.#segmentIndex = chunk.segmentIndex;
      } else if (this.#underrunStartedAt !== null) {
        this.#endUnderrun("audio-resumed");
      }

      const count = Math.min(output.length - written, chunk.samples.length - this.#chunkOffset);
      output.set(chunk.samples.subarray(this.#chunkOffset, this.#chunkOffset + count), written);
      written += count;
      this.#chunkOffset += count;
      this.#bufferedSamples -= count;
      if (this.#chunkOffset === chunk.samples.length) {
        this.#chunks.shift();
        this.#chunkOffset = 0;
      }
    }

    if (this.#chunks.length === 0 && !this.#finished && this.#underrunStartedAt === null) {
      this.#underrunStartedAt = currentTime * 1000;
      this.#underrunCount += 1;
      this.port.postMessage({
        type: "underrun-start",
        turnId: this.#turnId,
        underrunCount: this.#underrunCount,
        bufferedSamples: this.#bufferedSamples,
        bufferedMs: 0,
      });
    }

    const now = currentTime * 1000;
    if (now - this.#lastBufferReportAt >= 250) {
      this.#lastBufferReportAt = now;
      let squareTotal = 0;
      for (const sample of output) squareTotal += sample * sample;
      this.port.postMessage({
        type: "buffer",
        phase: "playing",
        turnId: this.#turnId ?? undefined,
        segmentIndex: this.#segmentIndex ?? undefined,
        bufferedSamples: this.#bufferedSamples,
        bufferedMs: this.#bufferedSamples / sampleRate * 1000,
        outputRms: Math.sqrt(squareTotal / output.length),
      });
    }

    if (this.#chunks.length === 0 && this.#finished) {
      if (this.#underrunStartedAt !== null) this.#endUnderrun("turn-finished");
      this.#started = false;
      this.#finished = false;
      this.port.postMessage({ type: "drained", turnId: this.#turnId, underrunCount: this.#underrunCount });
      this.#turnId = null;
      this.#segmentIndex = null;
      this.#underrunCount = 0;
      this.#lastBufferReportAt = 0;
    }
    return true;
  }

  #endUnderrun(reason: "audio-resumed" | "turn-finished"): void {
    if (this.#underrunStartedAt === null) return;
    const durationMs = Math.max(0, currentTime * 1000 - this.#underrunStartedAt);
    this.port.postMessage({
      type: "underrun-end",
      turnId: this.#turnId,
      underrunCount: this.#underrunCount,
      durationMs,
      reason,
    });
    this.#underrunStartedAt = null;
  }
}

registerProcessor("whale-pcm-playback", PcmPlaybackWorklet);
