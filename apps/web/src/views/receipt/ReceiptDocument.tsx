import { Link } from 'react-router';

import type { PublicReceipt } from '@holobid/contracts';

import { CardArtwork } from '../../components/shared/card-artwork';
import { Money } from '../../components/shared/money';
import { StatusBadge } from '../../components/shared/status-badge';
import { buttonVariants } from '../../components/ui/button';
import { formatDate } from '../../lib/format';
import { apiClient } from '../../services';
import { mediaUrl } from '../../services/media-url';

export function ReceiptDocument({ receipt }: { receipt: PublicReceipt }) {
  return (
    <article className="receipt-document overflow-hidden rounded-lg border bg-card print:rounded-none print:border-0">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b p-6 sm:p-9">
        <div>
          <p className="font-display text-4xl font-semibold">HoloBid</p>
          <h2 className="mt-3 text-lg font-semibold">Comprovante de arremate</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Registro público emitido na liquidação
          </p>
        </div>
        <StatusBadge tone="success">Arremate simulado concluído</StatusBadge>
      </header>
      <div className="space-y-8 p-6 sm:p-9">
        <div className="flex items-center gap-6 border-b pb-8 sm:gap-8">
          <CardArtwork
            src={mediaUrl(receipt.imageUrl, apiClient.origin)}
            alt={`${receipt.title}, ${receipt.setName}`}
            className="h-40 min-h-0 w-28 shrink-0 p-0 sm:h-48 sm:w-32"
          />
          <div className="min-w-0">
            <h3 className="font-display text-3xl font-semibold sm:text-4xl">{receipt.title}</h3>
            <p className="mt-2 text-muted-foreground">{receipt.setName}</p>
            <p className="mt-2 text-sm text-muted-foreground">Carta {receipt.cardNumber}</p>
            <p className="mt-2 text-sm">{receipt.attributes.rarity}</p>
          </div>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Valor do arremate</p>
          <p className="mt-2 font-display text-4xl font-semibold sm:text-5xl">
            <Money cents={receipt.amountCents} />
          </p>
        </div>
        <dl className="grid gap-x-8 gap-y-6 border-y py-7 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted-foreground">Arrematante</dt>
            <dd className="mt-1 break-all font-semibold">{receipt.winnerPseudonym}</dd>
            <dd className="mt-1 text-xs text-muted-foreground">Pseudônimo público deste lote</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Liquidação confirmada em</dt>
            <dd className="mt-1 font-semibold">{formatDate(receipt.settledAt)}</dd>
            <dd className="mt-1 text-xs text-muted-foreground">Horário de São Paulo</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Lote</dt>
            <dd className="mt-1 break-all text-sm">{receipt.auctionId}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Código público do comprovante</dt>
            <dd className="mt-1 break-all text-sm">{receipt.publicCode}</dd>
          </div>
        </dl>
        <details className="text-sm">
          <summary className="w-fit cursor-pointer py-2 text-info">
            Hash do fechamento registrado
          </summary>
          <p className="mt-2 break-all font-mono text-xs">{receipt.finalAuditHash}</p>
          <p className="mt-3 text-muted-foreground">
            Este registro preserva o resultado na emissão. A auditoria pública apresenta a
            verificação atual do histórico.
          </p>
        </details>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Os valores são simulados. Este comprovante não representa pagamento real, nota fiscal ou
          promessa de entrega física.
        </p>
        <div className="flex flex-wrap gap-3 print:hidden">
          <Link
            className={buttonVariants({ variant: 'outline' })}
            to={`/auctions/${receipt.auctionId}/audit`}
          >
            Consultar auditoria
          </Link>
          <Link
            className={buttonVariants({ variant: 'ghost' })}
            to={`/auctions/${receipt.auctionId}`}
          >
            Ver lote
          </Link>
        </div>
      </div>
    </article>
  );
}
