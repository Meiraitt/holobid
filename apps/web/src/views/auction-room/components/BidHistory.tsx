import { useState } from 'react';

import { Button } from '../../../components/ui/button';
import type { DemoBid } from '../../../demo/types';
import { formatDate, formatMoney } from '../../../lib/format';

export function BidHistory({
  bids,
  showMine,
  acceptsBids,
}: {
  bids: DemoBid[];
  showMine: boolean;
  acceptsBids: boolean;
}) {
  const [visibleCount, setVisibleCount] = useState(5);
  const orderedBids = [...bids].sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
  const visibleBids = orderedBids.slice(0, visibleCount);

  return (
    <section aria-labelledby="bid-history-heading" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-4">
        <h2 id="bid-history-heading" className="font-display text-3xl font-semibold">
          Histórico de lances
        </h2>
        <span className="text-sm text-muted-foreground">Mais recentes primeiro</span>
      </div>
      {bids.length === 0 ? (
        <p className="py-8 text-muted-foreground">
          {acceptsBids
            ? 'Nenhum lance registrado. O primeiro pode ser seu.'
            : 'Nenhum lance foi registrado neste lote.'}
        </p>
      ) : (
        <>
          <ol className="divide-y divide-border">
            {visibleBids.map((bid) => (
              <li key={bid.id} className="flex items-center justify-between gap-4 py-4">
                <div className="min-w-0">
                  <p
                    className={`break-words font-semibold ${bid.isMine && showMine ? 'text-success' : ''}`}
                  >
                    {bid.isMine && showMine
                      ? 'Você'
                      : bid.bidder === 'Você'
                        ? 'Lic. 6A20'
                        : bid.bidder}
                  </p>
                  <time dateTime={bid.at} className="mt-1 block text-sm text-muted-foreground">
                    {formatDate(bid.at)}
                  </time>
                </div>
                <p className="shrink-0 text-lg font-semibold tabular-nums">
                  {formatMoney(bid.amountCents)}
                </p>
              </li>
            ))}
          </ol>
          {visibleCount < orderedBids.length && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setVisibleCount((count) => count + 5)}
            >
              Ver lances anteriores
            </Button>
          )}
        </>
      )}
    </section>
  );
}
