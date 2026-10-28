import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { CardArtwork } from '../../components/shared/card-artwork';
import { CompactRowsSkeleton } from '../../components/shared/loading-skeletons';
import { Money } from '../../components/shared/money';
import { Button, buttonVariants } from '../../components/ui/button';
import { apiClient } from '../../services';
import { errorMessage } from '../../services/api-error';
import { mediaUrl } from '../../services/media-url';

import { reservationOptions } from './wallet-queries';

export function Reservations({ userId }: { userId: string }) {
  const query = useInfiniteQuery(reservationOptions(userId));
  const items = [
    ...new Map(
      (query.data?.pages.flatMap((page) => page.items) ?? []).map((item) => [item.auctionId, item]),
    ).values(),
  ].filter((item) => item.reservedForThisAuctionCents > 0);

  return (
    <section className="mt-9 space-y-4" aria-labelledby="wallet-reservations">
      <h2 id="wallet-reservations" className="font-display text-2xl font-semibold sm:text-3xl">
        Valores comprometidos
      </h2>
      {query.isPending ? (
        <CompactRowsSkeleton label="Carregando reservas…" count={2} artwork />
      ) : query.isError && !query.data ? null : items.length > 0 ? (
        <ul className="divide-y border-y">
          {items.map((item) => (
            <li key={item.auctionId}>
              <Link
                to={`/auctions/${item.auctionId}`}
                className="flex min-h-24 items-center gap-4 py-4 transition-colors duration-200 motion-reduce:transition-none hover:bg-muted/60"
              >
                <CardArtwork
                  src={mediaUrl(item.auction.imageUrl, apiClient.origin)}
                  alt=""
                  className="h-16 min-h-0 w-12 shrink-0 p-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{item.auction.title}</p>
                  <p className="text-sm text-muted-foreground">{item.auction.setName}</p>
                  <p
                    className={`mt-1 text-sm ${item.state === 'PROCESSING' ? 'text-warning' : 'text-success'}`}
                  >
                    {item.state === 'PROCESSING'
                      ? 'Aguardando liquidação'
                      : 'Você está na liderança'}
                  </p>
                </div>
                <Money
                  cents={item.reservedForThisAuctionCents}
                  className="shrink-0 text-right font-semibold"
                />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="border-y py-6">
          <p className="font-semibold">
            {query.hasNextPage
              ? 'Nenhuma reserva nos lotes carregados'
              : 'Nenhum valor comprometido'}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Quando você liderar um leilão, a reserva aparecerá aqui.
          </p>
          {!query.hasNextPage && (
            <Link
              to="/auctions"
              className={buttonVariants({ variant: 'outline', size: 'sm', className: 'mt-4' })}
            >
              Explorar leilões
            </Link>
          )}
        </div>
      )}
      {query.isError && (
        <div role="alert" className="space-y-3">
          <p>
            {query.data ? 'As reservas exibidas podem estar desatualizadas. ' : ''}
            {errorMessage(query.error)}
          </p>
          <Button
            variant="outline"
            onClick={() =>
              void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())
            }
          >
            Atualizar reservas
          </Button>
        </div>
      )}
      {query.hasNextPage && (
        <Button
          variant="outline"
          loading={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Carregar mais lotes
        </Button>
      )}
    </section>
  );
}
