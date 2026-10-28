import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { Button, buttonVariants } from '../../../components/ui/button';
import { formatDate, formatMoney } from '../../../lib/format';
import { errorMessage } from '../../../services/api-error';
import { historyOptions } from '../room-queries';

export function BidHistory({
  auctionId,
  myPseudonym,
}: {
  auctionId: string;
  myPseudonym?: string;
}) {
  const query = useInfiniteQuery(historyOptions(auctionId));
  const bids = [
    ...new Map(
      (query.data?.pages.flatMap((page) => page.items) ?? []).map((bid) => [bid.id, bid]),
    ).values(),
  ].sort((a, b) => b.sequence - a.sequence);

  return (
    <section aria-labelledby="bid-history-heading" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-4">
        <h2 id="bid-history-heading" className="font-display text-3xl font-semibold">
          Histórico de lances
        </h2>
        <span className="text-sm text-muted-foreground">Mais recentes primeiro</span>
      </div>
      <Link
        to={`/auctions/${encodeURIComponent(auctionId)}/audit`}
        className={buttonVariants({ variant: 'outline' })}
      >
        Consultar auditoria
      </Link>
      {query.isPending ? (
        <p role="status">Carregando lances…</p>
      ) : query.isError && !query.data ? null : bids.length === 0 ? (
        <p className="py-8 text-muted-foreground">Nenhum lance registrado neste lote.</p>
      ) : (
        <ol className="divide-y divide-border">
          {bids.map((bid) => (
            <li key={bid.id} className="flex items-center justify-between gap-4 py-4">
              <div className="min-w-0">
                <p
                  className={`break-words font-semibold ${myPseudonym === bid.bidderPseudonym ? 'text-success' : ''}`}
                >
                  {myPseudonym === bid.bidderPseudonym
                    ? `Você · ${bid.bidderPseudonym}`
                    : bid.bidderPseudonym}
                </p>
                <time
                  dateTime={bid.acceptedAt}
                  className="mt-1 block text-sm text-muted-foreground"
                >
                  {formatDate(bid.acceptedAt)}
                </time>
              </div>
              <p className="shrink-0 text-lg font-semibold tabular-nums">
                {formatMoney(bid.amountCents)}
              </p>
            </li>
          ))}
        </ol>
      )}
      {query.isError && (
        <div role="alert" className="space-y-3">
          <p>
            {query.data ? 'O histórico pode estar desatualizado. ' : ''}
            {errorMessage(query.error)}
          </p>
          <Button
            variant="outline"
            onClick={() =>
              void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())
            }
          >
            Tentar novamente
          </Button>
        </div>
      )}
      {query.hasNextPage && (
        <Button
          variant="outline"
          loading={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Ver lances anteriores
        </Button>
      )}
    </section>
  );
}
