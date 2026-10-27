import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';

import type { AuctionStatus } from '@holobid/contracts';

import { queryKeys } from '../../lib/query-client';
import { api } from '../../services';
import type { resourceServices } from '../../services/resource-services';

type Account = ReturnType<typeof resourceServices>['account'];

export function ownedAuctionsOptions(
  userId: string,
  status?: AuctionStatus,
  service: Account = api.account,
  limit = 12,
) {
  return infiniteQueryOptions({
    queryKey: queryKeys.private(userId, 'owned-auctions', { status, limit }),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      service.auctions({ status, limit, cursor: pageParam }, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: 15_000,
    refetchOnWindowFocus: 'always',
  });
}

export function auctioneerSummaryOptions(userId: string, service: Account = api.account) {
  return queryOptions({
    queryKey: queryKeys.private(userId, 'auctioneer-summary'),
    queryFn: ({ signal }) => service.summary(signal),
    refetchInterval: 15_000,
    refetchOnWindowFocus: 'always',
  });
}
