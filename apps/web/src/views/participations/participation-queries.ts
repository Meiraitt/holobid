import { infiniteQueryOptions } from '@tanstack/react-query';

import { queryKeys } from '../../lib/query-client';
import { api } from '../../services';
import type { resourceServices } from '../../services/resource-services';

export type ParticipationFilter = 'active' | 'all' | 'won';

type Account = ReturnType<typeof resourceServices>['account'];

export function participationOptions(
  userId: string,
  filter: ParticipationFilter,
  service: Account = api.account,
  limit = 12,
) {
  return infiniteQueryOptions({
    queryKey: queryKeys.private(userId, 'participations', { filter, limit }),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      service.participations({ filter, limit, cursor: pageParam }, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: 30000,
    refetchOnWindowFocus: 'always',
  });
}
