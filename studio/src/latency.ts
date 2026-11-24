// records how long a press takes to reach a drawn frame. each sample is the event's own timestamp and the start time of
// the first frame drawn after the handler ran, both on the performance clock. this measures the browser, not the key
// switch or the screen: the photon figure needs a camera.
export interface LatencyStats {
  count: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
}

export class LatencyProbe {
  private readonly samples: number[] = [];

  constructor(private readonly limit = 2000) {}

  record(eventTimeStamp: number, frameTime: number): void {
    const delta = frameTime - eventTimeStamp;
    // a negative figure means the two clocks were read differently. it is dropped, not hidden as zero
    if (!Number.isFinite(delta) || delta < 0) return;
    if (this.samples.length >= this.limit) this.samples.shift();
    this.samples.push(delta);
  }

  reset(): void {
    this.samples.length = 0;
  }

  stats(): LatencyStats {
    const sorted = [...this.samples].sort((a, b) => a - b);
    const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
    return { count: sorted.length, medianMs: at(0.5), p95Ms: at(0.95), maxMs: sorted.at(-1) ?? 0 };
  }
}

export interface FrameStats {
  frames: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

// frame intervals, for the practice frame budget
export function frameStats(times: readonly number[]): FrameStats {
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) gaps.push((times[i] ?? 0) - (times[i - 1] ?? 0));
  gaps.sort((a, b) => a - b);
  const at = (q: number): number => gaps[Math.min(gaps.length - 1, Math.floor(q * gaps.length))] ?? 0;
  return { frames: times.length, p95Ms: at(0.95), p99Ms: at(0.99), maxMs: gaps.at(-1) ?? 0 };
}
