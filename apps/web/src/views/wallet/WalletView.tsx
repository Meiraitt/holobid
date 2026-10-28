import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { EmptyState } from '../../components/shared/empty-state';
import { WalletSkeleton } from '../../components/shared/loading-skeletons';
import { Money } from '../../components/shared/money';
import { PageHeader } from '../../components/shared/page-header';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { useAuth } from '../../providers/auth-provider';
import { errorMessage } from '../../services/api-error';

import { DepositDialog } from './DepositDialog';
import { Reservations } from './Reservations';
import { useDeposit } from './use-deposit';
import { walletOptions } from './wallet-queries';

export function WalletView() {
  const { user } = useAuth();
  const query = useQuery(walletOptions(user!.id));
  const deposit = useDeposit(user!.id);
  const [depositOpen, setDepositOpen] = useState(() => Boolean(deposit.attempt?.operation));
  const lastDepositCents = deposit.lastDeposit;
  const wallet = query.data;

  function handleOpenChange(open: boolean) {
    setDepositOpen(open);
    deposit.clearError();
  }

  if (!wallet) {
    return (
      <section className="mx-auto max-w-5xl py-5 sm:py-8">
        <PageHeader
          title="Carteira"
          description="Seu saldo, sem perder de vista os lances."
          action={query.isPending ? <Skeleton className="h-11 w-52 shrink-0" /> : undefined}
        />
        {query.isPending ? (
          <WalletSkeleton />
        ) : (
          <EmptyState
            title="Carteira indisponível"
            description={errorMessage(query.error)}
            action={<Button onClick={() => void query.refetch()}>Tentar novamente</Button>}
          />
        )}
      </section>
    );
  }

  const { totalCents, reservedCents, availableCents } = wallet;

  return (
    <section className="mx-auto max-w-5xl py-5 sm:py-8">
      <PageHeader
        title="Carteira"
        description="Seu saldo, sem perder de vista os lances."
        action={
          <Button disabled={!deposit.attempt} onClick={() => handleOpenChange(true)}>
            {deposit.attempt?.operation
              ? 'Consultar depósito pendente'
              : 'Adicionar saldo simulado'}
          </Button>
        }
      />

      {!deposit.attempt && (
        <p role="alert" className="mt-5 text-destructive">
          Não foi possível recuperar depósitos desta aba. Recarregue e confira o saldo antes de
          tentar novamente.
        </p>
      )}
      {query.isError && (
        <div role="alert" className="mt-5 space-y-3 border-l-2 border-warning p-4">
          <p>O saldo exibido pode estar desatualizado. {errorMessage(query.error)}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Atualizar carteira
          </Button>
        </div>
      )}
      {deposit.attempt?.operation && !depositOpen && (
        <p role="status" className="mt-5 text-warning">
          Há um depósito aguardando confirmação nesta aba. Use “Consultar depósito pendente” para
          recuperar a mesma solicitação.
        </p>
      )}
      <div className="mt-8 grid gap-8 lg:grid-cols-[1.7fr_1fr] lg:gap-12">
        <div>
          <div className="border-y border-border py-7 sm:py-9" aria-label="Resumo do saldo">
            <p className="text-base text-muted-foreground">Disponível para lances</p>
            <Money
              cents={availableCents}
              className="mt-2 block font-display text-5xl font-semibold leading-tight sm:text-6xl"
            />

            <dl className="mt-7 grid grid-cols-2 gap-5 border-t border-border pt-5">
              <div>
                <dt className="text-sm text-muted-foreground">Saldo total</dt>
                <dd className="mt-1 text-xl font-semibold">
                  <Money cents={totalCents} />
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Comprometido em lances</dt>
                <dd className="mt-1 text-xl font-semibold">
                  <Money cents={reservedCents} />
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              O saldo disponível é o total menos o valor comprometido.
            </p>
          </div>

          {lastDepositCents !== null && (
            <div
              role="status"
              className="mt-5 border-l-2 border-success bg-success/10 px-4 py-3 text-sm leading-relaxed"
            >
              <p className="font-semibold text-success">Saldo simulado adicionado</p>
              <p className="mt-1">
                <Money cents={lastDepositCents} /> foram adicionados à sua carteira. Nenhuma
                cobrança foi feita.
              </p>
            </div>
          )}

          {availableCents === 0 && (
            <div className="mt-5 border-l-2 border-warning bg-warning/10 px-4 py-3 text-sm leading-relaxed">
              <p className="font-semibold text-warning">Sem saldo disponível para um novo lance</p>
              <p className="mt-1 text-muted-foreground">
                Você pode adicionar saldo simulado. Se um lance seu for superado, a reserva será
                liberada.
              </p>
            </div>
          )}

          <Reservations userId={user!.id} />
        </div>

        <aside className="self-start bg-muted px-5 py-6 sm:px-6" aria-labelledby="wallet-how-title">
          <h2 id="wallet-how-title" className="font-display text-2xl font-semibold">
            Seu lance tem uma reserva.
          </h2>
          <div className="mt-5 space-y-5 text-sm leading-relaxed">
            <div>
              <h3 className="font-semibold">Enquanto você lidera</h3>
              <p className="mt-1 text-muted-foreground">
                O valor do seu lance fica comprometido e deixa de estar disponível para outros
                lotes.
              </p>
            </div>
            <div>
              <h3 className="font-semibold">Se alguém superar seu lance</h3>
              <p className="mt-1 text-muted-foreground">
                A reserva é liberada e o valor volta ao seu saldo disponível.
              </p>
            </div>
            <div>
              <h3 className="font-semibold">Se você arrematar</h3>
              <p className="mt-1 text-muted-foreground">
                O valor reservado é debitado na conclusão do leilão. O total e o valor reservado são
                atualizados após a liquidação.
              </p>
            </div>
          </div>
          <p className="mt-6 border-t border-border pt-5 text-sm leading-relaxed text-muted-foreground">
            Nesta demonstração, todo saldo é fictício. Você não precisa de cartão, Pix ou dados
            bancários.
          </p>
        </aside>
      </div>

      <DepositDialog open={depositOpen} onOpenChange={handleOpenChange} deposit={deposit} />
    </section>
  );
}
