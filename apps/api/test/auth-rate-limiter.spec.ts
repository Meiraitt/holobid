import { AuthRateLimiter } from '../src/modules/auth/auth-rate-limiter';

describe('Authentication request limits', () => {
  it('expires an exhausted pair bucket after one minute', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    const limiter = new AuthRateLimiter();

    for (let i = 0; i < 5; i++) {
      expect(limiter.consume('127.0.0.1', 'test@example.test')).toBeNull();
    }

    expect(limiter.consume('127.0.0.1', ' TEST@example.test ')).toBe(60);
    now.mockReturnValue(61_000);
    expect(limiter.consume('127.0.0.1', 'test@example.test')).toBeNull();
  });

  it('bounds attempts across different emails from the same IP', () => {
    const limiter = new AuthRateLimiter();

    for (let i = 0; i < 20; i++) {
      expect(limiter.consume('127.0.0.1', `${i}@example.test`)).toBeNull();
    }

    expect(limiter.consume('127.0.0.1', 'new@example.test')).toBeGreaterThan(0);
    expect(limiter.consume('127.0.0.2', 'new@example.test')).toBeNull();
  });
});
