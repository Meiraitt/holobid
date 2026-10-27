import { Navigate, Route, Routes } from 'react-router-dom';

import { AppLayout } from './components/layout/app-layout';
import { AuctionsView } from './views/auctions/AuctionsView';
import { DesignSystemView } from './views/design-system/DesignSystemView';
import { LoginView } from './views/login/LoginView';
import { NotFoundView } from './views/not-found/NotFoundView';
import { RegisterView } from './views/register/RegisterView';

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/auctions" replace />} />
        <Route path="/design-system" element={<DesignSystemView />} />
        <Route path="/auctions" element={<AuctionsView />} />
        <Route path="/login" element={<LoginView />} />
        <Route path="/register" element={<RegisterView />} />
        <Route path="*" element={<NotFoundView />} />
      </Route>
    </Routes>
  );
}
