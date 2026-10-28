import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { EmptyState } from '../../components/shared/empty-state';
import { AuditSkeleton } from '../../components/shared/loading-skeletons';
import { Money } from '../../components/shared/money';
import { PageHeader } from '../../components/shared/page-header';
import { PublicLink } from '../../components/shared/public-link';
import { Button, buttonVariants } from '../../components/ui/button';
import { formatDate } from '../../lib/format';
import { useRealtimeRoom } from '../../providers/realtime-provider';
import { ApiRequestError, errorMessage } from '../../services/api-error';
import { auctionDetailOptions } from '../auctions/auction-queries';

import { auditJsonUrl, auditOptions } from './audit-queries';
import { VerificationSummary } from './VerificationSummary';

const statusLabel = {
  LIVE: 'Ao vivo',
  SCHEDULED: 'Agendado',
  ENDED: 'Encerrado',
  CANCELLED: 'Cancelado',
};

export function AuditView() {
  const { auctionId = '' } = useParams();

  return <Audit key={auctionId} id={auctionId} />;
}

function Audit({ id }: { id: string }) {
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const cursor = cursors.at(-1);
  const query = useQuery(auditOptions(id, cursor));
  const lot = useQuery(auctionDetailOptions(id));
  const report = query.data;
  const realtime = useRealtimeRoom(id);
  const invalidPage =
    query.error instanceof ApiRequestError && query.error.status === 400 && cursor !== undefined;
  const missing =
    query.error instanceof ApiRequestError &&
    (query.error.status === 404 || (query.error.status === 400 && !invalidPage));

  // The HTTP report remains readable even when a cancelled/missing lot cannot join a socket room.
  return (
    <section className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        title="Auditoria pública"
        description={
          lot.data
            ? `Verificação do histórico de ${lot.data.title}. Acesso livre, sem precisar entrar.`
            : 'Verificação do histórico pelo servidor. Acesso livre, sem precisar entrar.'
        }
        action={<PublicLink path={`/auctions/${encodeURIComponent(id)}/audit`} />}
      />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-5">
        <Link
          className="inline-flex min-h-11 items-center text-info hover:underline"
          to={`/auctions/${id}`}
        >
          {lot.data ? `Ver ${lot.data.title}` : 'Ver lote'}
        </Link>
        <span className="break-all text-sm text-muted-foreground">Lote {id}</span>
      </div>
      {query.isPending ? (
        <AuditSkeleton />
      ) : invalidPage || missing || !report ? (
        <EmptyState
          title={
            invalidPage
              ? 'Página indisponível'
              : missing
                ? 'Lote não encontrado'
                : 'Auditoria indisponível'
          }
          description={
            invalidPage
              ? 'Volte aos últimos lances para atualizar a paginação.'
              : missing
                ? 'Confira o endereço da auditoria ou escolha um lote disponível.'
                : errorMessage(query.error)
          }
          action={
            <>
              <Button
                onClick={() => {
                  if (invalidPage) {
                    setCursors([undefined]);
                  } else {
                    void query.refetch();
                  }
                }}
              >
                {invalidPage ? 'Voltar aos últimos lances' : 'Tentar novamente'}
              </Button>
              <Link className={buttonVariants({ variant: 'ghost' })} to="/auctions">
                Explorar leilões
              </Link>
            </>
          }
        />
      ) : (
        <>
          <VerificationSummary
            report={report}
            refreshing={query.isFetching}
            unavailable={query.isError}
          />
          {query.isError && (
            <p role="alert" className="text-destructive">
              Não foi possível atualizar a verificação. {errorMessage(query.error)}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              loading={query.isFetching}
              onClick={() => void query.refetch()}
            >
              Verificar novamente
            </Button>
            <a
              className={buttonVariants({ variant: 'ghost' })}
              href={auditJsonUrl(id, cursor)}
              target="_blank"
              rel="noreferrer"
            >
              Abrir JSON da auditoria
            </a>
          </div>
          {!realtime.ready && (
            <p className="text-sm text-muted-foreground">
              Atualização em tempo real indisponível ou sincronizando. A consulta HTTP continua
              disponível.
            </p>
          )}
          {report.status === 'CANCELLED' && (
            <p className="rounded-md border p-4 text-muted-foreground">
              Este lote foi cancelado. Seu histórico público foi preservado.
            </p>
          )}
          <dl className="grid gap-5 border-y py-6 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-muted-foreground">Situação do lote</dt>
              <dd className="mt-1 font-semibold">
                {report.status === null ? 'Indisponível' : statusLabel[report.status]}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Registros nesta página</dt>
              <dd className="mt-1 font-display text-3xl font-semibold">{report.items.length}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Histórico completo</dt>
              <dd className="mt-2 text-sm">
                A verificação considera todos os registros, independentemente desta página.
              </dd>
            </div>
          </dl>
          <section aria-labelledby="audit-history-heading" className="space-y-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="audit-history-heading" className="font-display text-3xl font-semibold">
                  Sequência de lances
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Os pseudônimos públicos são específicos deste lote.
                </p>
              </div>
              <span className="text-xs text-muted-foreground">Do mais recente ao mais antigo</span>
            </div>
            {report.items.length === 0 ? (
              <EmptyState
                title={
                  report.actualCount === 0 ? 'Nenhum lance registrado' : 'Nenhum lance nesta página'
                }
                description="A ausência de lances nesta página não determina o resultado da verificação."
              />
            ) : (
              <ol
                className="divide-y rounded-lg border bg-card"
                aria-label="Histórico público de lances"
              >
                {report.items.map((bid) => (
                  <li key={bid.id} className="p-5 sm:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h3 className="font-semibold">
                          <span className="mr-3 text-muted-foreground">#{bid.sequence}</span>Lance
                          registrado
                        </h3>
                        <p className="mt-2 break-all text-sm text-muted-foreground">
                          {bid.bidderPseudonym} / {formatDate(bid.acceptedAt)}
                        </p>
                      </div>
                      <Money className="text-xl font-semibold" cents={bid.amountCents} />
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {(cursors.length > 1 || report.nextCursor) && (
              <nav
                className="flex flex-wrap items-center justify-between gap-3"
                aria-label="Páginas do histórico"
              >
                <Button
                  variant="outline"
                  disabled={cursors.length === 1 || query.isFetching}
                  onClick={() => setCursors((previous) => previous.slice(0, -1))}
                >
                  Mais recentes
                </Button>
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  Página {cursors.length}
                </p>
                <Button
                  variant="outline"
                  disabled={!report.nextCursor || query.isFetching}
                  onClick={() => {
                    if (report.nextCursor) {
                      setCursors((previous) => [...previous, report.nextCursor!]);
                    }
                  }}
                >
                  Mais antigos
                </Button>
              </nav>
            )}
            {cursors.length > 1 && (
              <Button
                variant="ghost"
                disabled={query.isFetching}
                onClick={() => setCursors([undefined])}
              >
                Voltar aos últimos lances
              </Button>
            )}
          </section>
        </>
      )}
    </section>
  );
}
