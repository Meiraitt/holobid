import { useState } from 'react';
import { Link } from 'react-router';

import { CardArtwork } from '../../components/shared/card-artwork';
import { EmptyState } from '../../components/shared/empty-state';
import { Money } from '../../components/shared/money';
import { PageHeader } from '../../components/shared/page-header';
import { StatusBadge } from '../../components/shared/status-badge';
import { buttonVariants } from '../../components/ui/button';
import { useDemo } from '../../demo/demo-provider';
import type { DemoAuction, ParticipationStatus } from '../../demo/types';
import { formatDate } from '../../lib/format';

type ParticipationFilter = 'active' | 'all' | 'won';

const labels: Record<ParticipationStatus, string> = {
  leading: 'Você está ganhando',
  outbid: 'Você foi superado',
  won: 'Arrematado',
  lost: 'Encerrado sem arremate',
  pending: 'Resultado pendente',
};

function participationTone(status: ParticipationStatus) {
  if (status === 'leading' || status === 'won') {
    return 'success' as const;
  }

  return status === 'outbid' || status === 'pending' ? ('warning' as const) : ('neutral' as const);
}

function ParticipationOutcome({ auction }: { auction: DemoAuction }) {
  if (auction.settlement === 'failed') {
    return (
      <p className="text-sm text-destructive">
        Falha na liquidação. O arremate ainda não foi confirmado.
      </p>
    );
  }

  if (auction.participation === 'leading') {
    return (
      <p className="text-sm text-muted-foreground">
        Seu lance está reservado até o resultado ou até você ser superado.
      </p>
    );
  }

  if (auction.participation === 'outbid') {
    return (
      <p className="text-sm text-muted-foreground">Sua reserva foi liberada. A disputa continua.</p>
    );
  }

  if (auction.participation === 'pending' || auction.integrity !== 'verified') {
    return (
      <p className="text-sm text-warning">
        Aguarde a verificação antes de considerar o resultado concluído.
      </p>
    );
  }

  return (
    <p className="text-sm text-muted-foreground">
      {auction.participation === 'won'
        ? 'Arremate concluído. Seu comprovante público está disponível.'
        : 'Outro participante arrematou esta carta.'}
    </p>
  );
}

