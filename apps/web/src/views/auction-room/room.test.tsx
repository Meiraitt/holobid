import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { AuctionDetail } from '@holobid/contracts';

import { bidAmount } from './bid-attempt';
import { AuctionOutcome, confirmedOutcome } from './components/AuctionOutcome';
import { Countdown } from './components/Countdown';
import { serverNow } from './server-clock';

const ended = {
  status: 'ENDED',
  settlementStatus: 'COMPLETED',
  confirmation: 'CONFIRMED',
  auditIntegrity: 'VERIFIED',
  outcome: {
    kind: 'SOLD',
    amountCents: 12345,
    winnerPseudonym: 'Lic. ABCD',
    receiptCode: 'receipt',
  },
} as AuctionDetail;

describe('auction room invariants', () => {
  it('converts BRL exactly and rejects fractional cents, negatives, invalid syntax and overflow', () => {
    expect(bidAmount('1.234,56')).toBe(123456);
    expect(bidAmount('0,01')).toBe(1);
    expect(bidAmount('1000000000,00')).toBe(100000000000);
    for (const input of ['', '0', '-1', '1,001', 'NaN', '1e3', '1000000000,01']) {
      expect(bidAmount(input)).toBeNull();
    }
  });
  it('uses server time and monotonic elapsed time despite local wall-clock changes', () => {
    const sample = { serverTime: '2026-10-27T15:00:00Z', receivedAt: 100 };
    const epoch = Date.parse(sample.serverTime);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(epoch + 86400000);

    try {
      expect(serverNow(sample, 1100)).toBe(epoch + 1000);
      clock.mockReturnValue(epoch - 86400000);
      expect(serverNow(sample, 2100)).toBe(epoch + 2000);
      expect(serverNow(sample, 50)).toBe(epoch);
      expect(serverNow({ serverTime: '2026-10-27T15:02:00Z', receivedAt: 5000 }, 6000)).toBe(
        epoch + 121000,
      );
    } finally {
      clock.mockRestore();
    }
  });
  it('shows waiting at zero, never a winner, and handles a refetched extension', () => {
    const now = Date.parse('2026-10-27T15:00:00Z');
    const zero = renderToStaticMarkup(<Countdown deadline="2026-10-27T15:00:00Z" now={now} />);
    const extended = renderToStaticMarkup(<Countdown deadline="2026-10-27T15:02:00Z" now={now} />);

    expect(zero).toContain('Aguardando atualização');
    expect(zero).not.toContain('arremat');
    expect(extended).toContain('02:00');
  });
  it('only announces a verified settled outcome, and distinguishes no bids from processing/failure', () => {
    expect(confirmedOutcome(ended)?.kind).toBe('SOLD');
    for (const patch of [
      { status: 'LIVE' },
      { confirmation: 'PENDING' },
      { settlementStatus: 'PENDING' },
      { auditIntegrity: 'TAMPERED' },
    ]) {
      const lot = { ...ended, ...patch } as AuctionDetail;

      expect(confirmedOutcome(lot)).toBeUndefined();
      expect(renderToStaticMarkup(<AuctionOutcome auction={lot} />)).toContain(
        'Resultado em processamento',
      );
    }

    expect(
      renderToStaticMarkup(<AuctionOutcome auction={{ ...ended, settlementStatus: 'FAILED' }} />),
    ).toContain('Liquidação interrompida');
    expect(
      renderToStaticMarkup(
        <AuctionOutcome auction={{ ...ended, outcome: { kind: 'NO_BIDS', amountCents: 0 } }} />,
      ),
    ).toContain('R$ 0,00');
    expect(renderToStaticMarkup(<AuctionOutcome auction={ended} />)).toContain('Lic. ABCD');
  });
});
