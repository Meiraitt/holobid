import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { CardArtwork } from '../../components/shared/card-artwork';
import { EmptyState } from '../../components/shared/empty-state';
import { StatusBadge } from '../../components/shared/status-badge';
import { Button, buttonVariants } from '../../components/ui/button';
import { Field, Input, NativeSelect } from '../../components/ui/input';
import { toast } from '../../components/ui/toast';
import { useDemo } from '../../demo/demo-provider';
import { formatDate, formatMoney } from '../../lib/format';

import { AuctionOutcome } from './components/AuctionOutcome';
import { BidForm } from './components/BidForm';
import { BidHistory } from './components/BidHistory';
import { Countdown } from './components/Countdown';
import { MyBidStatus } from './components/MyBidStatus';
import { PublicAuctionView } from './PublicAuctionView';

const statusLabels = {
  live: { label: 'Ao vivo', tone: 'success' },
  scheduled: { label: 'Agendado', tone: 'info' },
  ended: { label: 'Encerrado', tone: 'neutral' },
  cancelled: { label: 'Cancelado', tone: 'danger' },
} as const;

type UpdateState = 'ready' | 'reconnecting' | 'offline';

export function AuctionRoomView() {
  const { auctionId = '' } = useParams();

  return /^[0-9a-f-]{36}$/i.test(auctionId) ? (
    <PublicAuctionView id={auctionId} />
  ) : (
    <DemoAuctionRoomView />
  );
}

