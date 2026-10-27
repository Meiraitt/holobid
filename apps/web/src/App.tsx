import { Navigate, Route, Routes } from 'react-router-dom';

import { AppLayout } from './components/layout/app-layout';
import { AuctionsView } from './views/auctions/AuctionsView';
import { DesignSystemView } from './views/design-system/DesignSystemView';
import { NotFoundView } from './views/not-found/NotFoundView';

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/auctions" replace />} />
        <Route path="/design-system" element={<DesignSystemView />} />
        <Route path="/auctions" element={<AuctionsView />} />
        <Route path="*" element={<NotFoundView />} />
      </Route>
    </Routes>
  );
}
