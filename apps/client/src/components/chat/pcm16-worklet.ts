declare const sampleRate: number;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

class Pcm16Worklet extends AudioWorkletProcessor {
  #phase = 0;
  #inputRate = sampleRate / 16_000;
  #pending = new Float32Array(0);
  #frame = new Int16Array(1_600);
  #frameOffset = 0;

  process(inputs: Float32Array[][]) {
    const input = inputs[0]?.[0];
    if (!input?.length) return true;
    const joined = new Float32Array(this.#pending.length + input.length);
    joined.set(this.#pending);
    joined.set(input, this.#pending.length);
    while (this.#phase + 1 < joined.length) {
      const low = Math.floor(this.#phase);
      const fraction = this.#phase - low;
      const sample = joined[low] + (joined[low + 1] - joined[low]) * fraction;
      this.#frame[this.#frameOffset++] = Math.max(-32_768, Math.min(32_767, Math.round(sample * 32_767)));
      this.#phase += this.#inputRate;
      if (this.#frameOffset === this.#frame.length) this.#sendFrame();
    }
    const consumed = Math.min(Math.floor(this.#phase), Math.max(0, joined.length - 1));
    this.#pending = joined.slice(consumed);
    this.#phase -= consumed;
    return true;
  }

  #sendFrame() {
    const output = this.#frame;
    let sum = 0;
    for (const sample of output) sum += sample * sample;
    const pcm = new Int16Array(output);
    this.port.postMessage({ pcm: pcm.buffer, rms: Math.sqrt(sum / output.length) / 32_768 }, [pcm.buffer]);
    this.#frameOffset = 0;
  }
}

registerProcessor("whale-pcm16", Pcm16Worklet);
