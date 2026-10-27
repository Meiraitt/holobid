import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { PublicAuctionSummary } from '@holobid/contracts';

import { AuctionCard } from '../../components/shared/auction-card';
import { mediaUrl } from '../../services/media-url';

import { auctionCardData } from './auction-queries';

const auction: PublicAuctionSummary = {
  id: 'lot',
  title: 'Pikachu',
  imageUrl: '/api/v1/media/image',
  setName: 'Base',
  cardNumber: '58',
  status: 'LIVE',
  startsAt: '2026-10-27T12:00:00Z',
  endsAt: '2026-10-27T15:00:00Z',
  startingPriceCents: 12345,
  currentBidCents: null,
  minimumNextBidCents: 12345,
  bidCount: 0,
  version: 0,
  serverTime: '2026-10-27T13:00:00Z',
};

function render(input: PublicAuctionSummary) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <AuctionCard auction={auctionCardData(input, 'https://api.example')} />
    </MemoryRouter>,
  );
}

describe('persisted public auction presentation', () => {
  it('resolves API media separately from the frontend and rejects unsafe URLs', () => {
    expect(mediaUrl(auction.imageUrl, 'https://api.example/api/v1')).toBe(
      'https://api.example/api/v1/media/image',
    );
    expect(mediaUrl('https://assets.tcgdex.net/card.webp', 'https://api.example')).toBe(
      'https://assets.tcgdex.net/card.webp',
    );
    for (const url of [
      '',
      'javascript:alert(1)',
      'data:text/html,hi',
      'https://user:password@example.com',
    ]) {
      expect(mediaUrl(url, 'https://api.example')).toBe('');
    }
  });
  it('shows starting price without inventing a current bid', () => {
    expect(render(auction)).toContain('Lance inicial');
    expect(auctionCardData(auction).currentBidCents).toBe(12345);
    expect(render(auction)).toContain('123,45');
  });
  it('shows current/final amounts and does not call an unsold lot a final bid', () => {
    expect(render({ ...auction, currentBidCents: 15000, bidCount: 1 })).toContain('Lance atual');
    expect(render({ ...auction, status: 'ENDED', currentBidCents: 15000, bidCount: 1 })).toContain(
      'Lance final',
    );
    expect(render({ ...auction, status: 'ENDED' })).toContain('Lance inicial');
  });
  it('keeps navigation, future start and an accessible missing-image fallback', () => {
    const html = render({ ...auction, status: 'SCHEDULED', imageUrl: '' });

    expect(html).toContain('/auctions/lot');
    expect(html).toContain('Começa');
    expect(html).toContain('Imagem indisponível');
  });
});
