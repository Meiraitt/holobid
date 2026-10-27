import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { CardArtwork } from '../../components/shared/card-artwork';
import { EmptyState } from '../../components/shared/empty-state';
import { Money } from '../../components/shared/money';
import { PageHeader } from '../../components/shared/page-header';
import { StatusBadge } from '../../components/shared/status-badge';
import { Button, buttonVariants } from '../../components/ui/button';
import { Field, Input, NativeSelect } from '../../components/ui/input';
import { toast } from '../../components/ui/toast';
import { useDemo } from '../../demo/demo-provider';
import { formatDate } from '../../lib/format';

type PreviewState = 'original' | 'pending' | 'tampered';

export function ReceiptView() {
  const { receiptId = '' } = useParams();
  const { auctions, bids } = useDemo();
  const [preview, setPreview] = useState<{ id: string; state: PreviewState } | null>(null);
  const [manualCopy, setManualCopy] = useState(false);
  const auction = auctions.find((item) => item.receiptId === receiptId);
  const previewState = preview?.id === receiptId ? preview.state : 'original';
  const integrity = previewState === 'original' ? auction?.integrity : previewState;
  const canShowReceipt =
    auction?.status === 'ended' &&
    auction.settlement === 'settled' &&
    integrity === 'verified' &&
    auction.bidCount > 0;
  const publicUrl = typeof window === 'undefined' ? '' : window.location.href;
  const history = bids
    .filter((bid) => bid.auctionId === auction?.id)
    .sort((a, b) => a.at.localeCompare(b.at));
  const participants = [...new Set(history.map((bid) => bid.bidder))];
  const winningBid = [...history].sort((a, b) => b.amountCents - a.amountCents)[0];
  const winnerPseudonym = `Participante P-${String(winningBid ? participants.indexOf(winningBid.bidder) + 1 : 1).padStart(3, '0')}`;

  async function copyPublicLink() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success(
        'Link do comprovante copiado',
        'Este endereço pode ser aberto sem entrar na conta.',
      );
    } catch {
      setManualCopy(true);
      toast.info('Copie o link abaixo', 'Seu navegador não permitiu a cópia automática.');
    }
  }

  if (!auction) {
    return (
      <section className="space-y-8">
        <PageHeader title="Comprovante público" />
        <EmptyState
          title="Comprovante não encontrado"
          description="Confira se o endereço foi copiado por completo. O comprovante só fica disponível após um arremate concluído."
          action={
            <Link className={buttonVariants()} to="/auctions">
              Explorar leilões
            </Link>
          }
        />
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-4xl space-y-7">
      <div className="print:hidden">
        <PageHeader
          title="Comprovante de arremate"
          description="Um registro público da carta e do resultado, sem expor dados pessoais."
          action={
            canShowReceipt ? (
              <Button
                variant="outline"
                onClick={() => {
                  void copyPublicLink();
                }}
              >
                Copiar link público
              </Button>
            ) : undefined
          }
        />
      </div>

      {manualCopy && (
        <div className="print:hidden">
          <Field
            htmlFor="receipt-public-url"
            label="Link público do comprovante"
            hint="Selecione e copie este endereço."
          >
            <Input
              id="receipt-public-url"
              readOnly
              value={publicUrl}
              onFocus={(event) => event.target.select()}
            />
          </Field>
        </div>
      )}

      {!canShowReceipt ? (
        <div className="rounded-lg border border-border bg-card p-7 sm:p-10" role="status">
          <StatusBadge
            tone={
              integrity === 'tampered' || auction.settlement === 'failed' ? 'danger' : 'warning'
            }
          >
            Comprovante indisponível
          </StatusBadge>
          <h2 className="mt-5 font-display text-3xl font-semibold">
            {integrity === 'tampered'
              ? 'A integridade precisa ser resolvida.'
              : auction.settlement === 'failed'
                ? 'A liquidação não foi concluída.'
                : 'O resultado ainda não foi confirmado.'}
          </h2>
          <p className="mt-3 max-w-xl leading-relaxed text-muted-foreground">
            {integrity === 'tampered'
              ? 'Foi detectada uma divergência no histórico ilustrativo. Este estado bloqueia a emissão do comprovante.'
              : auction.settlement === 'failed'
                ? 'Não há confirmação do arremate. O comprovante será disponibilizado somente quando a liquidação e a verificação estiverem concluídas.'
                : 'O encerramento do relógio não confirma um arremate. Aguarde a liquidação e a verificação do histórico.'}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              className={buttonVariants({ variant: 'outline' })}
              to={`/auctions/${auction.id}/audit`}
            >
              Consultar auditoria
            </Link>
            <Link className={buttonVariants({ variant: 'ghost' })} to={`/auctions/${auction.id}`}>
              Voltar ao lote
            </Link>
          </div>
        </div>
      ) : (
        <article className="receipt-document overflow-hidden rounded-lg border border-border bg-card print:rounded-none print:border-0">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-6 sm:p-9">
            <div>
              <p className="font-display text-4xl font-semibold">HoloBid</p>
              <h2 className="mt-3 text-lg font-semibold">Comprovante de arremate</h2>
              <p className="mt-1 text-sm text-muted-foreground">Registro público de demonstração</p>
            </div>
            <StatusBadge tone="success">Arremate simulado concluído</StatusBadge>
          </header>
          <div className="space-y-8 p-6 sm:p-9">
            <div className="flex items-center gap-6 border-b border-border pb-8 sm:gap-8">
              <CardArtwork
                src={auction.card.image}
                alt={`${auction.card.name}, ${auction.card.edition}`}
                className="h-40 min-h-0 w-28 shrink-0 p-0 sm:h-48 sm:w-32"
              />
              <div className="min-w-0">
                <h3 className="font-display text-3xl font-semibold sm:text-4xl">
                  {auction.card.name}
                </h3>
                <p className="mt-2 text-muted-foreground">{auction.card.edition}</p>
                <p className="mt-2 text-sm text-muted-foreground">Carta {auction.card.number}</p>
                <p className="mt-2 text-sm">{auction.card.rarity}</p>
              </div>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Valor do arremate</p>
              <p className="mt-2 font-display text-4xl font-semibold sm:text-5xl">
                <Money cents={auction.currentBidCents} />
              </p>
            </div>
            <dl className="grid gap-x-8 gap-y-6 border-y border-border py-7 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-muted-foreground">Arrematante</dt>
                <dd className="mt-1 font-semibold">{winnerPseudonym}</dd>
                <dd className="mt-1 text-xs text-muted-foreground">
                  Identificador público, sem vínculo com identidade civil
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Encerramento do lote</dt>
                <dd className="mt-1 font-semibold">{formatDate(auction.endsAt)}</dd>
                <dd className="mt-1 text-xs text-muted-foreground">Horário de São Paulo</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Lote</dt>
                <dd className="mt-1 break-all text-sm">{auction.id}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Código público do comprovante</dt>
                <dd className="mt-1 break-all text-sm">{receiptId}</dd>
              </div>
            </dl>
            <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
              <p>
                Este registro demonstra um arremate na HoloBid. Os valores são simulados; não
                representa pagamento real, nota fiscal ou promessa de entrega física.
              </p>
              <p>
                A auditoria apresenta a sequência de lances com pseudônimos. Nesta versão visual, o
                resultado é ilustrativo e não há verificação criptográfica real.
              </p>
            </div>
          </div>
          <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-border bg-muted px-6 py-5 sm:px-9 print:bg-transparent">
            <p className="text-sm text-muted-foreground">Documento acessível sem autenticação</p>
            <Link
              className="inline-flex min-h-11 items-center text-sm font-semibold text-info underline-offset-4 hover:underline print:hidden"
              to={`/auctions/${auction.id}/audit`}
            >
              Conferir auditoria pública
            </Link>
          </footer>
        </article>
      )}

      {canShowReceipt && (
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link className={buttonVariants({ variant: 'ghost' })} to={`/auctions/${auction.id}`}>
            Voltar ao lote
          </Link>
          <Button variant="outline" onClick={() => window.print()}>
            Imprimir comprovante
          </Button>
        </div>
      )}

      <details className="border-t border-border pt-5 text-sm text-muted-foreground print:hidden">
        <summary className="w-fit cursor-pointer py-2">Estados da demonstração</summary>
        <div className="mt-3 max-w-sm">
          <Field htmlFor="receipt-demo-state" label="Prévia de disponibilidade">
            <NativeSelect
              id="receipt-demo-state"
              value={previewState}
              onChange={(event) =>
                setPreview({ id: receiptId, state: event.target.value as PreviewState })
              }
            >
              <option value="original">Estado original do lote</option>
              <option value="pending">Simular verificação pendente</option>
              <option value="tampered">Simular adulteração</option>
            </NativeSelect>
          </Field>
        </div>
        <p className="mt-3">
          A prévia só demonstra bloqueios. Ela não libera documentos de lotes ainda pendentes.
        </p>
      </details>
    </section>
  );
}
