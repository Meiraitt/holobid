import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import type { AuctionStatus, OwnedAuctionDetail } from '@holobid/contracts';

import { CardArtwork } from '../../components/shared/card-artwork';
import { EmptyState } from '../../components/shared/empty-state';
import { OwnedAuctionsSkeleton } from '../../components/shared/loading-skeletons';
import { Money } from '../../components/shared/money';
import { PageHeader } from '../../components/shared/page-header';
import { StatusBadge } from '../../components/shared/status-badge';
import { Button, buttonVariants } from '../../components/ui/button';
import { NativeSelect } from '../../components/ui/input';
import { Skeleton } from '../../components/ui/skeleton';
import { formatDate } from '../../lib/format';
import { useAuth } from '../../providers/auth-provider';
import { apiClient } from '../../services';
import { errorMessage } from '../../services/api-error';
import { mediaUrl } from '../../services/media-url';

import { auctioneerSummaryOptions, ownedAuctionsOptions } from './auctioneer-queries';
import { CancelAuctionDialog } from './CancelAuctionDialog';

const statusLabels: Record<AuctionStatus, string> = {
  LIVE: 'Ao vivo',
  SCHEDULED: 'Agendado',
  ENDED: 'Encerrado',
  CANCELLED: 'Cancelado',
};

function AuctionResult({ auction }: { auction: OwnedAuctionDetail }) {
  if (auction.status === 'CANCELLED') {
    return <span className="text-muted-foreground">Lote retirado da vitrine</span>;
  }

  if (auction.status !== 'ENDED') {
    return <span className="text-muted-foreground">{auction.bidCount} lances recebidos</span>;
  }

  if (auction.settlementStatus === 'FAILED') {
    return <span className="text-destructive">Falha na liquidação. Receita não confirmada.</span>;
  }

  if (auction.settlementStatus !== 'COMPLETED' || auction.auditIntegrity !== 'VERIFIED') {
    return <span className="text-warning">Resultado em verificação</span>;
  }

  return auction.outcome?.kind === 'NO_BIDS' ? (
    <span className="text-muted-foreground">Encerrado sem lances</span>
  ) : (
    <span className="text-success">
      Arremate concluído
      {auction.outcome?.kind === 'SOLD' && (
        <span className="mt-1 block text-muted-foreground">
          Vencedor: {auction.outcome.winnerPseudonym}
        </span>
      )}
    </span>
  );
}

