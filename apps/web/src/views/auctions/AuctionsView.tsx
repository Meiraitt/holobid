import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { AuctionCard } from '../../components/shared/auction-card';
import { EmptyState } from '../../components/shared/empty-state';
import { PageHeader } from '../../components/shared/page-header';
import { Button, buttonVariants } from '../../components/ui/button';
import { NativeSelect } from '../../components/ui/input';
import { useDemo } from '../../demo/demo-provider';

const filters = [
  { value: 'live', label: 'Ao vivo' },
  { value: 'scheduled', label: 'Agendados' },
  { value: 'ended', label: 'Encerrados' },
] as const;

type AuctionFilter = (typeof filters)[number]['value'];

type PreviewState = 'content' | 'loading' | 'empty' | 'error';

const pageSize = 4;

export function AuctionsView() {
  const { auctions, user } = useDemo();
  const [searchParams, setSearchParams] = useSearchParams();
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const [previewState, setPreviewState] = useState<PreviewState>('content');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const requestedFilter = searchParams.get('status');
  const activeFilter = filters.find((filter) => filter.value === requestedFilter)?.value ?? 'live';
  const filteredAuctions = auctions.filter((auction) => auction.status === activeFilter);
  const visibleAuctions = filteredAuctions.slice(0, visibleCount);
  const emptyMessages = {
    live: 'Nenhum lote ao vivo neste momento. Veja o que está agendado para a próxima rodada.',
    scheduled: 'Ainda não há lotes agendados. As cartas disponíveis estão na aba Ao vivo.',
    ended: 'Os resultados aparecem aqui quando os primeiros leilões forem encerrados.',
  };

  function selectFilter(filter: AuctionFilter) {
    setSearchParams({ status: filter });
    setVisibleCount(pageSize);
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
          user?.role === 'auctioneer' ? (
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
              <span className="ml-2 text-sm tabular-nums text-muted-foreground">
                {auctions.filter((auction) => auction.status === filter.value).length}
              </span>
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
        aria-busy={previewState === 'loading'}
        className="min-h-80"
      >
        {previewState === 'loading' ? (
          <>
            <p role="status" className="sr-only">
              Carregando lotes da demonstração.
            </p>
            <div aria-hidden="true" className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="space-y-4">
                  <div className="aspect-[4/5] rounded-lg bg-muted motion-safe:animate-pulse" />
                  <div className="h-6 w-2/3 rounded bg-muted" />
                  <div className="h-4 w-1/2 rounded bg-muted" />
                  <div className="h-8 w-3/5 rounded bg-muted" />
                </div>
              ))}
            </div>
          </>
        ) : previewState === 'error' ? (
          <EmptyState
            title="Não foi possível carregar os leilões"
            description="Este é um estado de erro demonstrativo. Tente novamente para voltar aos lotes."
            action={<Button onClick={() => setPreviewState('content')}>Tentar novamente</Button>}
          />
        ) : previewState === 'empty' || filteredAuctions.length === 0 ? (
          <EmptyState
            title={
              previewState === 'empty'
                ? 'Nenhum lote nesta seleção'
                : 'Novas cartas chegam em breve'
            }
            description={emptyMessages[activeFilter]}
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setPreviewState('content');
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
              {visibleAuctions.map((auction) => (
                <AuctionCard key={auction.id} auction={auction} />
              ))}
            </div>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-4 border-t border-border pt-6">
              <p className="text-sm text-muted-foreground" role="status">
                {visibleAuctions.length} de {filteredAuctions.length} lotes nesta seleção
              </p>
              {visibleCount < filteredAuctions.length && (
                <Button
                  variant="outline"
                  onClick={() => setVisibleCount((count) => count + pageSize)}
                >
                  Carregar mais lotes
                </Button>
              )}
            </div>
          </>
        )}
      </div>
      <details className="border-t border-border pt-5 text-sm text-muted-foreground">
        <summary className="w-fit cursor-pointer py-2">Visualizar estados da demonstração</summary>
        <div className="mt-3 max-w-xs space-y-2">
          <label htmlFor="auctions-preview">Estado da vitrine</label>
          <NativeSelect
            id="auctions-preview"
            value={previewState}
            onChange={(event) => setPreviewState(event.target.value as PreviewState)}
          >
            <option value="content">Lotes disponíveis</option>
            <option value="loading">Carregando</option>
            <option value="empty">Sem lotes</option>
            <option value="error">Falha de carregamento</option>
          </NativeSelect>
        </div>
      </details>
    </section>
  );
}
