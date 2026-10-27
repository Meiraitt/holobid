import { Navigate, Route, Routes } from 'react-router-dom';

import { AppLayout } from './components/layout/app-layout';
import { AuctionRoomView } from './views/auction-room/AuctionRoomView';
import { AuctionsView } from './views/auctions/AuctionsView';
import { AuditView } from './views/audit/AuditView';
import { CreateAuctionView } from './views/create-auction/CreateAuctionView';
import { DesignSystemView } from './views/design-system/DesignSystemView';
import { LoginView } from './views/login/LoginView';
import { MyAuctionsView } from './views/my-auctions/MyAuctionsView';
import { NotFoundView } from './views/not-found/NotFoundView';
import { ParticipationsView } from './views/participations/ParticipationsView';
import { ReceiptView } from './views/receipt/ReceiptView';
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
        <Route path="/my-auctions" element={<MyAuctionsView />} />
        <Route path="/auctions/new" element={<CreateAuctionView />} />
        <Route path="/auctions/:auctionId/audit" element={<AuditView />} />
        <Route path="/receipts/:receiptId" element={<ReceiptView />} />
        <Route path="*" element={<NotFoundView />} />
      </Route>
    </Routes>
  );
}
