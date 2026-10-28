import { queryOptions } from '@tanstack/react-query';

import { api, apiClient } from '../../services';

export function auditOptions(id: string, cursor?: string, service = api.auctions, limit = 20) {
  return queryOptions({
    queryKey: ['public', 'audit', id, { cursor, limit }],
    queryFn: ({ signal }) => service.audit(id, { cursor, limit }, signal),
    staleTime: 0,
    refetchInterval: 30000,
    refetchOnWindowFocus: 'always',
  });
}

export function auditJsonUrl(id: string, cursor?: string, origin = apiClient.origin, limit = 20) {
  const query = new URLSearchParams({ limit: String(limit) });

  if (cursor) {
    query.set('cursor', cursor);
  }

  return `${origin}/api/v1/auctions/${encodeURIComponent(id)}/audit?${query}`;
}
