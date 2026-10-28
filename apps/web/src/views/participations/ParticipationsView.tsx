import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { EmptyState } from '../../components/shared/empty-state';
import { PageHeader } from '../../components/shared/page-header';
import { Button, buttonVariants } from '../../components/ui/button';
import { useAuth } from '../../providers/auth-provider';
import { errorMessage } from '../../services/api-error';

import { ParticipationRow } from './components/ParticipationRow';
import { type ParticipationFilter, participationOptions } from './participation-queries';

export function ParticipationsView() {
  const { user } = useAuth();
  const [filter, setFilter] = useState<ParticipationFilter>('active');
  const query = useInfiniteQuery(participationOptions(user!.id, filter));
  const items = [
    ...new Map(
      (query.data?.pages.flatMap((page) => page.items) ?? []).map((item) => [item.auctionId, item]),
    ).values(),
  ];

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
        className="flex flex-wrap gap-x-6 border-b"
        role="group"
        aria-label="Filtrar participações"
      >
        {(
          [
            ['active', 'Em disputa'],
            ['all', 'Histórico'],
            ['won', 'Arrematados'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={`inline-flex min-h-12 items-center border-b-2 px-1 pb-3 pt-2 font-semibold ${filter === value ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {query.isPending ? (
        <p role="status">Carregando suas participações…</p>
      ) : query.isError && !query.data ? (
        <EmptyState
          title="Participações indisponíveis"
          description={errorMessage(query.error)}
          action={<Button onClick={() => void query.refetch()}>Tentar novamente</Button>}
        />
      ) : items.length === 0 ? (
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
        <ul className="divide-y border-y" aria-label="Suas participações">
          {items.map((item) => (
            <ParticipationRow key={item.auctionId} item={item} />
          ))}
        </ul>
      )}
      {query.isError && query.data && (
        <div role="alert" className="space-y-3">
          <p>As participações podem estar desatualizadas. {errorMessage(query.error)}</p>
          <Button
            variant="outline"
            onClick={() =>
              void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())
            }
          >
            Atualizar participações
          </Button>
        </div>
      )}
      {query.hasNextPage && (
        <Button
          variant="outline"
          loading={query.isFetchingNextPage}
          disabled={query.isFetching && !query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Carregar mais participações
        </Button>
      )}
      {query.isFetching && !query.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          Atualizando participações…
        </p>
      )}
      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Um lance na liderança ainda não é um arremate. O resultado é confirmado após o encerramento,
        a verificação do histórico e a liquidação.
      </p>
    </section>
  );
}
