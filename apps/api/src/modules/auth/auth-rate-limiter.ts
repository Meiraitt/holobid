import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { ApiException } from '../../common/http/api.exception';

interface Bucket {
  count: number;
  expiresAt: number;
}

@Injectable()
export class AuthRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  private nextCleanup = 0;

  consume(ip: string, email: unknown): number | null {
    const now = Date.now();

    if (now >= this.nextCleanup) {
      for (const [key, value] of this.buckets) {
        if (value.expiresAt <= now) {
          this.buckets.delete(key);
        }
      }

      this.nextCleanup = now + 1000;
    }

    const normalized = typeof email === 'string' ? email.slice(0, 254).trim().toLowerCase() : '';
    const pair = createHash('sha256').update(`${ip}\0${normalized}`).digest('hex');
    // Pair limit prevents brute force; IP limit bounds account spraying and Argon2 work.
    const limits = [
      [`ip:${ip}`, 20],
      [`pair:${pair}`, 5],
    ] as const;

    for (const [key, limit] of limits) {
      const bucket = this.buckets.get(key);

      if (bucket && bucket.expiresAt > now && bucket.count >= limit) {
        return Math.ceil((bucket.expiresAt - now) / 1000);
      }
    }

    if (this.buckets.size >= 10_000) {
      return 60;
    }

    for (const [key] of limits) {
      const bucket = this.buckets.get(key);

      this.buckets.set(
        key,
        bucket && bucket.expiresAt > now
          ? { ...bucket, count: bucket.count + 1 }
          : { count: 1, expiresAt: now + 60_000 },
      );
    }

    return null;
  }
}

export function rateLimitError(): ApiException {
  return new ApiException(429, 'RATE_LIMITED', 'Too many requests.');
}
