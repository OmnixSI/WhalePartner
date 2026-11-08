export {};

declare const sampleRate: number;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

interface PlaybackMessage {
  type: "configure" | "push" | "finish" | "stop";
  samples?: Float32Array;
  prerollSamples?: number;
}

class PcmPlaybackWorklet extends AudioWorkletProcessor {
  #chunks: Float32Array[] = [];
  #chunkOffset = 0;
  #bufferedSamples = 0;
  #prerollSamples = Math.ceil(sampleRate * 1.92);
  #finished = false;
  #started = false;

  constructor(options?: AudioWorkletNodeOptions) {
    super(options);
    this.port.onmessage = ({ data }: MessageEvent<PlaybackMessage>) => {
      if (data.type === "configure" && data.prerollSamples) {
        this.#prerollSamples = data.prerollSamples;
      } else if (data.type === "push" && data.samples?.length) {
        this.#chunks.push(data.samples);
        this.#bufferedSamples += data.samples.length;
        this.#finished = false;
      } else if (data.type === "finish") {
        this.#finished = true;
      } else if (data.type === "stop") {
        this.#chunks = [];
        this.#chunkOffset = 0;
        this.#bufferedSamples = 0;
        this.#finished = false;
        this.#started = false;
      }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0]?.[0];
    if (!output) return true;
    output.fill(0);

    if (!this.#started && (this.#bufferedSamples >= this.#prerollSamples || (this.#finished && this.#bufferedSamples > 0))) {
      this.#started = true;
      this.port.postMessage({ type: "started" });
    }
    if (!this.#started) return true;

    let written = 0;
    while (written < output.length && this.#chunks.length > 0) {
      const chunk = this.#chunks[0];
      const count = Math.min(output.length - written, chunk.length - this.#chunkOffset);
      output.set(chunk.subarray(this.#chunkOffset, this.#chunkOffset + count), written);
      written += count;
      this.#chunkOffset += count;
      this.#bufferedSamples -= count;
      if (this.#chunkOffset === chunk.length) {
        this.#chunks.shift();
        this.#chunkOffset = 0;
      }
    }

    if (this.#chunks.length === 0 && this.#finished) {
      this.#started = false;
      this.#finished = false;
      this.port.postMessage({ type: "drained" });
    }
    return true;
  }
}

registerProcessor("whale-pcm-playback", PcmPlaybackWorklet);
