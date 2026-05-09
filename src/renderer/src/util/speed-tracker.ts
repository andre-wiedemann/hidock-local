// Rolling-window byte-rate tracker. Used to display live transfer speed and
// remaining-time estimates during downloads.

interface Sample {
  t: number;
  bytes: number;
}

const WINDOW_MS = 2000;

export class SpeedTracker {
  private samples: Sample[] = [];

  reset(): void {
    this.samples = [];
  }

  record(bytes: number): void {
    const now = performance.now();
    this.samples.push({ t: now, bytes });
    const cutoff = now - WINDOW_MS;
    while (this.samples.length && this.samples[0].t < cutoff) {
      this.samples.shift();
    }
  }

  /** Bytes-per-second over the current window, or 0 if too few samples. */
  bytesPerSecond(): number {
    if (this.samples.length < 2) return 0;
    const total = this.samples.reduce((sum, s) => sum + s.bytes, 0);
    const first = this.samples[0].t;
    const last = this.samples[this.samples.length - 1].t;
    const span = (last - first) / 1000;
    return span > 0 ? total / span : 0;
  }
}
