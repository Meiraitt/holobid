import { useInfiniteQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { AuctionCard } from '../../components/shared/auction-card';
import { EmptyState } from '../../components/shared/empty-state';
import { AuctionGridSkeleton } from '../../components/shared/loading-skeletons';
import { PageHeader } from '../../components/shared/page-header';
import { Button, buttonVariants } from '../../components/ui/button';
import { useAuth } from '../../providers/auth-provider';
import { errorMessage } from '../../services/api-error';

import { auctionCardData, auctionListOptions, type PublicStatus } from './auction-queries';

const filters = [
  { value: 'live', label: 'Ao vivo' },
  { value: 'scheduled', label: 'Agendados' },
  { value: 'ended', label: 'Encerrados' },
] as const;

type AuctionFilter = (typeof filters)[number]['value'];

export function AuctionsView() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const requestedFilter = searchParams.get('status');
  const activeFilter = filters.find((filter) => filter.value === requestedFilter)?.value ?? 'live';
  const query = useInfiniteQuery(auctionListOptions(activeFilter.toUpperCase() as PublicStatus));
  const visibleAuctions = [
    ...new Map(
      (query.data?.pages.flatMap((page) => page.items) ?? [])
        .filter((auction) => auction.status !== 'CANCELLED')
        .map((auction) => [auction.id, auction]),
    ).values(),
  ];
  const emptyMessages = {
    live: 'Nenhum lote ao vivo neste momento. Veja o que está agendado para a próxima rodada.',
    scheduled: 'Ainda não há lotes agendados. As cartas disponíveis estão na aba Ao vivo.',
    ended: 'Os resultados aparecem aqui quando os primeiros leilões forem encerrados.',
  };

  function selectFilter(filter: AuctionFilter) {
    setSearchParams({ status: filter });
  }

  function moveTab(key: string, index: number) {
    let nextIndex = index;

    if (key === 'ArrowRight') {
      nextIndex = (index + 1) % filters.length;
    } else if (key === 'ArrowLeft') {
      nextIndex = (index - 1 + filters.length) % filters.length;
    } else if (key === 'Home') {
      nextIndex = 0;
    } else if (key === 'End') {
      nextIndex = filters.length - 1;
    }

    const nextFilter = filters[nextIndex];

    if (nextFilter) {
      selectFilter(nextFilter.value);
      tabRefs.current[nextIndex]?.focus();
    }
  }

  return (
    <section className="space-y-8">
      <PageHeader
        title="Leilões de cartas"
        description="Encontre a próxima carta da sua coleção. Confira o lance, o prazo e entre na sala."
        action={
          user?.role === 'AUCTIONEER' ? (
            <Link to="/auctions/new" className={buttonVariants()}>
              Criar lote
            </Link>
          ) : (
            <Link to="/participations" className={buttonVariants({ variant: 'outline' })}>
              Minhas participações
            </Link>
          )
        }
      />
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-border">
        <div role="tablist" aria-label="Estado dos leilões" className="flex gap-1 sm:gap-5">
          {filters.map((filter, index) => (
            <button
              key={filter.value}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              id={`auction-tab-${filter.value}`}
              type="button"
              role="tab"
              aria-selected={activeFilter === filter.value}
              aria-controls="auction-results"
              tabIndex={activeFilter === filter.value ? 0 : -1}
              onClick={() => selectFilter(filter.value)}
              onKeyDown={(event) => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                  event.preventDefault();
                  moveTab(event.key, index);
                }
              }}
              className={`min-h-12 border-b-2 px-3 pb-3 pt-2 font-semibold transition-colors ${activeFilter === filter.value ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <p className="pb-3 text-sm text-muted-foreground">Cartas do catálogo TCGdex</p>
      </div>
      <div
        id="auction-results"
        role="tabpanel"
        aria-labelledby={`auction-tab-${activeFilter}`}
        tabIndex={0}
        aria-busy={query.isPending}
        className="min-h-80"
      >
        {query.isPending ? (
          <AuctionGridSkeleton />
        ) : query.isError && !query.data ? (
          <EmptyState
            title="Não foi possível carregar os leilões"
            description={errorMessage(query.error)}
            action={<Button onClick={() => void query.refetch()}>Tentar novamente</Button>}
          />
        ) : visibleAuctions.length === 0 ? (
          <EmptyState
            title="Novas cartas chegam em breve"
            description={emptyMessages[activeFilter]}
            action={
              <Button
                variant="outline"
                onClick={() => {
                  selectFilter(activeFilter === 'live' ? 'scheduled' : 'live');
                }}
              >
                {activeFilter === 'live' ? 'Ver agendados' : 'Ver leilões ao vivo'}
              </Button>
            }
          />
        ) : (
          <>
            <div className="grid gap-x-6 gap-y-9 sm:grid-cols-2 xl:grid-cols-4">
              {visibleAuctions.map((auction, index) => (
                <AuctionCard
                  key={auction.id}
                  auction={auctionCardData(auction)}
                  priority={index === 0}
                />
              ))}
            </div>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-4 border-t border-border pt-6">
              <p className="text-sm text-muted-foreground" role="status">
                {visibleAuctions.length}{' '}
                {visibleAuctions.length === 1 ? 'lote carregado' : 'lotes carregados'} nesta seleção
              </p>
              {query.hasNextPage && (
                <Button
                  variant="outline"
                  loading={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  Carregar mais lotes
                </Button>
              )}
            </div>
          </>
        )}
      </div>
      {query.isError && query.data && (
        <div role="alert" className="space-y-3 border-l-2 border-warning p-4">
          <p>
            Não foi possível atualizar todos os lotes. Os dados exibidos podem estar desatualizados.
          </p>
          <Button
            variant="outline"
            loading={query.isFetching}
            onClick={() =>
              void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())
            }
          >
            Tentar novamente
          </Button>
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        Horários de Brasília · Atualização a cada 15 segundos.
      </p>
    </section>
  );
}
