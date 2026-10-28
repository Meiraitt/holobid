import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { PublicAudit } from '@holobid/contracts';

import { auditJsonUrl } from './audit-queries';
import { verificationPresentation, VerificationSummary } from './VerificationSummary';

const report = {
  auctionId: 'lot',
  status: 'LIVE',
  algorithmVersion: 1,
  version: 10,
  integrity: 'VERIFIED',
  checkedAt: '2026-10-27T19:00:00Z',
  verifiedThroughSequence: 9,
  expectedCount: 9,
  actualCount: 9,
  reasonCode: 'CONFIRMED',
  headHash: 'a'.repeat(64),
  items: [],
  nextCursor: null,
} satisfies PublicAudit;

describe('server audit presentation', () => {
  it('uses the full server verdict independently of the visible page and keeps all three states distinct', () => {
    expect(verificationPresentation(report).title).toBe('Histórico verificado');
    expect(verificationPresentation({ ...report, integrity: 'TAMPERED' }).title).toBe(
      'Adulteração detectada',
    );
    expect(verificationPresentation({ ...report, integrity: 'INCOMPLETE' }).title).toBe(
      'Verificação incompleta',
    );

    const markup = renderToStaticMarkup(
      <VerificationSummary
        report={{
          ...report,
          integrity: 'TAMPERED',
          reasonCode: 'BID_CHAIN_MISMATCH',
          firstInvalidSequence: 2,
          verifiedThroughSequence: 1,
          headHash: null,
        }}
      />,
    );

    expect(markup).toContain('Primeira sequência com divergência');
    expect(markup).toContain('Adulteração detectada');
    expect(markup).toContain('dateTime="2026-10-27T19:00:00Z"');
    expect(markup).not.toContain('Histórico verificado');
  });
  it('never presents a cached verified report as current when refresh fails or is in flight', () => {
    for (const [refreshing, unavailable] of [
      [true, false],
      [false, true],
      [true, true],
    ]) {
      const markup = renderToStaticMarkup(
        <VerificationSummary report={report} refreshing={refreshing} unavailable={unavailable} />,
      );

      expect(markup).not.toContain('Histórico verificado');
      expect(markup).toContain('não confirmam a integridade atual');
    }
  });
  it('distinguishes unavailable counts from zero and never manufactures missing hashes', () => {
    const markup = renderToStaticMarkup(
      <VerificationSummary
        report={{
          ...report,
          integrity: 'INCOMPLETE',
          actualCount: null,
          expectedCount: null,
          headHash: null,
        }}
      />,
    );

    expect(markup).toContain('Indisponível');
    expect(markup).not.toContain('a'.repeat(64));

    const empty = renderToStaticMarkup(
      <VerificationSummary
        report={{ ...report, actualCount: 0, expectedCount: 0, verifiedThroughSequence: 0 }}
      />,
    );

    expect(empty).toContain('0 / 0');
  });
  it('links the matching public API page with an encoded cursor and no private parameters', () => {
    const url = new URL(auditJsonUrl('lot', 'opaque+/=', 'https://api.holobid.test', 10));

    expect(url.pathname).toBe('/api/v1/auctions/lot/audit');
    expect(url.searchParams.get('cursor')).toBe('opaque+/=');
    expect(url.searchParams.get('limit')).toBe('10');
    expect([...url.searchParams.keys()]).toEqual(['limit', 'cursor']);
  });
});
