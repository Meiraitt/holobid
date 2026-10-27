import { ApiException } from '../../common/http/api.exception';

export class SourceError extends Error {
  constructor(
    readonly retryable = false,
    readonly status?: number,
  ) {
    super('External catalog request failed.');
  }
}
export function catalogUnavailable(): ApiException {
  return new ApiException(
    503,
    'CATALOG_UNAVAILABLE',
    'The card catalog is temporarily unavailable.',
  );
}

export function itemNotFound(): ApiException {
  return new ApiException(404, 'ITEM_NOT_FOUND', 'The card was not found.');
}
