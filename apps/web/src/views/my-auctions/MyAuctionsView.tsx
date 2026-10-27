import { useState } from 'react';
import { Link } from 'react-router';

import { CardArtwork } from '../../components/shared/card-artwork';
import { EmptyState } from '../../components/shared/empty-state';
import { Money } from '../../components/shared/money';
import { PageHeader } from '../../components/shared/page-header';
import { StatusBadge } from '../../components/shared/status-badge';
import { Button, buttonVariants } from '../../components/ui/button';
import { ConfirmationDialog } from '../../components/ui/dialog';
import { NativeSelect } from '../../components/ui/input';
import { toast } from '../../components/ui/toast';
import { useDemo } from '../../demo/demo-provider';
import type { AuctionStatus, DemoAuction } from '../../demo/types';
import { formatDate } from '../../lib/format';

const statusLabels: Record<AuctionStatus, string> = {
  live: 'Ao vivo',
  scheduled: 'Agendado',
  ended: 'Encerrado',
  cancelled: 'Cancelado',
};

function AuctionResult({ auction }: { auction: DemoAuction }) {
  if (auction.status === 'cancelled') {
    return <span className="text-muted-foreground">Lote retirado da vitrine</span>;
  }

  if (auction.status !== 'ended') {
    return <span className="text-muted-foreground">{auction.bidCount} lances recebidos</span>;
  }

  if (auction.settlement === 'failed') {
    return <span className="text-destructive">Falha na liquidação. Receita não confirmada.</span>;
  }

  if (auction.settlement === 'pending' || auction.integrity !== 'verified') {
    return <span className="text-warning">Resultado em verificação</span>;
  }

  return auction.bidCount === 0 ? (
    <span className="text-muted-foreground">Encerrado sem lances</span>
  ) : (
    <span className="text-success">Arremate concluído</span>
  );
}

export function MyAuctionsView() {
  const { auctions, user, login, cancelAuction } = useDemo();
  const [filter, setFilter] = useState<AuctionStatus | 'all'>('all');
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState('');
  const owned = auctions.filter((auction) => auction.mine);
  const visible = owned.filter((auction) => filter === 'all' || auction.status === filter);
  const completed = owned.filter(
    (auction) =>
      auction.status === 'ended' &&
      auction.settlement === 'settled' &&
      auction.integrity === 'verified' &&
      auction.bidCount > 0,
  );
  const received = completed.reduce((sum, auction) => sum + auction.currentBidCents, 0);
  const cancellation = owned.find((auction) => auction.id === cancelId);

  function confirmCancellation() {
    if (!cancellation) {
      return;
    }

    try {
      cancelAuction(cancellation.id);
      setCancelId(null);
      setCancelError('');
      toast.success('Lote cancelado', 'O histórico foi preservado em seus leilões.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível cancelar o lote.';

      setCancelError(message);
      toast.error('Cancelamento não concluído', message);
    }
  }

  if (user?.role !== 'auctioneer') {
    return (
      <section className="space-y-8">
        <PageHeader
          title="Meus leilões"
          description="Publique cartas e acompanhe seus resultados."
        />
        <EmptyState
          title="Área do leiloeiro"
          description="Troque para a conta de leiloeiro da demonstração para criar e gerenciar lotes."
          action={<Button onClick={() => login('auctioneer')}>Usar conta de leiloeiro</Button>}
        />
      </section>
    );
  }

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
            <Money cents={received} />
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Arremates concluídos</dt>
          <dd className="mt-1 font-display text-3xl font-semibold">{completed.length}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Lotes em andamento</dt>
          <dd className="mt-1 font-display text-3xl font-semibold">
            {owned.filter((auction) => auction.status === 'live').length}
          </dd>
        </div>
      </dl>

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
            <option value="live">Ao vivo</option>
            <option value="scheduled">Agendados</option>
            <option value="ended">Encerrados</option>
            <option value="cancelled">Cancelados</option>
          </NativeSelect>
        </div>
      </div>

      {visible.length === 0 ? (
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
            {visible.map((auction) => (
              <li
                key={auction.id}
                className="grid items-center gap-5 bg-card p-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:gap-6"
              >
                <div className="flex min-w-0 items-center gap-4">
                  <CardArtwork
                    src={auction.card.image}
                    alt={auction.card.name + ', ' + auction.card.edition}
                    className="h-24 min-h-0 w-16 shrink-0 p-0"
                  />
                  <div className="min-w-0 space-y-1.5">
                    <Link className="font-semibold hover:underline" to={'/auctions/' + auction.id}>
                      {auction.card.name}
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {auction.card.edition} / {auction.card.number}
                    </p>
                    <StatusBadge
                      tone={
                        auction.status === 'live'
                          ? 'success'
                          : auction.status === 'scheduled'
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
                    {auction.status === 'scheduled'
                      ? 'Começa'
                      : auction.status === 'cancelled'
                        ? 'Previsão original:'
                        : auction.status === 'ended'
                          ? 'Encerrado em'
                          : 'Encerra'}{' '}
                    {formatDate(auction.status === 'scheduled' ? auction.startsAt : auction.endsAt)}
                  </p>
                </div>
                <div className="lg:text-right">
                  <p className="text-xs text-muted-foreground">
                    {auction.bidCount === 0
                      ? 'Lance inicial'
                      : auction.status === 'ended'
                        ? 'Lance final'
                        : 'Lance atual'}
                  </p>
                  <Money
                    className="text-xl font-semibold"
                    cents={
                      auction.bidCount === 0 ? auction.startingBidCents : auction.currentBidCents
                    }
                  />
                </div>
                <div className="flex flex-wrap gap-2 lg:w-36 lg:justify-end">
                  <Link
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                    to={'/auctions/' + auction.id}
                  >
                    Ver lote
                  </Link>
                  {auction.bidCount === 0 &&
                  (auction.status === 'live' || auction.status === 'scheduled') ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setCancelError('');
                        setCancelId(auction.id);
                      }}
                    >
                      Cancelar lote
                    </Button>
                  ) : auction.status === 'live' ? (
                    <span className="text-xs text-muted-foreground">
                      Com lances: cancelamento indisponível
                    </span>
                  ) : auction.status === 'ended' ? (
                    <Link
                      className="inline-flex min-h-11 items-center text-sm text-info underline-offset-4 hover:underline"
                      to={'/auctions/' + auction.id + '/audit'}
                    >
                      Ver auditoria
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {cancelError && (
        <p className="text-sm text-destructive" role="alert">
          {cancelError}
        </p>
      )}
      <ConfirmationDialog
        open={Boolean(cancellation)}
        onOpenChange={(open) => {
          if (!open) {
            setCancelId(null);
          }
        }}
        title={'Cancelar ' + (cancellation?.card.name ?? 'lote') + '?'}
        description={
          cancelError ||
          'O lote sairá da vitrine e não receberá lances. O registro continuará disponível em seus leilões. Essa ação não pode ser desfeita.'
        }
        confirmLabel="Cancelar lote"
        destructive
        onConfirm={confirmCancellation}
      />
    </section>
  );
}
