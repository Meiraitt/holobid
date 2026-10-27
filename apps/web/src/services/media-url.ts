import { apiOrigin } from './api-client';

// Persisted images are API-relative; catalog previews can use the public CDN.
export function mediaUrl(value: string, origin: string): string {
  if (!value) {
    return '';
  }

  try {
    const url = new URL(value, apiOrigin(origin));

    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : '';
  } catch {
    return '';
  }
}
