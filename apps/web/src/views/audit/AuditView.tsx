import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { EmptyState } from '../../components/shared/empty-state';
import { Money } from '../../components/shared/money';
import { PageHeader } from '../../components/shared/page-header';
import { StatusBadge } from '../../components/shared/status-badge';
import { Button, buttonVariants } from '../../components/ui/button';
import { Field, Input, NativeSelect } from '../../components/ui/input';
import { toast } from '../../components/ui/toast';
import { useDemo } from '../../demo/demo-provider';
import type { DemoAuction } from '../../demo/types';
import { formatDate } from '../../lib/format';

type Integrity = DemoAuction['integrity'];

const integrityContent = {
  verified: {
    title: 'Histórico verificado',
    description:
      'Prévia de um histórico cujos registros e fechamento foram validados. Nesta demonstração, o resultado e os hashes são ilustrativos.',
    tone: 'success' as const,
  },
  pending: {
    title: 'Verificação pendente',
    description:
      'Ainda não há uma confirmação completa da integridade. O comprovante permanece indisponível até a conclusão da verificação.',
    tone: 'warning' as const,
  },
  tampered: {
    title: 'Adulteração detectada',
    description:
      'Este exemplo representa uma divergência no encadeamento dos registros. O histórico não deve ser tratado como íntegro e o comprovante permanece bloqueado.',
    tone: 'danger' as const,
  },
};

function exampleHash(sequence: number) {
  return sequence.toString(16).padStart(8, '0').repeat(8);
}

