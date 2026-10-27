import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';

import type { UserRole } from '@holobid/contracts';

import { safeDestination } from '../../auth/navigation';
import { useAuth } from '../../providers/auth-provider';
import { Button, buttonVariants } from '../ui/button';

export function SessionLoading() {
  return (
    <p role="status" className="py-12 text-center text-muted-foreground">
      Verificando sua sessão…
    </p>
  );
}

export function RequireAuth({ role }: { role: UserRole }) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === 'restoring') {
    return <SessionLoading />;
  }

  if (auth.status === 'unavailable') {
    return (
      <section className="mx-auto max-w-md space-y-4 py-12">
        <h1 className="font-display text-4xl">Não foi possível verificar sua sessão</h1>
        <p className="text-muted-foreground">Confira sua conexão e tente novamente.</p>
        <Button onClick={() => void auth.restore()}>Tentar novamente</Button>
      </section>
    );
  }

  if (!auth.user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ returnTo: location.pathname + location.search + location.hash }}
      />
    );
  }

  if (auth.user.role !== role) {
    return (
      <section className="mx-auto max-w-md space-y-4 py-12">
        <h1 className="font-display text-4xl">Esta área pertence a outro perfil</h1>
        <p className="text-muted-foreground">
          Sua conta não tem permissão para acessar esta página.
        </p>
        <Link to={safeDestination(null, auth.user.role)} className={buttonVariants()}>
          Voltar à minha área
        </Link>
      </section>
    );
  }

  return <Outlet />;
}

export function GuestOnly() {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === 'restoring') {
    return <SessionLoading />;
  }

  if (auth.user) {
    return (
      <Navigate
        to={safeDestination(
          location.state?.returnTo ?? new URLSearchParams(location.search).get('returnTo'),
          auth.user.role,
        )}
        replace
      />
    );
  }

  return <Outlet />;
}
