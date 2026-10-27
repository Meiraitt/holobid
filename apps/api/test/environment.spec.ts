import { validateEnvironment } from '../src/config/environment';

const databaseConfig = {
  AUDIT_HMAC_SECRET: Buffer.alloc(32, 8).toString('base64url'),
  AUDIT_PSEUDONYM_SECRET: Buffer.alloc(32, 9).toString('base64url'),
  AUDIT_KEY_ID: 'v1',
  JWT_SECRET: Buffer.alloc(32, 7).toString('base64url'),
  DATABASE_URL: 'postgresql://main:secret@localhost/main',
  AUDIT_DATABASE_URL: 'postgresql://audit:secret@localhost/audit',
};

describe('Environment configuration', () => {
  it('requires an explicit boolean demo mode', () => {
    expect(
      validateEnvironment({
        ...databaseConfig,
        WEB_ORIGIN: 'http://localhost:5173',
        DEMO_MODE: 'true',
      }).DEMO_MODE,
    ).toBe(true);
    expect(() =>
      validateEnvironment({
        ...databaseConfig,
        WEB_ORIGIN: 'http://localhost:5173',
        DEMO_MODE: 'yes',
      }),
    ).toThrow('DEMO_MODE');
  });
  it('requires an explicit frontend origin without exposing values', () => {
    expect(() => validateEnvironment({ ...databaseConfig })).toThrow('WEB_ORIGIN');
    expect(() =>
      validateEnvironment({
        ...databaseConfig,
        WEB_ORIGIN: 'https://user:private-password@example.com',
      }),
    ).toThrow('Invalid environment configuration: WEB_ORIGIN.');
  });

  it.each(['0', '65536', '3e3', 'abc', '', '12.5'])('rejects invalid PORT %s', (PORT) => {
    expect(() =>
      validateEnvironment({ ...databaseConfig, WEB_ORIGIN: 'http://localhost:5173', PORT }),
    ).toThrow('PORT');
  });

  it.each([
    '*',
    'https://example.com/path',
    'https://example.com/',
    'https://example.com?q=secret',
    'null',
  ])('rejects a non-origin value %s', (WEB_ORIGIN) => {
    expect(() => validateEnvironment({ ...databaseConfig, WEB_ORIGIN })).toThrow('WEB_ORIGIN');
  });

  it('requires valid and separate database URLs without exposing credentials', () => {
    for (const name of ['DATABASE_URL', 'AUDIT_DATABASE_URL']) {
      for (const value of [
        undefined,
        '',
        'https://private:secret@example.com/db',
        'postgresql://localhost',
      ]) {
        expect(() =>
          validateEnvironment({
            ...databaseConfig,
            WEB_ORIGIN: 'https://example.com',
            [name]: value,
          }),
        ).toThrow(`Invalid environment configuration: ${name}.`);
      }
    }

    expect(() =>
      validateEnvironment({
        ...databaseConfig,
        WEB_ORIGIN: 'https://example.com',
        AUDIT_DATABASE_URL: 'postgresql://another:secret@localhost:5432/main',
      }),
    ).toThrow('Invalid environment configuration: AUDIT_DATABASE_URL.');
  });

  it.each([undefined, '', 'short', 'x'.repeat(42)])(
    'rejects an invalid JWT signing key without exposing it',
    (JWT_SECRET) => {
      expect(() =>
        validateEnvironment({ ...databaseConfig, WEB_ORIGIN: 'https://example.com', JWT_SECRET }),
      ).toThrow('Invalid environment configuration: JWT_SECRET.');
    },
  );

  it('requires HTTPS in production and validates NODE_ENV', () => {
    expect(() =>
      validateEnvironment({
        ...databaseConfig,
        NODE_ENV: 'production',
        WEB_ORIGIN: 'http://example.com',
      }),
    ).toThrow('WEB_ORIGIN');
    expect(() =>
      validateEnvironment({
        ...databaseConfig,
        NODE_ENV: 'invalid',
        WEB_ORIGIN: 'https://example.com',
      }),
    ).toThrow('NODE_ENV');
    expect(
      validateEnvironment({
        ...databaseConfig,
        NODE_ENV: 'production',
        PORT: '8080',
        WEB_ORIGIN: 'https://example.com',
      }),
    ).toEqual({
      ...databaseConfig,
      NODE_ENV: 'production',
      PORT: 8080,
      DEMO_MODE: false,
      WEB_ORIGIN: 'https://example.com',
    });
  });
});
