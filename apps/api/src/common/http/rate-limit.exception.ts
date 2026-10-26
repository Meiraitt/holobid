import { ApiException } from './api.exception';

export class RateLimitException extends ApiException {
  constructor(readonly retryAfter: number) {
    super(429, 'RATE_LIMITED', 'Too many requests.');
  }
}
