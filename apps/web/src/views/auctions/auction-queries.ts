import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';

import type { PublicAuctionSummary } from '@holobid/contracts';

import { queryKeys } from '../../lib/query-client';
import { api, apiClient } from '../../services';
import { mediaUrl } from '../../services/media-url';
import type { resourceServices } from '../../services/resource-services';

type Auctions = ReturnType<typeof resourceServices>['auctions'];

export type PublicStatus = 'LIVE' | 'SCHEDULED' | 'ENDED';

export function auctionListOptions(
  status: PublicStatus,
  service: Auctions = api.auctions,
  limit = 12,
) {
  return infiniteQueryOptions({
    queryKey: queryKeys.auctions({ status, limit }),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => service.list({ status, limit, cursor: pageParam }, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    // Reconcile time transitions even before room WebSocket integration (FE-09).
    refetchInterval: 15_000,
    refetchOnWindowFocus: 'always',
  });
}

export function auctionDetailOptions(id: string) {
  return queryOptions({
    queryKey: queryKeys.auction(id),
    queryFn: ({ signal }) => api.auctions.detail(id, signal),
    refetchInterval: 15_000,
    refetchOnWindowFocus: 'always',
  });
}

export function auctionCardData(auction: PublicAuctionSummary, origin = apiClient.origin) {
  return {
    id: auction.id,
    card: {
      name: auction.title,
      image: mediaUrl(auction.imageUrl, origin),
      edition: auction.setName,
      number: auction.cardNumber,
    },
    status: auction.status.toLowerCase() as Lowercase<PublicAuctionSummary['status']>,
    bidCount: auction.bidCount,
    currentBidCents: auction.currentBidCents ?? auction.startingPriceCents,
    startsAt: auction.startsAt,
    endsAt: auction.endsAt,
  };
}
