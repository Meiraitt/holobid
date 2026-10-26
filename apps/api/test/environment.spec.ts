import { validateEnvironment } from '../src/config/environment';

describe('Environment configuration', () => {
  it('requires an explicit frontend origin without exposing values', () => {
    expect(() => validateEnvironment({})).toThrow('WEB_ORIGIN');
    expect(() => validateEnvironment({ WEB_ORIGIN: 'https://user:private-password@example.com' }))
      .toThrow('Invalid environment configuration: WEB_ORIGIN.');
  });

  it.each(['0', '65536', '3e3', 'abc', '', '12.5'])('rejects invalid PORT %s', (PORT) => {
    expect(() => validateEnvironment({ WEB_ORIGIN: 'http://localhost:5173', PORT })).toThrow('PORT');
  });

  it.each(['*', 'https://example.com/path', 'https://example.com/', 'https://example.com?q=secret', 'null'])('rejects a non-origin value %s', (WEB_ORIGIN) => {
      expect(() => validateEnvironment({ WEB_ORIGIN })).toThrow('WEB_ORIGIN');
    });

  it('requires HTTPS in production and validates NODE_ENV', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'production', WEB_ORIGIN: 'http://example.com' })).toThrow('WEB_ORIGIN');
    expect(() => validateEnvironment({ NODE_ENV: 'invalid', WEB_ORIGIN: 'https://example.com' })).toThrow('NODE_ENV');
    expect(validateEnvironment({ NODE_ENV: 'production', PORT: '8080', WEB_ORIGIN: 'https://example.com' }))
      .toEqual({ NODE_ENV: 'production', PORT: 8080, WEB_ORIGIN: 'https://example.com' });
  });
});
