import { describe, expect, it, vi } from 'vitest';

import type { DepositResponse } from '@holobid/contracts';

import { ApiRequestError, errorMessage } from '../../services/api-error';

import { depositAmount, depositAttempt } from './deposit-attempt';

const response = {
  status: 201,
  data: {
    depositId: 'deposit',
    wallet: {
      totalCents: 100,
      reservedCents: 0,
      availableCents: 100,
      version: 1,
      serverTime: new Date().toISOString(),
    },
  },
};

describe('wallet deposit boundary', () => {
  it('parses BRL to exact cents and rejects zero, signs, precision loss and amounts over the limit', () => {
    expect(depositAmount('R$ 1.234,56')).toBe(123456);
    expect(depositAmount('0,01')).toBe(1);
    expect(depositAmount('1.000.000.000,00')).toBe(100_000_000_000);
    for (const value of ['', '0', '-10', '+10', '1e3', '1,001', '1.2', 'NaN', '1.000.000.000,01']) {
      expect(depositAmount(value)).toBeNull();
    }
  });
  it('requires a confirmed deposit response and allows correcting a rejected balance-limit amount', async () => {
    const values = new Map<string, string>();
    const store = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    } as Storage;
    const send = vi
      .fn()
      .mockResolvedValueOnce({ status: 201, data: {} as DepositResponse })
      .mockResolvedValueOnce(response);
    const attempt = depositAttempt(send, store, 'user');

    await attempt.submit({ amountCents: 100 });
    expect(attempt.operation).toBeDefined();
    await attempt.submit();
    expect(attempt.operation).toBeUndefined();

    const error = new ApiRequestError('http', 422, {
      code: 'BALANCE_LIMIT_EXCEEDED',
      message: 'limit',
      requestId: 'test',
    });

    send.mockRejectedValueOnce(error);
    await expect(attempt.submit({ amountCents: 100_000_000_000 })).rejects.toBe(error);
    expect(attempt.operation).toBeUndefined();
    expect(errorMessage(error)).toContain('limite de saldo');
  });
});
