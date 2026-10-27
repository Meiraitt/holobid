import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';

import { queryKeys } from '../../lib/query-client';
import { api } from '../../services';
import type { resourceServices } from '../../services/resource-services';

type Auctions = ReturnType<typeof resourceServices>['auctions'];

export function roomOptions(id: string, service: Auctions = api.auctions) {
  return queryOptions({
    queryKey: ['public', 'room', id],
    queryFn: async ({ signal }) => {
      const auction = await service.detail(id, signal);

      return { auction, receivedAt: performance.now() };
    },
    refetchInterval: 5000,
    refetchOnWindowFocus: 'always',
  });
}

export function historyOptions(id: string, service: Auctions = api.auctions, limit = 10) {
  return infiniteQueryOptions({
    queryKey: ['public', 'bid-history', id, limit],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => service.bids(id, { cursor: pageParam, limit }, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: 5000,
    refetchOnWindowFocus: 'always',
  });
}

export function myBidOptions(userId: string, id: string, service: Auctions = api.auctions) {
  return queryOptions({
    queryKey: queryKeys.private(userId, 'auction-position', { id }),
    queryFn: ({ signal }) => service.mine(id, signal),
    refetchInterval: 5000,
    refetchOnWindowFocus: 'always',
  });
}
