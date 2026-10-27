import type { MyAuctionState } from '@holobid/contracts';

import { formatMoney } from '../../../lib/format';

export function MyBidStatus({
  position,
  resultConfirmed,
}: {
  position: MyAuctionState;
  resultConfirmed: boolean;
}) {
  const state =
    !resultConfirmed && (position.state === 'WON' || position.state === 'LOST')
      ? 'PROCESSING'
      : position.state;
  const titles = {
    NOT_PARTICIPATING: 'Você ainda não participou deste lote',
    LEADING: 'Você está na liderança',
    OUTBID: 'Você foi superado',
    WON: 'Carta arrematada por você',
    LOST: 'Outro participante arrematou este lote',
    PROCESSING: 'Resultado em processamento',
  };

  return (
    <div className="space-y-2 border-y border-border py-4" aria-live="polite">
      <p
        className={`font-semibold ${state === 'LEADING' || state === 'WON' ? 'text-success' : state === 'OUTBID' || state === 'PROCESSING' ? 'text-warning' : ''}`}
      >
        {titles[state]}
      </p>
      {position.rank !== null && (
        <p className="text-sm">
          Sua posição: {position.rank}º · Maior lance: {formatMoney(position.highestBidCents ?? 0)}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Reservado neste lote: {formatMoney(position.reservedForThisAuctionCents)}
      </p>
      {state === 'LEADING' && (
        <p className="text-sm text-muted-foreground">
          A liderança só se torna um arremate após a liquidação.
        </p>
      )}
    </div>
  );
}
