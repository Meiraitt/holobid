import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { toast } from '../../components/ui/toast';
import { formatMoney } from '../../lib/format';
import { api } from '../../services';
import { ApiRequestError, errorMessage } from '../../services/api-error';

import { depositAmount, depositAttempt } from './deposit-attempt';

export function useDeposit(userId: string) {
  const cache = useQueryClient();
  const [attempt] = useState(() => {
    try {
      return depositAttempt(api.wallet.deposit, sessionStorage, userId);
    } catch {
      return null;
    }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lastDeposit, setLastDeposit] = useState<number | null>(null);
  const submitting = useRef(false);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;

    return () => {
      active.current = false;
    };
  }, []);

  async function submit(value: string) {
    if (!attempt || submitting.current) {
      return false;
    }

    const cents = attempt.operation?.input.amountCents ?? depositAmount(value);

    if (cents === null) {
      setError('Informe de R$ 0,01 a R$ 1.000.000.000,00, com até duas casas decimais.');

      return false;
    }

    submitting.current = true;
    setBusy(true);
    setError('');

    let confirmed = false;

    try {
      await attempt.submit({ amountCents: cents });
      if (attempt.operation) {
        throw new ApiRequestError('protocol');
      }

      if (active.current) {
        confirmed = true;
        setLastDeposit(cents);
        toast.success(
          'Depósito simulado confirmado',
          `${formatMoney(cents)} foram adicionados. Nenhuma cobrança foi feita.`,
        );
      }
    } catch (failure) {
      if (active.current) {
        const message = errorMessage(failure);

        setError(message);
        toast.error(
          attempt.operation ? 'Depósito ainda não confirmado' : 'Depósito não realizado',
          message,
        );
      }
    } finally {
      if (active.current) {
        // Never apply the wallet snapshot from a replay: newer bids/deposits may exist.
        await cache.invalidateQueries({ queryKey: ['private', userId] });
        if (active.current) {
          submitting.current = false;
          setBusy(false);
        }
      }
    }

    return confirmed && active.current;
  }

  return { attempt, busy, error, lastDeposit, submit, clearError: () => setError('') };
}
