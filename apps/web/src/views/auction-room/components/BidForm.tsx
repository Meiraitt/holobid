import type { FormEvent } from 'react';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { Button, buttonVariants } from '../../../components/ui/button';
import { Field, Input } from '../../../components/ui/input';
import { toast } from '../../../components/ui/toast';
import { useDemo } from '../../../demo/demo-provider';
import type { DemoAuction } from '../../../demo/types';
import { formatMoney, parseMoney } from '../../../lib/format';

export function BidForm({
  auction,
  updatesPaused,
}: {
  auction: DemoAuction;
  updatesPaused: boolean;
}) {
  const { user, availableCents, placeBid } = useDemo();
  const minimumCents =
    auction.bidCount > 0
      ? auction.currentBidCents + auction.incrementCents
      : auction.startingBidCents;
  const [amount, setAmount] = useState(() => (minimumCents / 100).toFixed(2).replace('.', ','));
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const parsedAmount = parseMoney(amount);
  const leading = auction.participation === 'leading';
  const canAffordMinimum = availableCents >= minimumCents;

  function rejectBid(message: string) {
    setError(message);
    toast.error('Lance não registrado', message);
    inputRef.current?.focus();
  }

  function submitBid(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (parsedAmount === null || parsedAmount <= 0) {
      rejectBid('Informe um valor em reais, como 400,00.');

      return;
    }

    if (parsedAmount < minimumCents) {
      rejectBid(`O próximo lance deve ser de pelo menos ${formatMoney(minimumCents)}.`);

      return;
    }

    if (parsedAmount > availableCents) {
      rejectBid(
        `Seu saldo disponível é ${formatMoney(availableCents)}. Adicione saldo simulado para continuar.`,
      );

      return;
    }

    try {
      placeBid(auction.id, parsedAmount);
      setError('');
      toast.success(
        'Lance registrado na demonstração',
        `${formatMoney(parsedAmount)} reservados. Acompanhe sua posição nesta sala.`,
      );
    } catch (caught) {
      rejectBid(
        caught instanceof Error
          ? caught.message
          : 'Não foi possível registrar o lance. Tente novamente.',
      );
    }
  }

  if (!user) {
    return (
      <div className="space-y-3">
        <p className="text-muted-foreground">Entre na sua conta para participar deste leilão.</p>
        <Link
          to={`/login?returnTo=${encodeURIComponent(`/auctions/${auction.id}`)}`}
          className={buttonVariants({ size: 'lg', className: 'w-full' })}
        >
          Entrar para dar lance
        </Link>
      </div>
    );
  }

  if (user.role === 'auctioneer') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {auction.mine
            ? 'Este lote foi publicado por você. Acompanhe os lances e o resultado por aqui.'
            : 'Para dar lances nesta demonstração, selecione a conta de licitante no cabeçalho.'}
        </p>
        <Link
          to="/my-auctions"
          className={buttonVariants({ variant: 'outline', className: 'w-full' })}
        >
          Gerenciar meus lotes
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submitBid} noValidate className="space-y-4">
      <Field label="Seu lance (R$)" htmlFor="bid-amount" error={error || undefined}>
        <Input
          ref={inputRef}
          id="bid-amount"
          name="bidAmount"
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'bid-amount-error' : 'bid-reservation-hint'}
          value={amount}
          disabled={leading || updatesPaused}
          onChange={(event) => {
            setAmount(event.target.value);
            setError('');
          }}
          className="h-13 text-xl tabular-nums"
        />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={leading || updatesPaused}
          className="-ml-3 text-info"
          onClick={() => {
            setAmount((minimumCents / 100).toFixed(2).replace('.', ','));
            setError('');
            inputRef.current?.focus();
          }}
        >
          Usar mínimo {formatMoney(minimumCents)}
        </Button>
        <p className="text-muted-foreground">Disponível {formatMoney(availableCents)}</p>
      </div>
      <Button
        type="submit"
        size="lg"
        className="h-auto min-h-12 w-full whitespace-normal py-3 text-center"
        disabled={leading || updatesPaused || !canAffordMinimum}
      >
        {leading
          ? 'Você já está na liderança'
          : updatesPaused
            ? 'Aguardando atualização'
            : !canAffordMinimum
              ? 'Saldo insuficiente'
              : parsedAmount !== null && parsedAmount > 0
                ? `Dar lance de ${formatMoney(parsedAmount)}`
                : 'Dar lance'}
      </Button>
      <p id="bid-reservation-hint" className="text-sm leading-relaxed text-muted-foreground">
        O valor fica reservado enquanto você lidera. Se for superado, ele volta ao saldo disponível.
      </p>
      {!canAffordMinimum && !leading && (
        <div className="space-y-2 border-l-2 border-warning pl-3">
          <p className="text-sm text-warning">
            Faltam {formatMoney(minimumCents - availableCents)} para cobrir o próximo lance.
          </p>
          <Link
            to="/wallet"
            className="inline-flex min-h-11 items-center font-semibold text-info underline-offset-4 hover:underline"
          >
            Adicionar saldo simulado
          </Link>
        </div>
      )}
    </form>
  );
}
