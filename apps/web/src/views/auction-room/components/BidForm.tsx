import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

import type { AuctionDetail, MyAuctionState, WalletResponse } from '@holobid/contracts';

import { Button } from '../../../components/ui/button';
import { Field, Input } from '../../../components/ui/input';
import { toast } from '../../../components/ui/toast';
import { formatMoney } from '../../../lib/format';
import { api } from '../../../services';
import { errorMessage } from '../../../services/api-error';
import { bidAmount, bidAttempt } from '../bid-attempt';

export function BidForm({
  auction,
  userId,
  wallet,
  position,
  updatesPaused,
}: {
  auction: AuctionDetail;
  userId: string;
  wallet: WalletResponse;
  position: MyAuctionState;
  updatesPaused: boolean;
}) {
  const cache = useQueryClient();
  const minimum = auction.minimumNextBidCents;
  const [amount, setAmount] = useState(() => ((minimum ?? 0) / 100).toFixed(2).replace('.', ','));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const submitting = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [attempt] = useState(() => {
    try {
      return bidAttempt(api.auctions.bid, sessionStorage, userId, auction.id);
    } catch {
      return null;
    }
  });
  const pending = attempt?.operation;
  const amountCents = bidAmount(amount);
  const disabled =
    auction.status !== 'LIVE' ||
    updatesPaused ||
    !auction.canReceiveBids ||
    position.isLeading ||
    minimum === null;

  useEffect(() => {
    active.current = true;

    return () => {
      active.current = false;
    };
  }, []);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !attempt) {
      return;
    }

    if (!pending) {
      const message = disabled
        ? 'Aguarde os dados atualizados da sala.'
        : amountCents === null
          ? 'Informe um valor de R$ 0,01 a R$ 1.000.000.000,00, como 100,00.'
          : minimum !== null && amountCents < minimum
            ? `O próximo lance deve ser de pelo menos ${formatMoney(minimum)}.`
            : amountCents > wallet.availableCents
              ? `Seu saldo disponível é ${formatMoney(wallet.availableCents)}.`
              : '';

      if (message) {
        setError(message);
        toast.error('Lance não enviado', message);
        inputRef.current?.focus();

        return;
      }
    }

    submitting.current = true;
    setBusy(true);
    setError('');

    try {
      const result = await attempt.submit(pending ? undefined : { amountCents: amountCents! });

      if (!active.current) {
        return;
      }

      if (result.data.confirmation === 'CONFIRMED') {
        // A replay may describe an older bid. Refetch current balances/position instead of
        // replacing them with the historical response or claiming the bidder still leads.
        toast.success(
          'Lance registrado',
          `${formatMoney(result.data.bid.amountCents)}. Confira sua posição atualizada na sala.`,
        );
      } else {
        toast.info(
          'Lance aguardando confirmação',
          'Consulte novamente a mesma solicitação antes de enviar outro lance.',
        );
      }
    } catch (failure) {
      if (active.current) {
        const message = errorMessage(failure);

        setError(message);
        toast.error(
          attempt.operation ? 'Lance ainda não confirmado' : 'Lance não registrado',
          message,
        );
      }
    } finally {
      if (active.current) {
        // Keep the form locked until the independent snapshots have been refreshed.
        await Promise.all([
          cache.invalidateQueries({ queryKey: ['public'] }),
          cache.invalidateQueries({ queryKey: ['private', userId] }),
        ]);
        if (active.current) {
          submitting.current = false;
          setBusy(false);
        }
      }
    }
  }

  if (!attempt) {
    return (
      <p role="alert">
        Não foi possível recuperar os lances desta aba. Recarregue a página e confira seu histórico
        antes de enviar outro lance.
      </p>
    );
  }

  return (
    <form onSubmit={(event) => void send(event)} noValidate className="space-y-4">
      {pending ? (
        <div role="status" className="space-y-2 border-l-2 border-warning pl-3">
          <p className="font-semibold">Lance aguardando confirmação</p>
          <p>
            {formatMoney(pending.input.amountCents)} · Consulte novamente para recuperar o resultado
            da mesma solicitação.
          </p>
        </div>
      ) : (
        <>
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
              disabled={disabled || busy}
              onChange={(event) => {
                setAmount(event.target.value);
                setError('');
              }}
              className="h-13 text-xl tabular-nums"
            />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            {minimum !== null && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled || busy}
                className="-ml-3 text-info"
                onClick={() => {
                  setAmount((minimum / 100).toFixed(2).replace('.', ','));
                  setError('');
                  inputRef.current?.focus();
                }}
              >
                Usar mínimo {formatMoney(minimum)}
              </Button>
            )}
            <p className="text-muted-foreground">Disponível {formatMoney(wallet.availableCents)}</p>
          </div>
        </>
      )}
      {pending && error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        type="submit"
        size="lg"
        loading={busy}
        disabled={!pending && disabled}
        className="h-auto min-h-12 w-full whitespace-normal py-3 text-center"
      >
        {pending
          ? 'Consultar lance'
          : auction.status === 'ENDED'
            ? 'Este lote já foi encerrado'
            : auction.status === 'CANCELLED'
              ? 'Este lote foi cancelado'
              : auction.status === 'SCHEDULED'
                ? 'Aguardando início do leilão'
                : position.isLeading
                  ? 'Você já está na liderança'
                  : disabled
                    ? 'Aguardando liberação dos lances'
                    : amountCents === null
                      ? 'Dar lance'
                      : `Dar lance de ${formatMoney(amountCents)}`}
      </Button>
      <p id="bid-reservation-hint" className="text-sm leading-relaxed text-muted-foreground">
        O valor fica reservado enquanto você lidera. Se for superado, ele volta ao saldo disponível.
      </p>
      {minimum !== null && wallet.availableCents < minimum && !position.isLeading && !pending && (
        <p className="border-l-2 border-warning pl-3 text-sm text-warning">
          Seu saldo disponível não cobre o lance mínimo de {formatMoney(minimum)}.{' '}
          <Link to="/wallet" className="ml-1 underline underline-offset-4">
            Adicionar saldo simulado
          </Link>
        </p>
      )}
    </form>
  );
}
