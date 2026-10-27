import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

import { EmptyState } from '../../components/shared/empty-state';
import { Money } from '../../components/shared/money';
import { PageHeader } from '../../components/shared/page-header';
import { Button, buttonVariants } from '../../components/ui/button';
import { Modal } from '../../components/ui/dialog';
import { Field, Input } from '../../components/ui/input';
import { toast } from '../../components/ui/toast';
import { useDemo } from '../../demo/demo-provider';
import { formatMoney, parseMoney } from '../../lib/format';

export function WalletView() {
  const { user, auctions, totalCents, reservedCents, availableCents, deposit } = useDemo();
  const [depositOpen, setDepositOpen] = useState(false);
  const [amount, setAmount] = useState('100,00');
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [lastDepositCents, setLastDepositCents] = useState<number | null>(null);
  const parsedAmount = parseMoney(amount);
  const reservedAuctions = auctions.filter((auction) => auction.participation === 'leading');

  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;

    return () => {
      isMounted.current = false;
    };
  }, []);

  function handleOpenChange(open: boolean) {
    if (submitting) {
      return;
    }

    setDepositOpen(open);
    setError(undefined);

    if (open) {
      setAmount('100,00');
    }
  }

  async function handleDeposit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitting) {
      return;
    }

    const cents = parseMoney(amount);

    if (cents === null || cents <= 0 || !Number.isSafeInteger(cents)) {
      setError('Informe um valor maior que zero, com até duas casas decimais. Exemplo: 100,50.');

      return;
    }

    setSubmitting(true);
    setError(undefined);

    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 400));

      if (!isMounted.current) {
        return;
      }

      deposit(cents);
      setLastDepositCents(cents);
      setDepositOpen(false);
      toast.success(
        'Saldo simulado adicionado',
        `${formatMoney(cents)} estão disponíveis para lances.`,
      );
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : 'Não foi possível adicionar o saldo. Tente novamente.';

      setError(message);
      toast.error('Saldo não adicionado', message);
    } finally {
      if (isMounted.current) {
        setSubmitting(false);
      }
    }
  }

  if (!user) {
    return (
      <section className="mx-auto max-w-4xl py-6">
        <PageHeader title="Carteira" description="Seu saldo e os valores reservados nos leilões." />
        <EmptyState
          title="Entre para ver sua carteira"
          description="Acompanhe seu saldo disponível e os valores comprometidos nos seus lances."
          action={
            <Link to="/login" className={buttonVariants()}>
              Entrar
            </Link>
          }
        />
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-5xl py-5 sm:py-8">
      <PageHeader
        title="Carteira"
        description="Seu saldo, sem perder de vista os lances."
        action={<Button onClick={() => handleOpenChange(true)}>Adicionar saldo simulado</Button>}
      />

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

          <div className="mt-9">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-2xl font-semibold sm:text-3xl">
                Valores comprometidos
              </h2>
              <Link
                to="/participations"
                className="text-sm underline underline-offset-4 hover:text-foreground"
              >
                Ver meus lances
              </Link>
            </div>

            {reservedAuctions.length > 0 ? (
              <ul className="mt-4 divide-y divide-border border-y border-border">
                {reservedAuctions.map((auction) => (
                  <li key={auction.id}>
                    <Link
                      to={`/auctions/${auction.id}`}
                      className="flex min-h-24 items-center gap-4 py-4 transition-colors hover:bg-muted/60"
                    >
                      <img
                        src={auction.card.image}
                        alt=""
                        className="h-16 w-12 shrink-0 object-contain"
                        loading="lazy"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{auction.card.name}</p>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          {auction.card.edition}
                        </p>
                        <p className="mt-1 text-sm text-success">Você está ganhando</p>
                      </div>
                      <Money
                        cents={auction.myBidCents ?? auction.currentBidCents}
                        className="shrink-0 text-right font-semibold"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-4 border-y border-border py-6">
                <p className="font-semibold">Nenhum valor comprometido</p>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                  Quando você liderar um leilão, a reserva desse lance aparecerá aqui.
                </p>
                <Link
                  to="/auctions"
                  className={buttonVariants({ variant: 'outline', size: 'sm', className: 'mt-4' })}
                >
                  Explorar leilões
                </Link>
              </div>
            )}
          </div>
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
                O valor reservado é debitado na conclusão do leilão. O resultado e o recibo ficam em
                Meus lances.
              </p>
            </div>
          </div>
          <p className="mt-6 border-t border-border pt-5 text-sm leading-relaxed text-muted-foreground">
            Nesta demonstração, todo saldo é fictício. Você não precisa de cartão, Pix ou dados
            bancários.
          </p>
        </aside>
      </div>

      <Modal
        open={depositOpen}
        onOpenChange={handleOpenChange}
        title="Adicionar saldo simulado"
        description="Nenhuma cobrança será feita. O valor fica disponível apenas nesta demonstração."
      >
        <form onSubmit={handleDeposit} className="space-y-5" noValidate aria-busy={submitting}>
          <Field
            htmlFor="deposit-amount"
            label="Valor (R$)"
            hint="Use até duas casas decimais, como 100,50."
            error={error}
          >
            <Input
              id="deposit-amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                setError(undefined);
              }}
              disabled={submitting}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'deposit-amount-error' : 'deposit-amount-hint'}
              className="h-12 text-xl tabular-nums"
              required
            />
          </Field>
          <p className="text-sm text-muted-foreground">
            O saldo simulado será reiniciado ao recarregar a página.
          </p>
          <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              Voltar
            </Button>
            <Button type="submit" loading={submitting}>
              {submitting
                ? 'Adicionando…'
                : parsedAmount !== null && parsedAmount > 0
                  ? `Adicionar ${formatMoney(parsedAmount)}`
                  : 'Adicionar saldo'}
            </Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
