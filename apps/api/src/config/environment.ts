export interface ApiEnvironment {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  WEB_ORIGIN: string;
  DATABASE_URL: string;
  AUDIT_DATABASE_URL: string;
  JWT_SECRET: string;
  AUDIT_HMAC_SECRET: string;
  AUDIT_PSEUDONYM_SECRET: string;
  AUDIT_KEY_ID: string;
}

export class EnvironmentValidationError extends Error {
  constructor(fields: string[]) {
    super(`Invalid environment configuration: ${fields.join(', ')}.`);
    this.name = 'EnvironmentValidationError';
  }
}

export function validateEnvironment(raw: Record<string, unknown>): ApiEnvironment {
  const errors: string[] = [];
  const nodeEnv = raw.NODE_ENV ?? 'development';
  if (typeof nodeEnv !== 'string' || !['development', 'test', 'production'].includes(nodeEnv)) {
    errors.push('NODE_ENV');
  }

  const rawPort = raw.PORT ?? '3000';
  const port = /^\d+$/.test(String(rawPort)) ? Number(rawPort) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push('PORT');
  }

  const origin = raw.WEB_ORIGIN;
  try {
    if (typeof origin !== 'string') throw new Error();
    const url = new URL(origin);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== origin ||
      (nodeEnv === 'production' && url.protocol !== 'https:')
    ) {
      throw new Error();
    }
  } catch {
    errors.push('WEB_ORIGIN');
  }

  const databases = new Map<string, string>();
  for (const name of ['DATABASE_URL', 'AUDIT_DATABASE_URL'] as const) {
    try {
      const value = raw[name];
      if (typeof value !== 'string') throw new Error();
      const url = new URL(value);
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname ||
          !url.username || url.pathname.length < 2 || url.hash) throw new Error();
      databases.set(name, `${url.hostname}:${url.port || '5432'}${url.pathname}`);
    } catch {
      errors.push(name);
    }
  }
  if (databases.has('DATABASE_URL') && databases.get('DATABASE_URL') === databases.get('AUDIT_DATABASE_URL')) {
    errors.push('AUDIT_DATABASE_URL');
  }

  const secrets = ['JWT_SECRET', 'AUDIT_HMAC_SECRET', 'AUDIT_PSEUDONYM_SECRET'] as const;
  const seen = new Set<string>();
  for (const name of secrets) {
    const value = raw[name];
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43,86}$/.test(value) ||
        Buffer.from(value, 'base64url').length < 32 || Buffer.from(value, 'base64url').toString('base64url') !== value || seen.has(value)) {
      errors.push(name);
    }
    if (typeof value === 'string') seen.add(value);
  }
  const keyId = raw.AUDIT_KEY_ID ?? 'v1';
  if (typeof keyId !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(keyId)) errors.push('AUDIT_KEY_ID');

  if (errors.length > 0) throw new EnvironmentValidationError(errors);
  return {
    NODE_ENV: nodeEnv as ApiEnvironment['NODE_ENV'],
    PORT: port,
    WEB_ORIGIN: origin as string,
    DATABASE_URL: raw.DATABASE_URL as string,
    AUDIT_DATABASE_URL: raw.AUDIT_DATABASE_URL as string,
    JWT_SECRET: raw.JWT_SECRET as string,
    AUDIT_HMAC_SECRET: raw.AUDIT_HMAC_SECRET as string,
    AUDIT_PSEUDONYM_SECRET: raw.AUDIT_PSEUDONYM_SECRET as string,
    AUDIT_KEY_ID: keyId as string,
  };
}
