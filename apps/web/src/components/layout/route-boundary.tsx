import { Component, type ReactNode, Suspense } from 'react';
import { useLocation } from 'react-router-dom';

import {
  AuctionGridSkeleton,
  AuctionRoomSkeleton,
  AuditSkeleton,
  AuthFormSkeleton,
  PrivatePageSkeleton,
  ReceiptSkeleton,
} from '../shared/loading-skeletons';
import { Button } from '../ui/button';

class RouteErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <section role="alert" className="mx-auto max-w-md space-y-4 py-12">
          <h1>Não foi possível abrir esta página</h1>
          <p>Verifique sua conexão e recarregue para tentar novamente.</p>
          <Button onClick={() => window.location.reload()}>Recarregar página</Button>
        </section>
      );
    }

    return this.props.children;
  }
}

function RouteSkeleton({ pathname }: { pathname: string }) {
  if (pathname === '/login' || pathname === '/register') {
    return <AuthFormSkeleton registration={pathname === '/register'} />;
  }

  if (pathname === '/auctions') {
    return <AuctionGridSkeleton />;
  }

  if (/^\/auctions\/[^/]+\/audit\/?$/.test(pathname)) {
    return <AuditSkeleton />;
  }

  if (pathname.startsWith('/receipts/')) {
    return <ReceiptSkeleton />;
  }

  if (pathname !== '/auctions/new' && /^\/auctions\/[^/]+\/?$/.test(pathname)) {
    return <AuctionRoomSkeleton />;
  }

  return <PrivatePageSkeleton pathname={pathname} />;
}

export function RouteBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();

  return (
    <RouteErrorBoundary key={pathname}>
      <Suspense fallback={<RouteSkeleton pathname={pathname} />}>{children}</Suspense>
    </RouteErrorBoundary>
  );
}
