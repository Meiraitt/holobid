import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { CardArtwork } from '../../components/shared/card-artwork';
import { EmptyState } from '../../components/shared/empty-state';
import { PageHeader } from '../../components/shared/page-header';
import { Button, buttonVariants } from '../../components/ui/button';
import { formatDate, formatMoney } from '../../lib/format';
import { apiClient } from '../../services';
import { ApiRequestError, errorMessage } from '../../services/api-error';
import { mediaUrl } from '../../services/media-url';
import { auctionDetailOptions } from '../auctions/auction-queries';

const labels = {
  LIVE: 'Ao vivo',
  SCHEDULED: 'Agendado',
  ENDED: 'Encerrado',
  CANCELLED: 'Cancelado',
};

// Public persisted detail; bidding and realtime controls are integrated in FE-08/09.
export function PublicAuctionView({ id }: { id: string }) {
  const query = useQuery(auctionDetailOptions(id));
  const auction = query.data;

  if (query.isPending) {
    return <p role="status">Carregando lote…</p>;
  }

  if (!auction) {
    return (
      <EmptyState
        title={
          query.error instanceof ApiRequestError && query.error.status === 404
            ? 'Lote não encontrado'
            : 'Não foi possível carregar o lote'
        }
        description={errorMessage(query.error)}
        action={<Button onClick={() => void query.refetch()}>Tentar novamente</Button>}
      />
    );
  }

  return (
    <section className="space-y-8">
      <Link className={buttonVariants({ variant: 'ghost' })} to="/auctions">
        Voltar aos leilões
      </Link>
      <PageHeader
        title={auction.title}
        description={`${auction.setName} · Carta ${auction.cardNumber}`}
      />
      {query.isError && (
        <p role="alert">Atualização indisponível. Os dados exibidos podem estar desatualizados.</p>
      )}
      <div className="grid gap-8 lg:grid-cols-2">
        <CardArtwork
          src={mediaUrl(auction.imageUrl, apiClient.origin)}
          alt={auction.title}
          className="h-[440px]"
          zoom
        />
        <div className="space-y-5 rounded-lg border border-border bg-card p-6">
          <p className="font-semibold">{labels[auction.status]}</p>
          <p className="text-muted-foreground">
            {auction.currentBidCents === null ? 'Lance inicial' : 'Maior lance'}
          </p>
          <p className="text-3xl font-semibold">
            {formatMoney(auction.currentBidCents ?? auction.startingPriceCents)}
          </p>
          <p>
            {auction.bidCount} lances · Incremento mínimo{' '}
            {formatMoney(auction.minimumIncrementCents)}
          </p>
          <p>Início: {formatDate(auction.startsAt)}</p>
          <p>Encerramento: {formatDate(auction.endsAt)}</p>
          <p className="text-sm text-muted-foreground">Horários de Brasília</p>
          {auction.outcome?.kind === 'NO_BIDS' && <p>Encerrado sem lances.</p>}
          <p className="border-t border-border pt-5 text-sm text-muted-foreground">
            Lote conectado à API. A integração dos lances e do acompanhamento em tempo real será
            disponibilizada na próxima etapa.
          </p>
        </div>
      </div>
      {auction.description && <p>{auction.description}</p>}
    </section>
  );
}
