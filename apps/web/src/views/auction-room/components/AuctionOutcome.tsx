import { Link } from 'react-router-dom';

import { buttonVariants } from '../../../components/ui/button';
import type { DemoAuction } from '../../../demo/types';

export function AuctionOutcome({ auction }: { auction: DemoAuction }) {
  if (auction.status === 'scheduled') {
    return (
      <p className="text-sm leading-relaxed text-muted-foreground">
        Os lances serão liberados no início do leilão. Você pode conferir a carta e preparar seu
        saldo simulado.
      </p>
    );
  }

  if (auction.status === 'cancelled') {
    return (
      <div className="space-y-3">
        <h2 className="font-display text-2xl font-semibold">Lote cancelado</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Este lote não recebe novos lances. Qualquer valor reservado foi liberado.
        </p>
        <Link
          to="/auctions"
          className={buttonVariants({ variant: 'outline', className: 'w-full' })}
        >
          Explorar outros lotes
        </Link>
      </div>
    );
  }

  const settled = auction.settlement === 'settled';
  const noBids = auction.bidCount === 0;
  const failed = auction.settlement === 'failed';

  return (
    <div className="space-y-3">
      <h2
        className={`font-display text-2xl font-semibold ${failed ? 'text-destructive' : settled ? 'text-success' : 'text-foreground'}`}
      >
        {noBids
          ? 'Encerrado sem lances'
          : failed
            ? 'Liquidação interrompida'
            : settled
              ? 'Arremate concluído'
              : 'Resultado em processamento'}
      </h2>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {noBids
          ? 'Não houve participantes neste lote. Nenhum saldo foi movimentado.'
          : failed
            ? 'O fechamento precisa de revisão. O arremate não está confirmado; acompanhe o estado e a auditoria deste lote.'
            : settled
              ? 'O leilão foi encerrado e o saldo foi liquidado. Consulte os lances e o comprovante público.'
              : 'Não são aceitos novos lances. Aguarde a confirmação da liquidação; a liderança ainda não é um comprovante de arremate.'}
      </p>
      {settled && auction.receiptId && (
        <Link
          to={`/receipts/${auction.receiptId}`}
          className={buttonVariants({ className: 'w-full' })}
        >
          Ver comprovante público
        </Link>
      )}
      <Link
        to={`/auctions/${auction.id}/audit`}
        className={buttonVariants({ variant: 'outline', className: 'w-full' })}
      >
        Consultar auditoria
      </Link>
    </div>
  );
}