export function ParticipationsView() {
  const { auctions, user } = useDemo();
  const [filter, setFilter] = useState<ParticipationFilter>('active');
  const participations = auctions.filter((auction) => Boolean(auction.participation));
  const wins = participations.filter(
    (auction) =>
      auction.participation === 'won' &&
      auction.settlement === 'settled' &&
      auction.integrity === 'verified',
  );
  const visible = participations.filter(
    (auction) =>
      filter === 'all' || (filter === 'won' ? wins.includes(auction) : auction.status === 'live'),
  );
  const activeCount = participations.filter((auction) => auction.status === 'live').length;

  if (user?.role !== 'bidder') {
    return (
      <section className="space-y-8">
        <PageHeader
          title="Minhas participações"
          description="Seus lances, disputas e cartas arrematadas."
        />
        <EmptyState
          title={user ? 'Área do licitante' : 'Entre para acompanhar seus lances'}
          description="Entre com uma conta de licitante para acompanhar suas participações."
          action={
            <Link to="/login" className="text-link">
              Entrar na minha conta
            </Link>
          }
        />
      </section>
    );
  }

  return (
    <section className="space-y-8">
      <PageHeader
        title="Minhas participações"
        description="Acompanhe a disputa. Guarde a história de cada arremate."
        action={
          <Link className={buttonVariants({ variant: 'outline' })} to="/wallet">
            Ver minha carteira
          </Link>
        }
      />

      <div
        className="flex flex-wrap gap-x-6 border-b border-border"
        role="group"
        aria-label="Filtrar participações"
      >
        {(
          [
            ['active', 'Em disputa', activeCount],
            ['all', 'Histórico', participations.length],
            ['won', 'Arrematados', wins.length],
          ] as const
        ).map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={`inline-flex min-h-12 items-center gap-2 border-b-2 px-1 pb-3 pt-2 font-semibold ${filter === value ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {label}
            <span className="text-sm font-normal">{count}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={
            filter === 'won'
              ? 'Sua próxima carta pode estar na vitrine'
              : 'Nenhuma participação por aqui'
          }
          description={
            filter === 'won'
              ? 'Seus arremates concluídos aparecerão nesta lista, junto dos comprovantes.'
              : 'Explore os leilões e dê seu primeiro lance para acompanhar a disputa aqui.'
          }
          action={
            <Link className={buttonVariants()} to="/auctions">
              Explorar leilões
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {visible.map((auction) => {
            const participation =
              auction.participation === 'won' &&
              (auction.settlement !== 'settled' || auction.integrity !== 'verified')
                ? 'pending'
                : (auction.participation ?? 'pending');
            const completed =
              participation === 'won' &&
              auction.settlement === 'settled' &&
              auction.integrity === 'verified';

            return (
              <li
                key={auction.id}
                className="grid gap-6 py-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] lg:items-center"
              >
                <div className="flex min-w-0 items-center gap-5">
                  <CardArtwork
                    src={auction.card.image}
                    alt={`${auction.card.name}, ${auction.card.edition}`}
                    className="h-32 min-h-0 w-24 shrink-0 p-0"
                  />
                  <div className="min-w-0">
                    <StatusBadge
                      tone={
                        auction.settlement === 'failed'
                          ? 'danger'
                          : participationTone(participation)
                      }
                    >
                      {auction.settlement === 'failed'
                        ? 'Liquidação não concluída'
                        : labels[participation]}
                    </StatusBadge>
                    <h2 className="mt-3 font-display text-2xl font-semibold">
                      <Link className="hover:underline" to={`/auctions/${auction.id}`}>
                        {auction.card.name}
                      </Link>
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {auction.card.edition} / {auction.card.number}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {auction.status === 'ended' ? 'Encerrado em' : 'Encerra em'}{' '}
                      {formatDate(auction.endsAt)}
                    </p>
                  </div>
                </div>
                <div className="space-y-4">
                  <dl className="grid grid-cols-2 gap-5">
                    <div>
                      <dt className="text-sm text-muted-foreground">Seu maior lance</dt>
                      <dd className="mt-1 text-lg font-semibold">
                        {auction.myBidCents === undefined ? (
                          'Não disponível'
                        ) : (
                          <Money cents={auction.myBidCents} />
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">
                        {auction.status === 'ended' ? 'Lance final' : 'Lance atual'}
                      </dt>
                      <dd className="mt-1 text-lg font-semibold">
                        <Money cents={auction.currentBidCents} />
                      </dd>
                    </div>
                  </dl>
                  {auction.position !== undefined && auction.status === 'live' && (
                    <p className="text-sm">
                      Sua posição: <strong>{auction.position}º lugar</strong>
                    </p>
                  )}
                  <ParticipationOutcome auction={auction} />
                </div>
                <div className="flex flex-wrap gap-2 lg:max-w-44 lg:justify-end">
                  <Link
                    className={buttonVariants({ variant: 'outline' })}
                    to={`/auctions/${auction.id}`}
                  >
                    {auction.status === 'live' ? 'Acompanhar disputa' : 'Ver lote'}
                  </Link>
                  {completed && auction.receiptId && (
                    <Link className={buttonVariants()} to={`/receipts/${auction.receiptId}`}>
                      Ver comprovante
                    </Link>
                  )}
                  {auction.status === 'ended' && (
                    <Link
                      className="inline-flex min-h-11 items-center px-3 text-sm text-info underline-offset-4 hover:underline"
                      to={`/auctions/${auction.id}/audit`}
                    >
                      Auditoria pública
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Um lance na liderança ainda não é um arremate. O resultado é confirmado após o encerramento,
        a verificação do histórico e a liquidação.
      </p>
    </section>
  );
}
