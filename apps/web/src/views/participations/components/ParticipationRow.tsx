import { Link } from 'react-router';

import type { Participation, ParticipationState } from '@holobid/contracts';

import { CardArtwork } from '../../../components/shared/card-artwork';
import { Money } from '../../../components/shared/money';
import { StatusBadge } from '../../../components/shared/status-badge';
import { buttonVariants } from '../../../components/ui/button';
import { formatDate } from '../../../lib/format';
import { apiClient } from '../../../services';
import { mediaUrl } from '../../../services/media-url';

const content = {
  LEADING: {
    title: 'Você está ganhando',
    detail: 'Seu lance está reservado até o resultado ou até você ser superado.',
    tone: 'success',
  },
  OUTBID: {
    title: 'Você foi superado',
    detail: 'Sua reserva foi liberada. A disputa continua.',
    tone: 'warning',
  },
  WON: {
    title: 'Arrematado',
    detail: 'Arremate concluído. Seu comprovante público está disponível.',
    tone: 'success',
  },
  LOST: {
    title: 'Encerrado sem arremate',
    detail: 'Outro participante arrematou esta carta.',
    tone: 'neutral',
  },
  PROCESSING: {
    title: 'Resultado em processamento',
    detail: 'Aguarde a conclusão da liquidação antes de considerar o resultado confirmado.',
    tone: 'warning',
  },
} as const;

export function participationResult(item: Participation) {
  const completed = item.auction.status === 'ENDED' && item.settlementStatus === 'COMPLETED';
  let state: ParticipationState = item.state === 'NOT_PARTICIPATING' ? 'PROCESSING' : item.state;

  if (
    (state === 'WON' && (!completed || !item.receiptCode)) ||
    (state === 'LOST' && !completed) ||
    (item.auction.status === 'ENDED' && ['LEADING', 'OUTBID'].includes(state))
  ) {
    state = 'PROCESSING';
  }

  if (item.settlementStatus === 'FAILED') {
    return {
      state: 'PROCESSING' as const,
      title: 'Liquidação interrompida',
      detail: 'O resultado ainda não foi confirmado. Consulte a auditoria do lote.',
      tone: 'danger' as const,
      receiptCode: null,
    };
  }

  return { state, ...content[state], receiptCode: state === 'WON' ? item.receiptCode : null };
}

export function ParticipationRow({
  item,
  priority = false,
}: {
  item: Participation;
  priority?: boolean;
}) {
  const { auction } = item;
  const result = participationResult(item);
  const ended = auction.status === 'ENDED';

  return (
    <li className="grid gap-6 py-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] lg:items-center">
      <div className="flex min-w-0 items-center gap-5">
        <CardArtwork
          priority={priority}
          src={mediaUrl(auction.imageUrl, apiClient.origin)}
          alt={`${auction.title}, ${auction.setName}`}
          className="h-32 min-h-0 w-24 shrink-0 p-0"
        />
        <div className="min-w-0">
          <StatusBadge tone={result.tone}>{result.title}</StatusBadge>
          <h2 className="mt-3 font-display text-2xl font-semibold">
            <Link className="hover:underline" to={`/auctions/${auction.id}`}>
              {auction.title}
            </Link>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {auction.setName} / {auction.cardNumber}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {ended ? 'Encerrado em' : 'Encerra em'} {formatDate(auction.endsAt)}
          </p>
        </div>
      </div>
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-5">
          <div>
            <dt className="text-sm text-muted-foreground">Seu maior lance</dt>
            <dd className="mt-1 text-lg font-semibold">
              {item.highestBidCents === null ? (
                'Não disponível'
              ) : (
                <Money cents={item.highestBidCents} />
              )}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">
              {ended ? 'Lance final' : 'Lance atual'}
            </dt>
            <dd className="mt-1 text-lg font-semibold">
              {auction.currentBidCents === null ? (
                'Sem lances'
              ) : (
                <Money cents={auction.currentBidCents} />
              )}
            </dd>
          </div>
        </dl>
        {!ended && item.rank !== null && (
          <p className="text-sm">
            Sua posição: <strong>{item.rank}º lugar</strong>
          </p>
        )}
        <p
          className={`text-sm ${result.tone === 'danger' ? 'text-destructive' : result.tone === 'warning' ? 'text-warning' : 'text-muted-foreground'}`}
        >
          {result.detail}
        </p>
      </div>
      <div className="flex flex-wrap gap-2 lg:max-w-44 lg:justify-end">
        <Link className={buttonVariants({ variant: 'outline' })} to={`/auctions/${auction.id}`}>
          {ended ? 'Ver lote' : 'Acompanhar disputa'}
        </Link>
        {result.receiptCode && (
          <Link
            className={buttonVariants()}
            to={`/receipts/${encodeURIComponent(result.receiptCode)}`}
          >
            Ver comprovante
          </Link>
        )}
        {ended && (
          <Link
            className="inline-flex min-h-11 items-center px-3 text-sm text-info hover:underline"
            to={`/auctions/${auction.id}/audit`}
          >
            Auditoria pública
          </Link>
        )}
      </div>
    </li>
  );
}
