import { ArrowRight, Layers2, LogOut, Menu, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';

import { useDemo } from '../../demo/demo-provider';
import type { DemoRole } from '../../demo/types';
import { cn } from '../../lib/utils';
import { ThemeSelect } from '../../providers/theme-provider';
import { Money } from '../shared/money';
import { Button, buttonVariants } from '../ui/button';
import { Modal } from '../ui/dialog';
import { toast } from '../ui/toast';

export function AppLayout() {
  const { user, availableCents, login, logout, reset } = useDemo();
  const [menuOpen, setMenuOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const location = useLocation();
  const main = useRef<HTMLElement>(null);
  const lastPath = useRef(location.pathname);
  const nav =
    user?.role === 'auctioneer'
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
    if (lastPath.current !== location.pathname) {
      window.scrollTo(0, 0);
      main.current?.focus({ preventScroll: true });
      lastPath.current = location.pathname;
    }
  }, [location.pathname]);

  const role = (next: string) => {
    if (next === 'visitor') {
      logout();
    } else {
      login(next as DemoRole);
    }

    setDemoOpen(false);
    toast.info('Perfil de demonstração alterado');
  };

  const links = (close?: () => void) =>
    nav.map(([label, to]) => (
      <NavLink
        key={to}
        to={to!}
        end
        onClick={close}
        className={({ isActive }) =>
          cn(
            'flex min-h-12 items-center border-b-2 px-3 font-semibold',
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
        className="sr-only fixed left-4 top-3 z-[90] rounded-sm bg-primary px-4 py-3 text-primary-foreground focus:not-sr-only"
      >
        Ir para o conteúdo
      </a>
      <div className="no-print border-b bg-muted/70">
        <div className="page-container flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1 text-xs text-muted-foreground">
          <span>Demonstração visual · Dados e saldo simulados</span>
          <button
            className="min-h-8 font-semibold text-info underline underline-offset-4"
            onClick={() => setDemoOpen(true)}
          >
            Trocar perfil ou reiniciar
          </button>
        </div>
      </div>
      <header className="border-b">
        <div className="page-container flex min-h-18 items-center justify-between gap-3">
          <Link
            to="/auctions"
            className="flex items-center gap-2 font-display text-3xl font-semibold"
            aria-label="HoloBid, página de leilões"
          >
            <Layers2 aria-hidden="true" className="size-7 text-primary" />
            HoloBid
          </Link>
          <nav aria-label="Principal" className="hidden gap-2 lg:flex">
            {links()}
          </nav>
          <div className="flex items-center gap-3">
            {user?.role === 'bidder' && (
              <Link to="/wallet" className="hidden text-right sm:block">
                <span className="block text-xs text-muted-foreground">Disponível</span>
                <Money cents={availableCents} className="font-semibold" />
              </Link>
            )}
            <ThemeSelect />
            {user ? (
              <Button
                variant="ghost"
                size="icon"
                className="hidden lg:flex"
                aria-label="Sair da demonstração"
                onClick={() => {
                  logout();
                  toast.info('Você saiu do perfil de demonstração');
                }}
              >
                <LogOut />
              </Button>
            ) : (
              <Link
                to="/login"
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'sm' }),
                  'hidden sm:inline-flex',
                )}
              >
                Entrar
                <ArrowRight />
              </Link>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Abrir menu"
              className="lg:hidden"
              onClick={() => setMenuOpen(true)}
            >
              <Menu />
            </Button>
          </div>
        </div>
      </header>
      <main
        id="main-content"
        ref={main}
        tabIndex={-1}
        className="page-container min-h-[70dvh] py-8 outline-none sm:py-12"
      >
        <Outlet key={`${user?.role ?? 'visitor'}-${user?.email ?? ''}`} />
      </main>
      <footer className="mt-8 border-t">
        <div className="page-container flex flex-col justify-between gap-4 py-7 text-sm text-muted-foreground sm:flex-row">
          <div>
            <span className="font-semibold text-foreground">HoloBid</span>
            <p>Cartas Pokémon. Leilões com histórico público.</p>
          </div>
          <div className="flex flex-wrap items-center gap-5">
            <Link className="text-link" to="/design-system">
              Design system
            </Link>
            <span>Catálogo TCGdex · Projeto demonstrativo</span>
          </div>
        </div>
      </footer>
      <Modal open={menuOpen} onOpenChange={setMenuOpen} title="Navegação">
        <nav aria-label="Menu móvel" className="flex flex-col">
          {links(() => setMenuOpen(false))}
          {!user && (
            <>
              <Link
                className="min-h-12 py-3 font-semibold"
                to="/login"
                onClick={() => setMenuOpen(false)}
              >
                Entrar
              </Link>
              <Link
                className="min-h-12 py-3 font-semibold"
                to="/register"
                onClick={() => setMenuOpen(false)}
              >
                Criar conta
              </Link>
            </>
          )}
          {user && (
            <Button
              variant="ghost"
              className="mt-4 justify-start"
              onClick={() => {
                logout();
                setMenuOpen(false);
                toast.info('Você saiu do perfil de demonstração');
              }}
            >
              <LogOut />
              Sair da demonstração
            </Button>
          )}
        </nav>
      </Modal>
      <Modal
        open={demoOpen}
        onOpenChange={setDemoOpen}
        title="Explore a demonstração"
        description="As ações mudam somente os dados desta aba. Recarregar restaura os exemplos; nenhuma operação é enviada à API."
      >
        <div className="grid gap-3">
          <Button
            variant={user?.role === 'bidder' ? 'default' : 'outline'}
            onClick={() => role('bidder')}
          >
            Licitante · Marina
          </Button>
          <Button
            variant={user?.role === 'auctioneer' ? 'default' : 'outline'}
            onClick={() => role('auctioneer')}
          >
            Leiloeiro · Mesa HoloBid
          </Button>
          <Button variant={!user ? 'default' : 'outline'} onClick={() => role('visitor')}>
            Visitante · sem conta
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              reset();
              setDemoOpen(false);
              toast.info('Demonstração reiniciada');
            }}
          >
            <RotateCcw />
            Restaurar dados iniciais
          </Button>
        </div>
      </Modal>
    </>
  );
}
