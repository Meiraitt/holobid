import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import type { Participation, PublicReceipt } from '@holobid/contracts';

import { copyPublicLink } from '../../components/shared/public-link';
import { ReceiptDocument } from '../receipt/ReceiptDocument';

import { participationResult } from './components/ParticipationRow';

const winner = {
  state: 'WON',
  settlementStatus: 'COMPLETED',
  receiptCode: 'receipt',
  auction: { status: 'ENDED' },
} as Participation;

describe('participation and public receipt presentation', () => {
  it('does not turn a leader, a lost auction or an incomplete settlement into a win', () => {
    expect(participationResult(winner).receiptCode).toBe('receipt');
    for (const patch of [
      { state: 'LEADING' },
      { state: 'LOST', receiptCode: null },
      { state: 'PROCESSING' },
      { settlementStatus: 'PENDING' },
      { settlementStatus: 'FAILED' },
      { receiptCode: null },
      { auction: { status: 'LIVE' } },
    ]) {
      expect(participationResult({ ...winner, ...patch } as Participation).receiptCode).toBeNull();
    }

    expect(participationResult({ ...winner, settlementStatus: 'FAILED' }).tone).toBe('danger');
  });
  it('uses the server pseudonym and final hash, escapes source text and links to the correct audit', () => {
    const receipt = {
      publicCode: 'x'.repeat(32),
      auctionId: 'lot',
      title: '<script>attack</script>',
      imageUrl: '/media/card.webp',
      setName: 'Base',
      cardNumber: '58',
      attributes: {},
      amountCents: 12345,
      winnerPseudonym: 'Lic. 7F42',
      finalAuditHash: 'a'.repeat(64),
      settledAt: '2026-10-27T16:00:00Z',
      auditUrl: '/api/v1/auctions/lot/audit',
    } satisfies PublicReceipt;
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ReceiptDocument receipt={receipt} />
      </MemoryRouter>,
    );

    expect(html).toContain('Lic. 7F42');
    expect(html).toContain('123,45');
    expect(html).toContain('a'.repeat(64));
    expect(html).toContain('href="/auctions/lot/audit"');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
  it('reports copy success only when the clipboard confirms and falls back on absence or denial', async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };

    expect(await copyPublicLink('https://holobid.test/receipts/code', clipboard)).toBe(true);
    expect(clipboard.writeText).toHaveBeenCalledWith('https://holobid.test/receipts/code');
    expect(await copyPublicLink('https://holobid.test/receipts/code')).toBe(false);
    clipboard.writeText.mockRejectedValueOnce(new Error('denied'));
    expect(await copyPublicLink('https://holobid.test/receipts/code', clipboard)).toBe(false);
  });
});
