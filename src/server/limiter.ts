/**
 * Token buckets by key (an IP address, a client id): each key may do `burst` things at once, refilled at `perSecond`.
 * In memory only, so it resets when its Durable Object is evicted; that's fine for slowing down spam and guessing.
 */
export class Limiter {
  private buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private burst: number,
    private perSecond: number,
    private now: () => number = Date.now,
    /** Forget idle keys once there are this many, so random keys can't grow the map forever. */
    private maxKeys = 10_000,
  ) {}

  /** Takes one token for `key`; false if it has none left (the caller refuses). */
  take(key: string): boolean {
    const now = this.now();
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) this.prune(now);
      b = { tokens: this.burst, at: now };
      this.buckets.set(key, b);
    }
    b.tokens = Math.min(this.burst, b.tokens + ((now - b.at) / 1000) * this.perSecond);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens--;
    return true;
  }

  forget(key: string) {
    this.buckets.delete(key);
  }

  private prune(now: number) {
    for (const [k, b] of this.buckets) if (b.tokens + ((now - b.at) / 1000) * this.perSecond >= this.burst) this.buckets.delete(k);
    // Everyone is mid-burst: drop the oldest half rather than grow.
    if (this.buckets.size >= this.maxKeys) [...this.buckets.keys()].slice(0, this.maxKeys / 2).forEach((k) => this.buckets.delete(k));
  }
}
