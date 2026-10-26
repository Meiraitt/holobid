export interface ApiEnvironment {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  WEB_ORIGIN: string;
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

  if (errors.length > 0) throw new EnvironmentValidationError(errors);
  return {
    NODE_ENV: nodeEnv as ApiEnvironment['NODE_ENV'],
    PORT: port,
    WEB_ORIGIN: origin as string,
  };
}