function DemoAuctionRoomView() {
  const { auctionId } = useParams();
  const { auctions, bids, user } = useDemo();
  const [updateState, setUpdateState] = useState<UpdateState>('ready');
  const [shareFallback, setShareFallback] = useState('');
  const auction = auctions.find((item) => item.id === auctionId);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success('Link copiado', 'Compartilhe esta sala para mostrar a carta e os lances.');
    } catch {
      setShareFallback(window.location.href);
      toast.info(
        'Copie o endereço do campo abaixo',
        'O navegador não permitiu acessar a área de transferência.',
      );
    }
  }

  if (!auction) {
    return (
      <EmptyState
        title="Lote não encontrado"
        description="Este endereço não corresponde a um lote da demonstração. Explore as cartas disponíveis."
        action={
          <Link to="/auctions" className={buttonVariants()}>
            Voltar aos leilões
          </Link>
        }
      />
    );
  }

  const status = statusLabels[auction.status];
  const auctionBids = bids.filter((bid) => bid.auctionId === auction.id);
  const isBidder = user?.role === 'bidder';

  return (
    <section className="space-y-8">
      <Link
        to="/auctions"
        className="inline-flex min-h-11 items-center font-semibold text-info underline-offset-4 hover:underline"
      >
        Voltar aos leilões
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-semibold leading-tight sm:text-5xl">
            {auction.card.name}
          </h1>
          <p className="mt-2 text-lg text-muted-foreground">
            {auction.card.edition} · Carta {auction.card.number}
          </p>
        </div>
        <Button variant="outline" onClick={() => void copyLink()}>
          Copiar link do lote
        </Button>
      </div>
      {shareFallback && (
        <Field
          label="Link público do lote"
          htmlFor="auction-share-link"
          hint="Selecione e copie este endereço."
        >
          <Input
            id="auction-share-link"
            aria-describedby="auction-share-link-hint"
            readOnly
            value={shareFallback}
            onFocus={(event) => event.target.select()}
          />
        </Field>
      )}
      {updateState !== 'ready' && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-warning bg-muted p-4"
        >
          <div>
            <p className="font-semibold text-warning">
              {updateState === 'offline' ? 'Atualizações pausadas' : 'Reconectando à sala'}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Prévia de conexão indisponível. Os lances ficam bloqueados até os dados serem
              atualizados.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setUpdateState('ready');
              toast.info(
                'Demonstração reconectada',
                'Os dados locais estão disponíveis novamente.',
              );
            }}
          >
            Restaurar demonstração
          </Button>
        </div>
      )}

      <div className="grid items-start gap-8 lg:grid-cols-12 lg:gap-10">
        <div className="rounded-lg bg-muted px-5 py-7 sm:px-10 sm:py-9 lg:col-span-7 lg:col-start-1 lg:row-start-1">
          <CardArtwork
            src={auction.card.image}
            alt={`${auction.card.name}, ${auction.card.edition}, carta ${auction.card.number}`}
            className="mx-auto h-80 w-full sm:h-[440px]"
            zoom
          />
        </div>

        <aside
          aria-label="Lances e situação do lote"
          className="space-y-6 rounded-xl border border-border bg-card p-5 sm:p-7 lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            <span className="text-sm text-muted-foreground">
              {updateState === 'ready' ? 'Dados de demonstração' : 'Atualização pausada'}
            </span>
          </div>
          {auction.status === 'live' || auction.status === 'scheduled' ? (
            <Countdown
              key={`${auction.id}-${auction.status}`}
              deadline={auction.status === 'scheduled' ? auction.startsAt : auction.endsAt}
              scheduled={auction.status === 'scheduled'}
            />
          ) : (
            <div className="text-sm text-muted-foreground">
              <p>{auction.status === 'cancelled' ? 'Prazo original do lote' : 'Encerrado em'}</p>
              <time dateTime={auction.endsAt}>{formatDate(auction.endsAt)}</time>
            </div>
          )}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm text-muted-foreground">
                {auction.bidCount === 0
                  ? 'Lance inicial'
                  : auction.status === 'ended'
                    ? 'Maior lance'
                    : 'Lance atual'}
              </p>
              <p className="mt-1 font-display text-4xl font-semibold tabular-nums sm:text-5xl">
                {formatMoney(
                  auction.bidCount === 0 ? auction.startingBidCents : auction.currentBidCents,
                )}
              </p>
            </div>
            <p className="pb-1 text-sm text-muted-foreground">
              {auction.bidCount} {auction.bidCount === 1 ? 'lance' : 'lances'}
            </p>
          </div>
          {isBidder &&
            (auction.status === 'live' ||
              (auction.status === 'ended' && auction.participation)) && (
              <MyBidStatus auction={auction} />
            )}
          {auction.status === 'live' ? (
            <BidForm key={auction.id} auction={auction} updatesPaused={updateState !== 'ready'} />
          ) : (
            <AuctionOutcome auction={auction} />
          )}
          {auction.status === 'scheduled' && isBidder && (
            <Link
              to="/wallet"
              className={buttonVariants({ variant: 'outline', className: 'w-full' })}
            >
              Preparar meu saldo simulado
            </Link>
          )}
          {auction.status !== 'ended' && (
            <Link
              to={`/auctions/${auction.id}/audit`}
              className="inline-flex min-h-11 items-center text-sm font-semibold text-info underline-offset-4 hover:underline"
            >
              Consultar auditoria do lote
            </Link>
          )}
        </aside>
        <div className="space-y-6 lg:col-span-7 lg:col-start-1 lg:row-start-2">
          <dl className="grid grid-cols-2 gap-x-5 gap-y-5 border-b border-border pb-6">
            {[
              ['Tipo', auction.card.types.join(', ')],
              ['Raridade', auction.card.rarity],
              ['Ilustrador', auction.card.illustrator],
              ['Pontos de vida', String(auction.card.hp)],
              ['Origem', 'Catálogo TCGdex'],
              ['Leiloeiro', auction.seller],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd className="mt-1 break-words font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm leading-relaxed text-muted-foreground">
            A imagem e os atributos identificam a carta no catálogo. Esta demonstração não
            representa uma oferta de carta física nem uma avaliação de conservação.
          </p>
        </div>
      </div>

      <div className="grid gap-8 border-t border-border pt-8 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-7">
          <BidHistory
            key={auction.id}
            bids={auctionBids}
            showMine={isBidder}
            acceptsBids={auction.status === 'live'}
          />
        </div>
        <section aria-labelledby="auction-rules-heading" className="space-y-4 lg:col-span-5">
          <h2 id="auction-rules-heading" className="font-display text-3xl font-semibold">
            Como este lote funciona
          </h2>
          <dl className="space-y-4 text-sm">
            <div className="flex justify-between gap-4 border-b border-border pb-4">
              <dt className="text-muted-foreground">Incremento mínimo</dt>
              <dd className="font-semibold tabular-nums">{formatMoney(auction.incrementCents)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-border pb-4">
              <dt className="text-muted-foreground">Lance inicial</dt>
              <dd className="font-semibold tabular-nums">
                {formatMoney(auction.startingBidCents)}
              </dd>
            </div>
          </dl>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Somente o maior lance mantém saldo reservado. O resultado é confirmado após o
            encerramento e a liquidação.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Lances próximos do encerramento podem estender o prazo. Confira sempre o horário final
            exibido na sala.
          </p>
        </section>
      </div>
      <details className="border-t border-border pt-5 text-sm text-muted-foreground">
        <summary className="w-fit cursor-pointer py-2">Visualizar estados da demonstração</summary>
        <div className="mt-3 max-w-xs space-y-2">
          <label htmlFor="room-update-preview">Atualização da sala</label>
          <NativeSelect
            id="room-update-preview"
            value={updateState}
            onChange={(event) => setUpdateState(event.target.value as UpdateState)}
          >
            <option value="ready">Dados disponíveis</option>
            <option value="reconnecting">Reconectando</option>
            <option value="offline">Sem conexão</option>
          </NativeSelect>
        </div>
      </details>
    </section>
  );
}
