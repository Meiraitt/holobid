// One API instance: bound both retention and the number of in-memory buckets.
export class FixedWindowLimiter {
  private readonly buckets = new Map<string, { count: number; expiresAt: number }>();

  private nextCleanup = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly capacity = 10_000,
  ) {}

  consume(key: string, now = Date.now()): number | null {
    if (now >= this.nextCleanup) {
      for (const [id, bucket] of this.buckets) {
        if (bucket.expiresAt <= now) {
          this.buckets.delete(id);
        }
      }

      this.nextCleanup = now + 1_000;
    }

    const bucket = this.buckets.get(key);

    if (bucket && bucket.expiresAt > now) {
      if (bucket.count >= this.limit) {
        return Math.ceil((bucket.expiresAt - now) / 1_000);
      }

      bucket.count++;
    } else {
      if (!bucket && this.buckets.size >= this.capacity) {
        return Math.ceil(this.windowMs / 1_000);
      }

      this.buckets.set(key, { count: 1, expiresAt: now + this.windowMs });
    }

    return null;
  }
}
