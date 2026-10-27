import { PeakLimiter } from "../audio/limiter";

// The peak limiter, running on the audio thread. Built as its own small
// script and loaded with audioWorklet.addModule (see engine.ts).

declare const sampleRate: number;
declare function registerProcessor(name: string, processor: new (options: { processorOptions?: { ceilingDb?: number } }) => unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

class LimiterProcessor extends AudioWorkletProcessor {
  private readonly limiter: PeakLimiter;

  constructor(options: { processorOptions?: { ceilingDb?: number } }) {
    super();
    this.limiter = new PeakLimiter(sampleRate, { ceilingDb: options.processorOptions?.ceilingDb ?? 0 });
    this.port.onmessage = (event: MessageEvent<{ ceilingDb?: number }>) => {
      if (typeof event.data.ceilingDb === "number") this.limiter.setCeiling(event.data.ceilingDb);
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    this.limiter.process(inputs[0] ?? [], output, output[0]?.length ?? 128);
    return true;
  }
}

registerProcessor("peak-limiter", LimiterProcessor);