export function MyAuctionsView() {
  const { user } = useAuth();
  const [filter, setFilter] = useState<AuctionStatus | 'all'>('all');
  const [cancellation, setCancellation] = useState<OwnedAuctionDetail | null>(null);
  const query = useInfiniteQuery(
    ownedAuctionsOptions(user!.id, filter === 'all' ? undefined : filter),
  );
  const summary = useQuery(auctioneerSummaryOptions(user!.id));
  const visible = [
    ...new Map(
      (query.data?.pages.flatMap((page) => page.items) ?? []).map((lot) => [lot.id, lot]),
    ).values(),
  ];

  return (
    <section className="space-y-8">
      <PageHeader
        title="Meus leilões"
        description="Da publicação ao arremate, acompanhe cada carta."
        action={
          <Link className={buttonVariants()} to="/auctions/new">
            Criar leilão
          </Link>
        }
      />

      <dl className="grid gap-6 border-y border-border py-6 sm:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <dt className="text-sm text-muted-foreground">Recebido em arremates concluídos</dt>
          <dd className="mt-1 font-display text-4xl font-semibold text-foreground">
            {summary.data ? (
              <Money cents={summary.data.totalReceivedCents} />
            ) : summary.isPending ? (
              <Skeleton className="h-10 w-36" />
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Arremates concluídos</dt>
          <dd className="mt-1 font-display text-3xl font-semibold">
            {summary.data?.settledCount ??
              (summary.isPending ? <Skeleton className="h-9 w-16" /> : '—')}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Encerrados sem vencedor</dt>
          <dd className="mt-1 font-display text-3xl font-semibold">
            {summary.data?.withoutWinnerCount ??
              (summary.isPending ? <Skeleton className="h-9 w-16" /> : '—')}
          </dd>
        </div>
      </dl>

      {summary.isPending && (
        <p role="status" className="sr-only">
          Carregando seus totais…
        </p>
      )}
      {summary.isError && (
        <div role="alert">
          <p>Não foi possível atualizar os totais. {errorMessage(summary.error)}</p>
          <Button variant="outline" onClick={() => void summary.refetch()}>
            Atualizar totais
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-display text-2xl font-semibold">Seus lotes</h2>
        <div className="flex items-center gap-3">
          <label className="text-sm text-muted-foreground" htmlFor="my-auction-status">
            Situação
          </label>
          <NativeSelect
            id="my-auction-status"
            value={filter}
            onChange={(event) => setFilter(event.target.value as AuctionStatus | 'all')}
          >
            <option value="all">Todos os lotes</option>
            <option value="LIVE">Ao vivo</option>
            <option value="SCHEDULED">Agendados</option>
            <option value="ENDED">Encerrados</option>
            <option value="CANCELLED">Cancelados</option>
          </NativeSelect>
        </div>
      </div>

      {query.isPending ? (
        <OwnedAuctionsSkeleton />
      ) : query.isError && !query.data ? (
        <EmptyState
          title="Não foi possível carregar seus lotes"
          description={errorMessage(query.error)}
          action={<Button onClick={() => void query.refetch()}>Tentar novamente</Button>}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title="Nenhum lote nesta situação"
          description="Escolha outra situação ou publique uma carta do catálogo."
          action={
            filter !== 'all' ? (
              <Button variant="outline" onClick={() => setFilter('all')}>
                Ver todos os lotes
              </Button>
            ) : (
              <Link className={buttonVariants()} to="/auctions/new">
                Criar primeiro leilão
              </Link>
            )
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-6 bg-muted px-5 py-3 text-sm text-muted-foreground lg:grid">
            <span>Carta e situação</span>
            <span>Resultado</span>
            <span className="text-right">Valor do lote</span>
            <span className="w-36 text-right">Ações</span>
          </div>
          <ul className="divide-y divide-border">
            {visible.map((auction, index) => (
              <li
                key={auction.id}
                className="grid items-center gap-5 bg-card p-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:gap-6"
              >
                <div className="flex min-w-0 items-center gap-4">
                  <CardArtwork
                    priority={index === 0}
                    src={mediaUrl(auction.imageUrl, apiClient.origin)}
                    alt={auction.title + ', ' + auction.setName}
                    className="h-24 min-h-0 w-16 shrink-0 p-0"
                  />
                  <div className="min-w-0 space-y-1.5">
                    <p className="font-semibold">{auction.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {auction.setName} / {auction.cardNumber}
                    </p>
                    <StatusBadge
                      tone={
                        auction.status === 'LIVE'
                          ? 'success'
                          : auction.status === 'SCHEDULED'
                            ? 'info'
                            : 'neutral'
                      }
                    >
                      {statusLabels[auction.status]}
                    </StatusBadge>
                  </div>
                </div>
                <div className="space-y-1 text-sm">
                  <p>
                    <AuctionResult auction={auction} />
                  </p>
                  <p className="text-muted-foreground">
                    {auction.status === 'SCHEDULED'
                      ? 'Começa'
                      : auction.status === 'CANCELLED'
                        ? 'Previsão original:'
                        : auction.status === 'ENDED'
                          ? 'Encerrado em'
                          : 'Encerra'}{' '}
                    {formatDate(auction.status === 'SCHEDULED' ? auction.startsAt : auction.endsAt)}
                  </p>
                </div>
                <div className="lg:text-right">
                  <p className="text-xs text-muted-foreground">
                    {auction.outcome?.kind === 'NO_BIDS'
                      ? 'Recebido'
                      : auction.bidCount === 0
                        ? 'Lance inicial'
                        : auction.status === 'ENDED'
                          ? 'Lance final'
                          : 'Lance atual'}
                  </p>
                  <Money
                    className="text-xl font-semibold"
                    cents={
                      auction.outcome?.kind === 'NO_BIDS'
                        ? 0
                        : auction.bidCount === 0
                          ? auction.startingPriceCents
                          : (auction.currentBidCents ?? auction.startingPriceCents)
                    }
                  />
                </div>
                <div className="flex flex-wrap gap-2 lg:w-36 lg:justify-end">
                  {auction.status !== 'CANCELLED' && (
                    <Link
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}
                      to={'/auctions/' + auction.id}
                    >
                      Ver lote
                    </Link>
                  )}
                  {auction.canCancel ? (
                    <Button variant="ghost" size="sm" onClick={() => setCancellation(auction)}>
                      Cancelar lote
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {auction.cancelReason === 'AUCTION_HAS_BIDS'
                        ? 'Com lances: cancelamento indisponível'
                        : auction.status === 'LIVE' || auction.status === 'SCHEDULED'
                          ? 'Cancelamento indisponível durante a verificação'
                          : 'Histórico preservado'}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
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
      {query.isError && query.data && (
        <div role="alert">
          <p>Os lotes exibidos podem estar desatualizados. {errorMessage(query.error)}</p>
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
      {cancellation && (
        <CancelAuctionDialog
          key={cancellation.id}
          auction={cancellation}
          userId={user!.id}
          onClose={() => setCancellation(null)}
        />
      )}
      <p className="text-sm text-muted-foreground">
        Horários de Brasília · Atualização a cada 15 segundos. Totais confirmados pelo servidor,
        incluindo todos os seus lotes.
      </p>
    </section>
  );
}
