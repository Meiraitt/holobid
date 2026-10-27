import { QueryClient } from '@tanstack/react-query';

import { ApiRequestError } from '../services/api-error';

export const queryKeys = {
  auctions: (filters: object = {}) => ['public', 'auctions', filters] as const,
  auction: (id: string) => ['public', 'auction', id] as const,
  private: (userId: string, resource: string, filters: object = {}) =>
    ['private', userId, resource, filters] as const,
};

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        retry: (count, error) =>
          count < 2 &&
          error instanceof ApiRequestError &&
          (error.retryAfterMs ?? 0) <= 30_000 &&
          (['network', 'timeout'].includes(error.kind) ||
            [429, 502, 503, 504].includes(error.status)),
        retryDelay: (attempt, error) =>
          Math.max(
            error instanceof ApiRequestError ? (error.retryAfterMs ?? 0) : 0,
            Math.min(500 * 2 ** attempt, 2000),
          ),
      },
      mutations: { retry: false },
    },
  });
}

export function clearPrivateQueries(client: QueryClient) {
  void client.cancelQueries({ queryKey: ['private'] });
  client.removeQueries({ queryKey: ['private'] });
  client.getMutationCache().clear();
}

export const queryClient = createQueryClient();
