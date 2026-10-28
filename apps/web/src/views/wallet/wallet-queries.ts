import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';

import { queryKeys } from '../../lib/query-client';
import { api } from '../../services';
import type { resourceServices } from '../../services/resource-services';

type Services = ReturnType<typeof resourceServices>;

export function walletOptions(userId: string, service: Services['wallet'] = api.wallet) {
  return queryOptions({
    queryKey: queryKeys.private(userId, 'wallet'),
    queryFn: ({ signal }) => service.get(signal),
    refetchInterval: 30000,
    refetchOnWindowFocus: 'always',
  });
}

export function reservationOptions(
  userId: string,
  service: Services['account'] = api.account,
  limit = 12,
) {
  return infiniteQueryOptions({
    queryKey: queryKeys.private(userId, 'participations', { filter: 'active', limit }),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      service.participations({ filter: 'active', limit, cursor: pageParam }, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: 30000,
    refetchOnWindowFocus: 'always',
  });
}
