import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { CardArtwork } from '../../components/shared/card-artwork';
import { EmptyState } from '../../components/shared/empty-state';
import { StatusBadge } from '../../components/shared/status-badge';
import { Button, buttonVariants } from '../../components/ui/button';
import { Field, Input } from '../../components/ui/input';
import { toast } from '../../components/ui/toast';
import { formatDate, formatMoney } from '../../lib/format';
import { useAuth } from '../../providers/auth-provider';
import { useRealtimeRoom } from '../../providers/realtime-provider';
import { apiClient } from '../../services';
import { ApiRequestError, errorMessage } from '../../services/api-error';
import { mediaUrl } from '../../services/media-url';
import { walletOptions } from '../wallet/wallet-queries';

import { AuctionOutcome, confirmedOutcome } from './components/AuctionOutcome';
import { BidForm } from './components/BidForm';
import { BidHistory } from './components/BidHistory';
import { Countdown } from './components/Countdown';
import { MyBidStatus } from './components/MyBidStatus';
import { myBidOptions, roomOptions } from './room-queries';
import { useServerClock } from './server-clock';

const labels = {
  LIVE: 'Ao vivo',
  SCHEDULED: 'Agendado',
  ENDED: 'Encerrado',
  CANCELLED: 'Cancelado',
};

export function AuctionRoomView() {
  const { auctionId = '' } = useParams();

  return <Room key={auctionId} id={auctionId} />;
}

