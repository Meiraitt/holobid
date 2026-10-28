import { ArrowRight, LogOut, Menu, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';

import { cn } from '../../lib/utils';
import { useAuth } from '../../providers/auth-provider';
import { useRealtime } from '../../providers/realtime-provider';
import { ThemeToggle } from '../../providers/theme-provider';
import { errorMessage } from '../../services/api-error';
import { Brand } from '../shared/brand';
import { Button, buttonVariants } from '../ui/button';
import { toast } from '../ui/toast';

export function AppLayout() {
  const { user, status, logout } = useAuth();
  const realtime = useRealtime();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const menuId = useId();
  const menuPanel = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const main = useRef<HTMLElement>(null);
  const lastPath = useRef(location.pathname);
  const needsLiveUpdates =
    location.pathname !== '/auctions/new' &&
    /^\/(auctions(?:\/[^/]+)?|my-auctions|participations|wallet)\/?$/.test(location.pathname);
  const nav =
    user?.role === 'AUCTIONEER'
      ? [
          ['Leilões', '/auctions'],
          ['Meus lotes', '/my-auctions'],
          ['Criar lote', '/auctions/new'],
        ]
      : [
          ['Leilões', '/auctions'],
          ['Meus lances', '/participations'],
          ['Carteira', '/wallet'],
        ];

  useEffect(() => {
    setMenuOpen(false);
  }, [location.key]);

  useEffect(() => {
    if (lastPath.current !== location.pathname) {
      window.scrollTo(0, 0);
      main.current?.focus({ preventScroll: true });
      lastPath.current = location.pathname;
    }
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    function closeOutside(event: PointerEvent | FocusEvent) {
      if (
        event.target instanceof Node &&
        !menuPanel.current?.contains(event.target) &&
        !menuTrigger.current?.contains(event.target)
      ) {
        setMenuOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuOpen(false);
        menuTrigger.current?.focus({ preventScroll: true });
      }
    }

    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => {
      if (desktop.matches) {
        setMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    desktop.addEventListener('change', closeOnDesktop);

    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('focusin', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
      desktop.removeEventListener('change', closeOnDesktop);
    };
  }, [menuOpen]);

  async function handleLogout() {
    if (loggingOut) {
      return;
    }

    setLoggingOut(true);
    setLogoutError(false);
    setMenuOpen(false);
    try {
      await logout();
      toast.success('Você saiu da sua conta');
    } catch (error) {
      setLogoutError(true);
      toast.error(
        'Saída local concluída',
        'O servidor ainda não confirmou o encerramento. ' + errorMessage(error),
      );
    } finally {
      setLoggingOut(false);
    }
  }

  const links = (close?: () => void) =>
    nav.map(([label, to]) => (
      <NavLink
        key={to}
        to={to!}
        end
        onClick={close}
        className={({ isActive }) =>
          cn(
            'flex min-h-12 items-center border-b-2 px-3 font-semibold transition-colors duration-200 motion-reduce:transition-none',
            isActive
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )
        }
      >
        {label}
      </NavLink>
    ));

  return (
    <>
      <a
        href="#main-content"
        className="sr-only left-4 top-3 z-[90] rounded-sm bg-primary text-primary-foreground focus-visible:not-sr-only focus-visible:fixed focus-visible:px-4 focus-visible:py-3"
      >
        Ir para o conteúdo
      </a>
      {needsLiveUpdates && ['disconnected', 'unavailable'].includes(realtime.phase) && (
        <div
          role="status"
          className="page-container flex flex-wrap items-center gap-3 border-b py-3 text-sm text-warning"
        >
          <p>Atualizações ao vivo interrompidas. Novos lances aguardam a sincronização.</p>
          <Button variant="outline" size="sm" onClick={realtime.retry}>
            Reconectar e atualizar
          </Button>
        </div>
      )}
      <header className="relative z-40 border-b bg-background">
        <div className="page-container flex min-h-18 items-center justify-between gap-3">
          <Link
            to="/"
            className="flex items-center gap-2 font-display text-3xl font-semibold"
            aria-label="HoloBid, página inicial"
          >
            <Brand />
          </Link>
          <nav aria-label="Principal" className="hidden gap-2 lg:flex">
            {links()}
          </nav>
          <div className="flex items-center gap-3">
            <span
              className="hidden w-40 truncate text-right text-sm text-muted-foreground xl:block"
              title={user?.email}
            >
              {user?.email}
            </span>
            <ThemeToggle />
            <div className="hidden w-24 justify-end sm:flex">
              {user ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="hidden lg:flex"
                  aria-label="Sair da conta"
                  loading={loggingOut}
                  onClick={() => void handleLogout()}
                >
                  <LogOut />
                </Button>
              ) : status === 'restoring' ? (
                <span role="status" className="flex h-11 w-24 items-center justify-end">
                  <span className="sr-only">Verificando sessão…</span>
                  <span
                    aria-hidden="true"
                    className="h-9 w-20 animate-pulse rounded-sm bg-muted motion-reduce:animate-none"
                  />
                </span>
              ) : (
                <Link to="/login" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  Entrar
                  <ArrowRight />
                </Link>
              )}
            </div>
            <Button
              ref={menuTrigger}
              variant="ghost"
              size="icon"
              aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
              aria-expanded={menuOpen}
              aria-controls={menuId}
              className="relative lg:hidden"
              onClick={() => {
                setMenuOpen((open) => !open);
                if (menuOpen) {
                  menuTrigger.current?.focus({ preventScroll: true });
                }
              }}
            >
              <Menu
                aria-hidden="true"
                className={cn(
                  'absolute transition-[rotate,scale,opacity] duration-200 motion-reduce:transition-none',
                  menuOpen ? 'rotate-90 scale-75 opacity-0' : 'rotate-0 scale-100 opacity-100',
                )}
              />
              <X
                aria-hidden="true"
                className={cn(
                  'absolute transition-[rotate,scale,opacity] duration-200 motion-reduce:transition-none',
                  menuOpen ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-75 opacity-0',
                )}
              />
            </Button>
          </div>
        </div>
        <div
          ref={menuPanel}
          id={menuId}
          aria-hidden={!menuOpen}
          inert={!menuOpen}
          className={cn(
            'absolute inset-x-0 top-full grid bg-background transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none lg:hidden',
            menuOpen
              ? 'grid-rows-[1fr] border-b opacity-100 shadow-xl shadow-black/10'
              : 'pointer-events-none grid-rows-[0fr] opacity-0',
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <nav
              aria-label="Menu móvel"
              className="page-container flex max-h-[calc(100dvh-5rem)] flex-col overflow-y-auto py-4"
            >
              {links(() => setMenuOpen(false))}
              <div className="mt-4 border-t pt-4">
                {user ? (
                  <>
                    <p className="truncate px-3 pb-2 text-sm text-muted-foreground">{user.email}</p>
                    <Button
                      variant="ghost"
                      className="w-full justify-start"
                      loading={loggingOut}
                      onClick={() => void handleLogout()}
                    >
                      <LogOut />
                      Sair da conta
                    </Button>
                  </>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <Link
                      className={buttonVariants({ variant: 'outline' })}
                      to="/login"
                      onClick={() => setMenuOpen(false)}
                    >
                      Entrar
                    </Link>
                    <Link
                      className={buttonVariants()}
                      to="/register"
                      onClick={() => setMenuOpen(false)}
                    >
                      Criar conta
                    </Link>
                  </div>
                )}
              </div>
            </nav>
          </div>
        </div>
      </header>
      {logoutError && (
        <div role="alert" className="page-container py-4 text-sm text-warning">
          Você saiu neste navegador, mas o servidor não confirmou o encerramento.
          <Button variant="ghost" onClick={() => void handleLogout()} loading={loggingOut}>
            Tentar encerrar novamente
          </Button>
        </div>
      )}
      <main
        id="main-content"
        ref={main}
        tabIndex={-1}
        className="page-container min-h-[70dvh] py-8 outline-none sm:py-12"
      >
        <Outlet key={user?.id ?? 'visitor'} />
      </main>
      <footer className="mt-8 border-t">
        <div className="page-container flex flex-col justify-between gap-4 py-7 text-sm text-muted-foreground sm:flex-row">
          <div>
            <span className="font-semibold text-foreground">HoloBid</span>
            <p>Cartas Pokémon. Leilões com histórico público.</p>
          </div>
          <div className="flex flex-wrap items-center gap-5">
            {import.meta.env.DEV && (
              <Link className="text-link" to="/design-system">
                Design system
              </Link>
            )}
            <span>Catálogo TCGdex · Projeto demonstrativo</span>
          </div>
        </div>
      </footer>
    </>
  );
}
