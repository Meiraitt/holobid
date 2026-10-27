import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { CardArtwork } from '../../components/shared/card-artwork';
import { EmptyState } from '../../components/shared/empty-state';
import { Button } from '../../components/ui/button';
import { Field, Input } from '../../components/ui/input';
import { queryKeys } from '../../lib/query-client';
import { api, apiClient } from '../../services';
import { errorMessage } from '../../services/api-error';
import { mediaUrl } from '../../services/media-url';

export function CatalogPicker({
  userId,
  selectedId,
  onSelect,
  error,
}: {
  userId: string;
  selectedId: string;
  onSelect: (id: string) => void;
  error?: string;
}) {
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(search.trim()), 350);

    return () => window.clearTimeout(timer);
  }, [search]);

  const query = useInfiniteQuery({
    queryKey: queryKeys.private(userId, 'catalog', { term }),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      api.catalog.search({ q: term, page: pageParam, limit: 12 }, signal),
    getNextPageParam: (page) => (page.hasMore && page.page < 10000 ? page.page + 1 : undefined),
    staleTime: 60_000,
  });
  const searching = search.trim() !== term || query.isPending;
  const cards = [
    ...new Map(
      (query.data?.pages.flatMap((page) => page.items) ?? []).map((card) => [
        card.externalId,
        card,
      ]),
    ).values(),
  ];

  return (
    <section aria-labelledby="choose-card-heading" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="choose-card-heading" className="font-display text-3xl font-semibold">
          Escolha a carta
        </h2>
        <span className="text-sm text-muted-foreground">Catálogo TCGdex</span>
      </div>
      <Field
        htmlFor="create-search"
        label="Buscar carta"
        hint="Busque pelo nome da carta em inglês."
        error={error}
      >
        <Input
          id="create-search"
          type="search"
          value={search}
          maxLength={80}
          placeholder="Ex.: Charizard ou Pikachu"
          onChange={(event) => setSearch(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'create-search-error' : 'create-search-hint'}
        />
      </Field>
      {searching ? (
        <p role="status">Buscando cartas…</p>
      ) : query.isError && !query.data ? (
        <EmptyState
          title="O catálogo está indisponível"
          description={`${errorMessage(query.error)} Os lotes já publicados continuam disponíveis.`}
          action={
            <Button type="button" variant="outline" onClick={() => void query.refetch()}>
              Tentar novamente
            </Button>
          }
        />
      ) : cards.length === 0 ? (
        <EmptyState
          title="Nenhuma carta encontrada"
          description="Tente outro nome de carta."
          action={
            <Button type="button" variant="outline" onClick={() => setSearch('')}>
              Limpar busca
            </Button>
          }
        />
      ) : (
        <>
          {query.data?.pages.some((page) => page.stale) && (
            <p role="status" className="text-sm text-warning">
              Exibindo a última consulta salva. O catálogo está temporariamente indisponível.
            </p>
          )}
          <div
            className="grid grid-cols-2 gap-3 sm:grid-cols-3"
            role="group"
            aria-label="Cartas disponíveis"
          >
            {cards.map((card) => (
              <button
                key={card.externalId}
                type="button"
                aria-pressed={selectedId === card.externalId}
                className={`flex min-w-0 flex-col items-start rounded-lg border p-3 text-left transition-colors ${selectedId === card.externalId ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-input'}`}
                onClick={() => onSelect(card.externalId)}
              >
                <CardArtwork
                  src={mediaUrl(card.previewImageUrl, apiClient.origin)}
                  alt={card.title}
                  className="mx-auto mb-3 h-40 min-h-0 w-full max-w-28 p-0"
                />
                <span className="font-semibold">{card.title}</span>
                <span className="mt-0.5 text-xs text-muted-foreground">
                  Carta {card.cardNumber} · {card.externalId}
                </span>
                {selectedId === card.externalId && (
                  <span className="mt-2 text-xs font-semibold">Carta selecionada</span>
                )}
              </button>
            ))}
          </div>
          {query.hasNextPage && (
            <Button
              type="button"
              variant="outline"
              loading={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              Carregar mais cartas
            </Button>
          )}
          {query.isError && (
            <div role="alert">
              <p>{errorMessage(query.error)}</p>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())
                }
              >
                Tentar novamente
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
