import { lazy } from 'react';

export const preloadDashboard = () =>
  import('./my-auctions/MyAuctionsView').then((module) => ({ default: module.MyAuctionsView }));

export const MyAuctionsView = lazy(preloadDashboard);

export const AuctionRoomView = lazy(() =>
  import('./auction-room/AuctionRoomView').then((module) => ({ default: module.AuctionRoomView })),
);
export const AuctionsView = lazy(() =>
  import('./auctions/AuctionsView').then((module) => ({ default: module.AuctionsView })),
);
export const AuditView = lazy(() =>
  import('./audit/AuditView').then((module) => ({ default: module.AuditView })),
);
export const CreateAuctionView = lazy(() =>
  import('./create-auction/CreateAuctionView').then((module) => ({
    default: module.CreateAuctionView,
  })),
);
export const LoginView = lazy(() =>
  import('./login/LoginView').then((module) => ({ default: module.LoginView })),
);
export const ParticipationsView = lazy(() =>
  import('./participations/ParticipationsView').then((module) => ({
    default: module.ParticipationsView,
  })),
);
export const ReceiptView = lazy(() =>
  import('./receipt/ReceiptView').then((module) => ({ default: module.ReceiptView })),
);
export const RegisterView = lazy(() =>
  import('./register/RegisterView').then((module) => ({ default: module.RegisterView })),
);
export const WalletView = lazy(() =>
  import('./wallet/WalletView').then((module) => ({ default: module.WalletView })),
);
