import { useState } from 'react';

import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/dialog';
import { Field, Input } from '../../components/ui/input';
import { formatMoney } from '../../lib/format';

import { depositAmount } from './deposit-attempt';
import type { useDeposit } from './use-deposit';

export function DepositDialog({
  open,
  onOpenChange,
  deposit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deposit: ReturnType<typeof useDeposit>;
}) {
  const [amount, setAmount] = useState('100,00');
  const pending = deposit.attempt?.operation;
  const cents = depositAmount(amount);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      closeDisabled={deposit.busy}
      title={
        deposit.busy
          ? 'Confirmando depósito'
          : pending
            ? 'Consultar depósito pendente'
            : 'Adicionar saldo simulado'
      }
      description="Nenhuma cobrança será feita. O saldo é fictício e fica salvo na sua conta."
    >
      <form
        noValidate
        aria-busy={deposit.busy}
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void deposit.submit(amount).then((confirmed) => {
            if (confirmed) {
              onOpenChange(false);
            }
          });
        }}
      >
        {pending ? (
          <div role="status" className="space-y-2 border-l-2 border-warning pl-3">
            <p className="font-semibold">
              {formatMoney(pending.input.amountCents)} aguardando confirmação
            </p>
            <p className="text-sm">
              {deposit.busy
                ? 'Aguarde a confirmação da solicitação.'
                : 'A resposta anterior não foi confirmada. Consulte a mesma solicitação para recuperar o resultado sem adicionar saldo duas vezes.'}
            </p>
          </div>
        ) : (
          <Field
            htmlFor="deposit-amount"
            label="Valor (R$)"
            hint="Use até duas casas decimais, como 100,50."
            error={deposit.error || undefined}
          >
            <Input
              id="deposit-amount"
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                deposit.clearError();
              }}
              disabled={deposit.busy}
              aria-invalid={Boolean(deposit.error)}
              aria-describedby={deposit.error ? 'deposit-amount-error' : 'deposit-amount-hint'}
              className="h-12 text-xl tabular-nums"
              required
            />
          </Field>
        )}
        {pending && deposit.error && (
          <p role="alert" className="text-sm text-destructive">
            {deposit.error}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          Os depósitos confirmados permanecem disponíveis após recarregar a página.
        </p>
        <div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={deposit.busy}
            onClick={() => onOpenChange(false)}
          >
            Voltar
          </Button>
          <Button type="submit" loading={deposit.busy} disabled={!deposit.attempt}>
            {pending
              ? 'Consultar depósito'
              : cents === null
                ? 'Adicionar saldo'
                : `Adicionar ${formatMoney(cents)}`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
