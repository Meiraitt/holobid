import { Route, Routes } from 'react-router-dom';

import { GuestOnly, RequireAuth } from './components/auth/route-guards';
import { AppLayout } from './components/layout/app-layout';
import {
  AuctionRoomView,
  AuctionsView,
  AuditView,
  CreateAuctionView,
  LoginView,
  MyAuctionsView,
  ParticipationsView,
  ReceiptView,
  RegisterView,
  WalletView,
} from './views/deferred-views';
import { DesignSystemView } from './views/design-system/DesignSystemView';
import { LandingView } from './views/landing/LandingView';
import { NotFoundView } from './views/not-found/NotFoundView';

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<LandingView />} />
        {import.meta.env.DEV && <Route path="/design-system" element={<DesignSystemView />} />}
        <Route path="/auctions" element={<AuctionsView />} />
        <Route element={<GuestOnly />}>
          <Route path="/login" element={<LoginView />} />
          <Route path="/register" element={<RegisterView />} />
        </Route>
        <Route path="/auctions/:auctionId" element={<AuctionRoomView />} />
        <Route element={<RequireAuth role="BIDDER" />}>
          <Route path="/wallet" element={<WalletView />} />
          <Route path="/participations" element={<ParticipationsView />} />
        </Route>
        <Route element={<RequireAuth role="AUCTIONEER" />}>
          <Route path="/my-auctions" element={<MyAuctionsView />} />
          <Route path="/auctions/new" element={<CreateAuctionView />} />
        </Route>
        <Route path="/auctions/:auctionId/audit" element={<AuditView />} />
        <Route path="/receipts/:receiptId" element={<ReceiptView />} />
        <Route path="*" element={<NotFoundView />} />
      </Route>
    </Routes>
  );
}
