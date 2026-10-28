import { Clock3 } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { DemoAuction } from '../../demo/types';
import { formatDate } from '../../lib/format';

import { CardArtwork } from './card-artwork';
import { Money } from './money';
import { StatusBadge } from './status-badge';

const statuses = {
  live: 'Ao vivo',
  scheduled: 'Agendado',
  ended: 'Encerrado',
  cancelled: 'Cancelado',
};

export function AuctionCard({
  auction,
  priority = false,
}: {
  auction: Pick<
    DemoAuction,
    'id' | 'status' | 'bidCount' | 'currentBidCents' | 'startsAt' | 'endsAt'
  > & { card: Pick<DemoAuction['card'], 'image' | 'name' | 'edition' | 'number'> };
  priority?: boolean;
}) {
  return (
    <article className="group min-w-0">
      <Link
        to={`/auctions/${auction.id}`}
        className="block rounded-md focus-visible:outline-offset-6"
      >
        <CardArtwork
          priority={priority}
          src={auction.card.image}
          alt={`${auction.card.name}, ${auction.card.edition}, carta ${auction.card.number}`}
          className="h-72 border border-transparent transition-colors duration-200 motion-reduce:transition-none group-hover:border-input"
        />
        <div className="mt-4 flex items-center justify-between gap-2">
          <StatusBadge
            tone={
              auction.status === 'live'
                ? 'success'
                : auction.status === 'scheduled'
                  ? 'info'
                  : 'neutral'
            }
          >
            {statuses[auction.status]}
          </StatusBadge>
          <span className="text-sm text-muted-foreground">{auction.bidCount} lances</span>
        </div>
        <h2 className="mt-2 text-3xl group-hover:underline group-hover:decoration-primary/60 group-hover:underline-offset-4">
          {auction.card.name}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {auction.card.edition} · Carta {auction.card.number}
        </p>
        <div className="mt-4 flex items-end justify-between gap-2">
          <div>
            <p className="text-sm text-muted-foreground">
              {auction.bidCount === 0
                ? 'Lance inicial'
                : auction.status === 'ended'
                  ? 'Lance final'
                  : 'Lance atual'}
            </p>
            <Money cents={auction.currentBidCents} className="text-xl font-semibold" />
          </div>
          <span className="text-sm font-semibold text-info">Ver lote</span>
        </div>
        <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
          <Clock3 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {auction.status === 'scheduled'
            ? 'Começa '
            : auction.status === 'live'
              ? 'Encerra '
              : 'Encerramento '}
          {formatDate(auction.status === 'scheduled' ? auction.startsAt : auction.endsAt)}
        </p>
      </Link>
    </article>
  );
}
