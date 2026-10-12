export class FixedWindowRateLimiter {
  #buckets = new Map();
  #operations = 0;

  constructor({ limit, windowMs, now = Date.now }) {
    if (!Number.isInteger(limit) || limit < 1 || !Number.isFinite(windowMs) || windowMs < 1) {
      throw new RangeError('Rate limit and window must be positive');
    }
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  consume(key) {
    const now = this.now();
    this.#operations += 1;
    if (this.#operations % 256 === 0) this.#prune(now);
    const bucket = this.#buckets.get(key);
    if (!bucket || now - bucket.startedAt >= this.windowMs) {
      this.#buckets.set(key, { count: 1, startedAt: now });
      return { allowed: true, remaining: this.limit - 1, retryAfterMs: 0 };
    }
    if (bucket.count >= this.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(0, this.windowMs - (now - bucket.startedAt)),
      };
    }
    bucket.count += 1;
    return { allowed: true, remaining: this.limit - bucket.count, retryAfterMs: 0 };
  }

  #prune(now) {
    for (const [bucketKey, bucket] of this.#buckets) {
      if (now - bucket.startedAt >= this.windowMs) this.#buckets.delete(bucketKey);
    }
  }
}
