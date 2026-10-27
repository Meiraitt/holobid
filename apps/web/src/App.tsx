import { Navigate, Route, Routes } from 'react-router-dom';

import { AppLayout } from './components/layout/app-layout';
import { AuctionRoomView } from './views/auction-room/AuctionRoomView';
import { AuctionsView } from './views/auctions/AuctionsView';
import { DesignSystemView } from './views/design-system/DesignSystemView';
import { LoginView } from './views/login/LoginView';
import { NotFoundView } from './views/not-found/NotFoundView';
import { ParticipationsView } from './views/participations/ParticipationsView';
import { RegisterView } from './views/register/RegisterView';
import { WalletView } from './views/wallet/WalletView';

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/auctions" replace />} />
        <Route path="/design-system" element={<DesignSystemView />} />
        <Route path="/auctions" element={<AuctionsView />} />
        <Route path="/login" element={<LoginView />} />
        <Route path="/register" element={<RegisterView />} />
        <Route path="/auctions/:auctionId" element={<AuctionRoomView />} />
        <Route path="/wallet" element={<WalletView />} />
        <Route path="/participations" element={<ParticipationsView />} />
        <Route path="*" element={<NotFoundView />} />
      </Route>
    </Routes>
  );
}
