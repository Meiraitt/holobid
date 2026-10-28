import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { AuctionRoomView } from '../../views/auction-room/AuctionRoomView';
import { AuctionsView } from '../../views/auctions/AuctionsView';
import { AuditView } from '../../views/audit/AuditView';
import { CatalogPicker } from '../../views/create-auction/CatalogPicker';
import { MyAuctionsView } from '../../views/my-auctions/MyAuctionsView';
import { ParticipationsView } from '../../views/participations/ParticipationsView';
import { ReceiptView } from '../../views/receipt/ReceiptView';
import { WalletView } from '../../views/wallet/WalletView';
import { SessionLoading } from '../auth/route-guards';

import { CardArtwork } from './card-artwork';
import {
  AuctionGridSkeleton,
  AuctionRoomSkeleton,
  AuditSkeleton,
  AuthFormSkeleton,
  CatalogGridSkeleton,
  OwnedAuctionsSkeleton,
  ParticipationListSkeleton,
  ReceiptSkeleton,
  WalletSkeleton,
} from './loading-skeletons';

// React Router's compatibility package resolves a separate server entry in Vitest.
vi.mock('react-router-dom', async () => import('react-router'));

vi.mock('../../providers/auth-provider', () => ({
  useAuth: () => ({ user: { id: 'qa', role: 'BIDDER' }, status: 'authenticated' }),
}));
vi.mock('../../providers/realtime-provider', () => ({
  useRealtimeRoom: () => ({ room: 'joining', phase: 'connecting', ready: false }),
}));

function render(view: ReactNode, route = '/', path = '*') {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });

  return renderToStaticMarkup(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path={path} element={view} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('loading feedback without invented data or controls', () => {
  it.each([
    [<AuctionGridSkeleton />, 'Carregando leilões.'],
    [<AuctionRoomSkeleton />, 'Carregando lote…'],
    [<AuditSkeleton />, 'Verificando histórico…'],
    [<AuthFormSkeleton />, 'Verificando sua sessão…'],
    [<CatalogGridSkeleton />, 'Buscando cartas…'],
    [<OwnedAuctionsSkeleton />, 'Carregando seus lotes…'],
    [<ParticipationListSkeleton />, 'Carregando suas participações…'],
    [<ReceiptSkeleton />, 'Carregando comprovante…'],
    [<WalletSkeleton />, 'Carregando sua carteira…'],
  ])(
    'announces loading once and keeps placeholders out of the accessibility tree (%#)',
    (view, label) => {
      const html = renderToStaticMarkup(view);

      expect(html).toContain(`role="status" class="sr-only">${label}`);
      expect(html.match(/role="status"/g)).toHaveLength(1);
      expect(html).toContain('aria-busy="true"');
      expect(html).toContain('aria-hidden="true"');
      expect(html).not.toMatch(/<button|<a |<input|tabindex|R\$|Histórico verificado|Arrematado/);
      expect(html).toContain('motion-safe:animate-pulse');
    },
  );

  it.each([
    [<AuctionsView />, '/auctions', '*', 'Carregando leilões.'],
    [<AuctionRoomView />, '/auctions/lot', '/auctions/:auctionId', 'Carregando lote…'],
    [<AuditView />, '/auctions/lot/audit', '/auctions/:auctionId/audit', 'Verificando histórico…'],
    [
      <CatalogPicker userId="qa" selectedId="" onSelect={() => {}} />,
      '/auctions/new',
      '*',
      'Buscando cartas…',
    ],
    [<MyAuctionsView />, '/my-auctions', '*', 'Carregando seus lotes…'],
    [<ParticipationsView />, '/participations', '*', 'Carregando suas participações…'],
    [<ReceiptView />, '/receipts/code', '/receipts/:receiptId', 'Carregando comprovante…'],
    [<WalletView />, '/wallet', '*', 'Carregando sua carteira…'],
  ])(
    'renders view placeholders while initial data is unavailable (%#)',
    (view, route, path, label) => {
      const html = render(view, route, path);

      expect(html).toContain(`role="status" class="sr-only">${label}`);
      expect(html).toContain('aria-busy="true"');
      expect(html).not.toContain('Nenhum lote nesta situação');
      expect(html).not.toContain('Nenhuma disputa em andamento');
      expect(html).not.toContain('Arremate simulado concluído');
    },
  );

  it.each([
    ['/login', 'Verificando sua sessão…'],
    ['/register', 'Verificando sua sessão…'],
    ['/wallet', 'Carregando sua carteira…'],
    ['/participations', 'Carregando suas participações…'],
    ['/my-auctions', 'Carregando seus lotes…'],
    ['/auctions/new', 'Buscando cartas…'],
  ])('keeps the destination shape during session restoration on %s', (path, label) => {
    const html = render(<SessionLoading />, path);

    expect(html).toContain(label);
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toMatch(/<button|<a |<input|tabindex/);
  });
});

describe('card media discovery', () => {
  it('prioritizes the visible lead artwork and defers other cards without removing intrinsic dimensions', () => {
    const visible = renderToStaticMarkup(
      <CardArtwork src="https://assets.tcgdex.net/card.webp" alt="Carta" priority />,
    );
    const deferred = renderToStaticMarkup(
      <CardArtwork src="https://assets.tcgdex.net/card.webp" alt="Carta" />,
    );

    expect(visible).toContain('loading="eager"');
    expect(visible).toContain('fetchPriority="high"');
    expect(deferred).toContain('loading="lazy"');
    expect(deferred).not.toContain('fetchPriority="high"');
    for (const html of [visible, deferred]) {
      expect(html).toContain('width="245" height="337"');
      expect(html).toContain('decoding="async"');
      expect(html).toContain('alt="Carta"');
    }
  });
  it('preserves the unavailable-image fallback without a broken network request', () => {
    const html = renderToStaticMarkup(<CardArtwork src="" alt="Carta" priority zoom />);

    expect(html).toContain('Imagem indisponível');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('Ampliar imagem');
  });
});
