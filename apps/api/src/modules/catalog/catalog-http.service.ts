import { setTimeout as delay } from 'node:timers/promises';

import { Injectable } from '@nestjs/common';

import { SourceError } from './catalog.errors';

type ResourceKind = 'json' | 'image';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const MAX_JSON_BYTES = 512 * 1024;
const allowedMime = {
  json: ['application/json'],
  image: ['image/png', 'image/jpeg', 'image/webp'],
};

export function validateSourceUrl(value: string, kind: ResourceKind): URL {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new SourceError();
  }

  const hostname = kind === 'json' ? 'api.tcgdex.net' : 'assets.tcgdex.net';

  if (
    url.protocol !== 'https:' ||
    url.hostname !== hostname ||
    url.port ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new SourceError();
  }

  return url;
}

@Injectable()
export class CatalogHttpService {
  async get(value: string, kind: ResourceKind): Promise<{ bytes: Buffer; mimeType: string }> {
    const initial = validateSourceUrl(value, kind);

    for (let attempt = 0; ; attempt++) {
      try {
        return await this.request(initial, kind);
      } catch (error) {
        const name =
          typeof error === 'object' && error !== null && 'name' in error ? error.name : undefined;
        const failure =
          error instanceof SourceError
            ? error
            : new SourceError(['TypeError', 'AbortError', 'TimeoutError'].includes(String(name)));

        if (attempt === 1 || !failure.retryable) {
          throw failure;
        }

        await delay(150);
      }
    }
  }

  private async request(
    initial: URL,
    kind: ResourceKind,
  ): Promise<{ bytes: Buffer; mimeType: string }> {
    let url = initial;
    const signal = AbortSignal.timeout(5_000); // Includes redirects and streaming the body.

    for (let redirects = 0; ; redirects++) {
      const response = await fetch(url, {
        redirect: 'manual',
        signal,
        headers: { Accept: allowedMime[kind].join(', ') },
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();

        const location = response.headers.get('location');

        if (!location || redirects >= 2) {
          throw new SourceError();
        }

        url = validateSourceUrl(new URL(location, url).href, kind);
        continue;
      }

      const mimeType =
        response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
      const maxBytes = kind === 'image' ? MAX_IMAGE_BYTES : MAX_JSON_BYTES;

      if (
        !response.ok ||
        !allowedMime[kind].includes(mimeType) ||
        Number(response.headers.get('content-length')) > maxBytes
      ) {
        await response.body?.cancel();
        throw new SourceError(response.status === 429 || response.status >= 500, response.status);
      }

      if (!response.body) {
        throw new SourceError();
      }

      const reader = response.body.getReader();
      const chunks: Buffer[] = [];
      let size = 0;

      try {
        for (;;) {
          const chunk = await reader.read();

          if (chunk.done) {
            break;
          }

          size += chunk.value.byteLength;
          if (size > maxBytes) {
            throw new SourceError();
          }

          chunks.push(Buffer.from(chunk.value));
        }
      } finally {
        // An already errored stream rejects cancel; preserve the original failure.
        try {
          await reader.cancel();
        } catch {
          /* The stream has already failed. */
        }

        reader.releaseLock();
      }

      if (size === 0) {
        throw new SourceError();
      }

      return { bytes: Buffer.concat(chunks, size), mimeType };
    }
  }
}
