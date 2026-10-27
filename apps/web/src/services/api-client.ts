import type { ApiError } from '@holobid/contracts';

import { ApiRequestError } from './api-error';

export interface SessionAccess {
  token(): string | null;
  scope(): number;
  refresh(rejectedToken: string | null): Promise<string | null>;
}

export type RequestOptions = {
  method?: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal;
  authenticated?: boolean;
  idempotencyKey?: string;
  timeoutMs?: number;
  bearer?: string;
};

export type ApiResponse<T> = { data: T; status: number };

export function apiOrigin(value: string): string {
  const url = new URL(value);

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['/', '/api/v1', '/api/v1/'].includes(url.pathname)
  ) {
    throw new Error('VITE_API_URL must be an HTTP(S) origin, optionally ending in /api/v1.');
  }

  return url.origin;
}

function readProblem(value: unknown): ApiError | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const problem = value as Partial<ApiError>;

  return typeof problem.code === 'string' &&
    typeof problem.message === 'string' &&
    typeof problem.requestId === 'string'
    ? (problem as ApiError)
    : undefined;
}

export class ApiClient {
  private session?: SessionAccess;

  readonly origin: string;

  constructor(
    origin: string,
    private readonly authBase = '/api/v1/auth',
  ) {
    this.origin = apiOrigin(origin);
  }

  bindSession(session: SessionAccess) {
    this.session = session;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    if (!/^\/[a-z]/i.test(path) || path.includes('://') || path.includes('\\')) {
      throw new Error('API paths must be relative to /api/v1.');
    }

    const auth = path.startsWith('/auth/');
    const url = auth ? `${this.authBase}${path.slice(5)}` : `${this.origin}/api/v1${path}`;
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const originalToken = options.authenticated ? (this.session?.token() ?? null) : null;
    const scope = this.session?.scope();
    const checkScope = () => {
      if (options.authenticated && scope !== this.session?.scope()) {
        throw new ApiRequestError('aborted');
      }
    };

    try {
      const response = await this.send<T>(url, auth, body, options, originalToken);

      checkScope();

      return response;
    } catch (error) {
      checkScope();
      if (
        !(error instanceof ApiRequestError) ||
        error.status !== 401 ||
        !options.authenticated ||
        !this.session ||
        options.signal?.aborted
      ) {
        throw error;
      }

      const token = await this.session.refresh(originalToken);

      checkScope();

      if (!token || options.signal?.aborted) {
        throw error;
      }

      // The same body and idempotency key survive the single authentication retry.
      const response = await this.send<T>(url, auth, body, options, token);

      checkScope();

      return response;
    }
  }

  private async send<T>(
    url: string,
    auth: boolean,
    body: string | undefined,
    options: RequestOptions,
    token: string | null,
  ): Promise<ApiResponse<T>> {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 15_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const headers = new Headers({ Accept: 'application/json' });

    if (body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }

    if (auth && (options.method ?? 'GET') === 'POST') {
      headers.set('X-CSRF-Protection', '1');
    }

    if (token || options.bearer) {
      headers.set('Authorization', `Bearer ${token ?? options.bearer}`);
    }

    if (options.idempotencyKey) {
      headers.set('Idempotency-Key', options.idempotencyKey);
    }

    try {
      const response = await fetch(url, {
        method: options.method ?? 'GET',
        headers,
        body,
        signal,
        credentials: auth ? 'include' : 'omit',
        cache: 'no-store',
        redirect: 'error',
      });
      const text = response.status === 204 ? '' : await response.text();
      let data: unknown;

      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          if (response.ok) {
            throw new ApiRequestError('protocol', response.status);
          }
        }
      }

      if (!response.ok) {
        const retry = response.headers.get('Retry-After');
        const retryAfterMs =
          retry === null
            ? undefined
            : Math.max(
                0,
                /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now(),
              );

        throw new ApiRequestError('http', response.status, readProblem(data), retryAfterMs);
      }

      return { data: data as T, status: response.status };
    } catch (error) {
      if (error instanceof ApiRequestError) {
        throw error;
      }

      if (options.signal?.aborted) {
        throw new ApiRequestError('aborted');
      }

      if (timeout.aborted) {
        throw new ApiRequestError('timeout');
      }

      throw new ApiRequestError('network');
    }
  }
}
