import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { AppProviders } from './providers/app-providers';
import { preloadDashboard } from './views/deferred-views';

if (window.location.pathname.replace(/\/$/, '') === '/my-auctions') {
  // Fetch the dashboard chunk while the session is restored, before the auth guard reveals it.
  // A failed preload is handled by the route boundary when the view is rendered.
  void preloadDashboard().catch(() => {});
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);