function Room({ id }: { id: string }) {
  const { user, status: authStatus } = useAuth();
  const realtime = useRealtimeRoom(id);
  const subscribed = realtime.room === 'joined' || realtime.room === 'missing';
  const room = useQuery({ ...roomOptions(id), enabled: subscribed });
  const auction = room.data?.auction;
  const missing =
    realtime.room === 'missing' ||
    (room.error instanceof ApiRequestError && [400, 404].includes(room.error.status));
  const isBidder = user?.role === 'BIDDER';
  const position = useQuery({
    ...myBidOptions(user?.id ?? '', id),
    enabled: Boolean(isBidder && auction && subscribed),
  });
  const wallet = useQuery({
    ...walletOptions(user?.id ?? ''),
    enabled: Boolean(isBidder && auction && subscribed),
  });
  const now = useServerClock(
    room.data
      ? { serverTime: room.data.auction.serverTime, receivedAt: room.data.receivedAt }
      : undefined,
  );
  const [shareFallback, setShareFallback] = useState('');
  const lastBoundary = useRef('');
  const deadline = auction?.status === 'SCHEDULED' ? auction.startsAt : auction?.endsAt;
  const expired = now !== null && deadline !== undefined && now >= Date.parse(deadline);
  const boundaryKey = `${auction?.status}:${deadline}`;
  const { refetch } = room;

  useEffect(() => {
    if (
      expired &&
      lastBoundary.current !== boundaryKey &&
      (auction?.status === 'SCHEDULED' || auction?.status === 'LIVE')
    ) {
      lastBoundary.current = boundaryKey;
      void refetch();
    }
  }, [expired, boundaryKey, auction?.status, refetch]);

  async function refresh() {
    realtime.retry();
    await Promise.all([
      room.refetch(),
      ...(isBidder ? [position.refetch(), wallet.refetch()] : []),
    ]);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success('Link copiado', 'Compartilhe esta sala para mostrar a carta e os lances.');
    } catch {
      setShareFallback(window.location.href);
      toast.info(
        'Copie o endereço abaixo',
        'O navegador não permitiu acessar a área de transferência.',
      );
    }
  }

  if (
    !missing &&
    (realtime.room === 'unavailable' ||
      (!auction && ['disconnected', 'unavailable'].includes(realtime.phase)))
  ) {
    return (
      <EmptyState
        title="Conexão com a sala indisponível"
        description="Não foi possível sincronizar o lote. Reconecte para carregar os dados atuais."
        action={<Button onClick={realtime.retry}>Reconectar</Button>}
      />
    );
  }

  if (!missing && room.isPending) {
    return <p role="status">Carregando lote…</p>;
  }

  if (missing || !auction) {
    return (
      <EmptyState
        title="Lote indisponível"
        description={
          missing ? 'Este lote não existe ou foi retirado da vitrine.' : errorMessage(room.error)
        }
        action={
          <>
            <Button onClick={() => void room.refetch()}>Tentar novamente</Button>
            <Link to="/auctions" className={buttonVariants({ variant: 'ghost' })}>
              Voltar aos leilões
            </Link>
          </>
        }
      />
    );
  }

  const age = now === null ? Infinity : now - Date.parse(auction.serverTime);
  const updatesPaused =
    !realtime.ready ||
    room.isError ||
    age > 45000 ||
    expired ||
    !position.isSuccess ||
    !wallet.isSuccess;
  const privateFailure = isBidder && (position.isError || wallet.isError);
  const attributes = [
    ['Tipo', auction.attributes.types?.join(', ')],
    ['Raridade', auction.attributes.rarity],
    ['Ilustrador', auction.attributes.illustrator],
    ['Pontos de vida', auction.attributes.hp],
    ['Origem', 'Catálogo TCGdex'],
  ];

  return (
    <section className="space-y-8">
      <Link
        to="/auctions"
        className="inline-flex min-h-11 items-center font-semibold text-info hover:underline"
      >
        Voltar aos leilões
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-semibold leading-tight sm:text-5xl">
            {auction.title}
          </h1>
          <p className="mt-2 text-lg text-muted-foreground">
            {auction.setName} · Carta {auction.cardNumber}
          </p>
        </div>
        <Button variant="outline" onClick={() => void copyLink()}>
          Copiar link do lote
        </Button>
      </div>
      {shareFallback && (
        <Field label="Link público do lote" htmlFor="auction-share-link">
          <Input
            id="auction-share-link"
            readOnly
            value={shareFallback}
            onFocus={(event) => event.target.select()}
          />
        </Field>
      )}
      {(room.isError || privateFailure || age > 45000) && (
        <div role="alert" className="space-y-3 border-l-2 border-warning bg-muted p-4">
          <p>
            Atualização indisponível. Os dados exibidos podem estar desatualizados e novos lances
            estão bloqueados.
          </p>
          <Button
            variant="outline"
            loading={room.isFetching || position.isFetching || wallet.isFetching}
            onClick={() => void refresh()}
          >
            Atualizar sala
          </Button>
        </div>
      )}
      <div className="grid items-start gap-8 lg:grid-cols-12 lg:gap-10">
        <div className="rounded-lg bg-muted px-5 py-7 sm:px-10 sm:py-9 lg:col-span-7">
          <CardArtwork
            src={mediaUrl(auction.imageUrl, apiClient.origin)}
            alt={`${auction.title}, ${auction.setName}, carta ${auction.cardNumber}`}
            className="mx-auto h-80 w-full sm:h-[440px]"
            zoom
          />
        </div>
        <aside
          aria-label="Lances e situação do lote"
          className="space-y-6 rounded-xl border border-border bg-card p-5 sm:p-7 lg:col-span-5 lg:row-span-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusBadge
              tone={
                auction.status === 'LIVE'
                  ? 'success'
                  : auction.status === 'SCHEDULED'
                    ? 'info'
                    : 'neutral'
              }
            >
              {labels[auction.status]}
            </StatusBadge>
            <span className="text-sm text-muted-foreground">
              {realtime.ready ? 'Atualizações ao vivo' : 'Sincronizando sala…'}
            </span>
          </div>
          {deadline &&
            now !== null &&
            (auction.status === 'LIVE' || auction.status === 'SCHEDULED') && (
              <Countdown
                key={auction.status}
                deadline={deadline}
                now={now}
                scheduled={auction.status === 'SCHEDULED'}
              />
            )}
          {auction.status === 'ENDED' && (
            <p className="text-sm text-muted-foreground">
              Encerrado em <time dateTime={auction.endsAt}>{formatDate(auction.endsAt)}</time> ·
              Horário de Brasília
            </p>
          )}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm text-muted-foreground">
                {auction.currentBidCents === null ? 'Lance inicial' : 'Maior lance'}
              </p>
              <p className="mt-1 font-display text-4xl font-semibold tabular-nums sm:text-5xl">
                {formatMoney(auction.currentBidCents ?? auction.startingPriceCents)}
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              {auction.bidCount} {auction.bidCount === 1 ? 'lance' : 'lances'}
            </p>
          </div>
          {isBidder && position.data && (
            <MyBidStatus
              position={position.data}
              resultConfirmed={Boolean(confirmedOutcome(auction))}
            />
          )}
          {auction.status !== 'LIVE' && <AuctionOutcome auction={auction} />}
          {auction.status === 'LIVE' && !auction.canReceiveBids && (
            <p role="status" className="text-warning">
              O lote está em verificação. Aguarde a liberação dos lances pelo servidor.
            </p>
          )}
          {authStatus === 'restoring' ? (
            <p role="status">Verificando sua sessão…</p>
          ) : !user ? (
            <div className="space-y-3">
              <p>Entre na sua conta para participar.</p>
              <Link
                to={`/login?returnTo=${encodeURIComponent(`/auctions/${id}`)}`}
                className={buttonVariants({ className: 'w-full' })}
              >
                Entrar para dar lance
              </Link>
            </div>
          ) : user.role === 'AUCTIONEER' ? (
            <p className="text-sm text-muted-foreground">
              Contas de leiloeiro acompanham os lances e resultados. Para gerenciar seus lotes,
              acesse o painel.
            </p>
          ) : position.data && wallet.data ? (
            <BidForm
              key={user.id}
              userId={user.id}
              auction={auction}
              wallet={wallet.data}
              position={position.data}
              updatesPaused={updatesPaused}
            />
          ) : (
            <p role="status">
              {privateFailure
                ? 'Não foi possível carregar sua posição e saldo.'
                : 'Carregando sua posição e saldo…'}
            </p>
          )}
        </aside>
        <div className="space-y-6 lg:col-span-7">
          <dl className="grid grid-cols-2 gap-5 border-b border-border pb-6">
            {attributes
              .filter(([, value]) => value !== undefined && value !== '')
              .map(([label, value]) => (
                <div key={label}>
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="mt-1 break-words font-medium">{value}</dd>
                </div>
              ))}
          </dl>
          {auction.description && <p>{auction.description}</p>}
        </div>
      </div>
      <div className="grid gap-8 border-t border-border pt-8 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-7">
          <BidHistory
            auctionId={id}
            myPseudonym={isBidder ? position.data?.myPseudonym : undefined}
          />
        </div>
        <section className="space-y-4 lg:col-span-5" aria-labelledby="auction-rules-heading">
          <h2 id="auction-rules-heading" className="font-display text-3xl font-semibold">
            Como este lote funciona
          </h2>
          <dl className="space-y-4 text-sm">
            <div className="flex justify-between gap-4 border-b pb-4">
              <dt>Incremento mínimo</dt>
              <dd>{formatMoney(auction.minimumIncrementCents)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b pb-4">
              <dt>Lance inicial</dt>
              <dd>{formatMoney(auction.startingPriceCents)}</dd>
            </div>
          </dl>
          <p className="text-sm text-muted-foreground">
            Somente o maior lance mantém saldo reservado. O resultado é confirmado após o
            encerramento e a liquidação.
          </p>
          <p className="text-sm text-muted-foreground">
            Lances aceitos nos últimos 2 minutos levam o encerramento para 2 minutos após o lance.
            Confira o prazo atualizado na sala.
          </p>
        </section>
      </div>
    </section>
  );
}