export function AuditView() {
  const { auctionId = '' } = useParams();
  const { auctions, bids } = useDemo();
  const [override, setOverride] = useState<{ id: string; integrity: Integrity } | null>(null);
  const [pageState, setPageState] = useState({ id: auctionId, page: 1 });
  const [manualCopy, setManualCopy] = useState(false);
  const auction = auctions.find((item) => item.id === auctionId);
  const integrity =
    override?.id === auctionId ? override.integrity : (auction?.integrity ?? 'pending');
  const content = integrityContent[integrity];
  const history = bids
    .filter((bid) => bid.auctionId === auctionId)
    .sort((a, b) => a.at.localeCompare(b.at));
  const pseudonyms = [...new Set(history.map((bid) => bid.bidder))];
  const page = pageState.id === auctionId ? pageState.page : 1;
  const pageSize = 5;
  const totalPages = Math.max(1, Math.ceil(history.length / pageSize));
  const visibleBids = history.slice((page - 1) * pageSize, page * pageSize);
  const publicUrl = typeof window === 'undefined' ? '' : window.location.href;

  async function copyPublicLink() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success('Link da auditoria copiado');
    } catch {
      setManualCopy(true);
      toast.info('Copie o link abaixo', 'Seu navegador não permitiu a cópia automática.');
    }
  }

  if (!auction) {
    return (
      <section className="space-y-8">
        <PageHeader title="Auditoria pública" />
        <EmptyState
          title="Lote não encontrado"
          description="Confira o endereço da auditoria ou escolha um lote disponível."
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
    <section className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        title="Auditoria pública"
        description={`Auditoria pública de ${auction.card.name}. Acesso livre, sem precisar entrar.`}
        action={
          <Button
            variant="outline"
            onClick={() => {
              void copyPublicLink();
            }}
          >
            Copiar link público
          </Button>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-5">
        <Link
          className="inline-flex min-h-11 items-center text-info underline-offset-4 hover:underline"
          to={`/auctions/${auction.id}`}
        >
          Ver {auction.card.name}
        </Link>
        <span className="break-all text-sm text-muted-foreground">Lote {auction.id}</span>
      </div>
      {manualCopy && (
        <Field
          htmlFor="audit-public-url"
          label="Link público da auditoria"
          hint="Selecione e copie este endereço."
        >
          <Input
            id="audit-public-url"
            readOnly
            value={publicUrl}
            onFocus={(event) => event.target.select()}
          />
        </Field>
      )}

      <div
        className={`border-l-4 bg-card p-6 sm:p-8 ${integrity === 'tampered' ? 'border-destructive' : integrity === 'pending' ? 'border-warning' : 'border-success'}`}
        role="status"
      >
        <StatusBadge tone={content.tone}>{content.title}</StatusBadge>
        <h2 className="mt-4 font-display text-3xl font-semibold">
          {integrity === 'verified'
            ? 'O histórico pode ser conferido.'
            : integrity === 'pending'
              ? 'Ainda precisamos de uma confirmação.'
              : 'Há uma divergência neste histórico.'}
        </h2>
        <p className="mt-3 max-w-2xl leading-relaxed text-muted-foreground">
          {content.description}
        </p>
        {integrity !== 'verified' && (
          <p className="mt-3 text-sm font-semibold">
            Não há comprovante liberado para este estado.
          </p>
        )}
      </div>

      {auction.status === 'cancelled' && (
        <p className="rounded-md border border-border p-4 text-muted-foreground">
          Este lote foi cancelado. Seu histórico público foi preservado.
        </p>
      )}

      <dl className="grid gap-5 border-y border-border py-6 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-muted-foreground">Carta e coleção</dt>
          <dd className="mt-1 font-semibold">{auction.card.name}</dd>
          <dd className="text-sm text-muted-foreground">
            {auction.card.edition} / {auction.card.number}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Registros de lance nesta prévia</dt>
          <dd className="mt-1 font-display text-3xl font-semibold">{history.length}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">
            {auction.status === 'ended' ? 'Encerramento' : 'Encerramento previsto'}
          </dt>
          <dd className="mt-2 font-semibold">{formatDate(auction.endsAt)}</dd>
        </div>
      </dl>

      <section aria-labelledby="audit-history-heading" className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="audit-history-heading" className="font-display text-3xl font-semibold">
              Sequência de lances
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Participantes são identificados por pseudônimos. Nenhum dado pessoal é exibido.
            </p>
          </div>
          <span className="text-xs text-muted-foreground">Do mais antigo ao mais recente</span>
        </div>
        {history.length === 0 ? (
          <EmptyState
            title="Nenhum lance registrado"
            description="O registro do lote existe, mas ainda não há lances para exibir nesta prévia."
          />
        ) : (
          <ol
            start={(page - 1) * pageSize + 1}
            className="divide-y divide-border rounded-lg border border-border bg-card"
          >
            {visibleBids.map((bid, index) => {
              const sequence = (page - 1) * pageSize + index + 1;
              const participant = `Participante P-${String(pseudonyms.indexOf(bid.bidder) + 1).padStart(3, '0')}`;

              return (
                <li key={bid.id} className="p-5 sm:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h3 className="font-semibold">
                        <span className="mr-3 text-muted-foreground">
                          {String(sequence).padStart(2, '0')}
                        </span>
                        Lance registrado
                      </h3>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {participant} / {formatDate(bid.at)}
                      </p>
                    </div>
                    <Money className="text-xl font-semibold" cents={bid.amountCents} />
                  </div>
                  <details className="mt-3 text-sm">
                    <summary className="w-fit cursor-pointer py-2 text-info">
                      Ver encadeamento ilustrativo
                    </summary>
                    <dl className="mt-3 space-y-3 rounded-md bg-muted p-4">
                      <div>
                        <dt className="text-muted-foreground">Hash anterior (exemplo)</dt>
                        <dd className="mt-1 break-all font-mono text-xs leading-relaxed">
                          {exampleHash(sequence - 1)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Hash deste registro (exemplo)</dt>
                        <dd className="mt-1 break-all font-mono text-xs leading-relaxed">
                          {exampleHash(sequence)}
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-3 text-xs text-muted-foreground">
                      Exemplos visuais, sem cálculo ou verificação criptográfica neste frontend de
                      demonstração.
                    </p>
                  </details>
                </li>
              );
            })}
          </ol>
        )}
        {totalPages > 1 && (
          <nav
            className="flex flex-wrap items-center justify-between gap-3"
            aria-label="Páginas do histórico"
          >
            <Button
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPageState({ id: auctionId, page: page - 1 })}
            >
              Anterior
            </Button>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              Página {page} de {totalPages}
            </p>
            <Button
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPageState({ id: auctionId, page: page + 1 })}
            >
              Próxima
            </Button>
          </nav>
        )}
      </section>

      <details className="border-t border-border pt-5 text-sm text-muted-foreground">
        <summary className="w-fit cursor-pointer py-2">Estados da demonstração</summary>
        <div className="mt-3 max-w-sm">
          <Field htmlFor="audit-demo-integrity" label="Resultado ilustrativo da verificação">
            <NativeSelect
              id="audit-demo-integrity"
              value={integrity}
              onChange={(event) =>
                setOverride({ id: auctionId, integrity: event.target.value as Integrity })
              }
            >
              <option value="verified">Histórico verificado</option>
              <option value="pending">Verificação pendente</option>
              <option value="tampered">Adulteração detectada</option>
            </NativeSelect>
          </Field>
        </div>
        <p className="mt-3 max-w-2xl">
          Este controle altera apenas a apresentação desta tela. A integração futura exibirá o
          resultado confirmado pela API, sem inferir integridade a partir das linhas carregadas.
        </p>
      </details>
    </section>
  );
}
