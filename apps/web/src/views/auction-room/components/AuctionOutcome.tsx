import { Link } from 'react-router';

import type { AuctionDetail } from '@holobid/contracts';

import { formatMoney } from '../../../lib/format';

export function confirmedOutcome(auction: AuctionDetail) {
  return auction.status === 'ENDED' &&
    auction.settlementStatus === 'COMPLETED' &&
    auction.confirmation === 'CONFIRMED' &&
    auction.auditIntegrity === 'VERIFIED'
    ? auction.outcome
    : undefined;
}

export function AuctionOutcome({ auction }: { auction: AuctionDetail }) {
  if (auction.status === 'SCHEDULED') {
    return (
      <p className="text-sm text-muted-foreground">
        Os lances serão liberados no início do leilão.
      </p>
    );
  }

  const outcome = confirmedOutcome(auction);
  const failed = auction.settlementStatus === 'FAILED';

  return (
    <div className="space-y-3" aria-live="polite">
      <h2
        className={`font-display text-2xl font-semibold ${failed ? 'text-destructive' : outcome ? 'text-success' : ''}`}
      >
        {auction.status === 'CANCELLED'
          ? 'Lote cancelado'
          : failed
            ? 'Liquidação interrompida'
            : outcome?.kind === 'NO_BIDS'
              ? 'Encerrado sem lances'
              : outcome?.kind === 'SOLD'
                ? 'Arremate concluído'
                : 'Resultado em processamento'}
      </h2>
      <p className="text-sm text-muted-foreground">
        {outcome?.kind === 'SOLD'
          ? `Vencedor: ${outcome.winnerPseudonym} · ${formatMoney(outcome.amountCents)}`
          : outcome?.kind === 'NO_BIDS'
            ? 'Não houve vencedor. Valor arrematado: R$ 0,00.'
            : 'Novos lances indisponíveis. Aguarde a confirmação do servidor; o contador não confirma o arremate.'}
      </p>
      {outcome?.kind === 'SOLD' && (
        <p className="break-all text-xs text-muted-foreground">
          <Link
            to={`/receipts/${encodeURIComponent(outcome.receiptCode)}`}
            className="text-info underline underline-offset-4"
          >
            Ver comprovante público
          </Link>
        </p>
      )}
    </div>
  );
}
