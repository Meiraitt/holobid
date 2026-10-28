import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AppLayout } from './app-layout';

vi.mock('../../providers/auth-provider', () => ({
  useAuth: () => ({ user: null, status: 'anonymous', logout: vi.fn() }),
}));
vi.mock('../../providers/realtime-provider', () => ({
  useRealtime: () => ({ phase: 'unavailable', retry: vi.fn() }),
}));
vi.mock('../../providers/theme-provider', () => ({
  ThemeToggle: () => <button>Ativar tema claro</button>,
}));

function renderAt(path: string) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <AppLayout />
    </MemoryRouter>,
  );
}

describe('navigation connection feedback', () => {
  it('does not interrupt static, authentication or verification pages with a bidding warning', () => {
    for (const path of [
      '/',
      '/login',
      '/register',
      '/design-system',
      '/auctions/new',
      '/auctions/lot/audit',
      '/receipts/code',
    ]) {
      expect(renderAt(path), path).not.toContain('Novos lances aguardam a sincronização');
    }
  });

  it('keeps reconnection feedback on pages that present live auction and wallet state', () => {
    for (const path of [
      '/auctions',
      '/auctions/lot',
      '/my-auctions',
      '/participations',
      '/wallet',
    ]) {
      const html = renderAt(path);

      expect(html, path).toContain('Novos lances aguardam a sincronização');
      expect(html, path).toContain('Reconectar e atualizar');
    }
  });
});
