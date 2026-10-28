import { queryOptions } from '@tanstack/react-query';

import { api } from '../../services';

export function receiptOptions(code: string, service = api.receipt) {
  return queryOptions({
    queryKey: ['public', 'receipt', code],
    queryFn: ({ signal }) => service(code, signal),
    refetchOnWindowFocus: 'always',
  });
}
