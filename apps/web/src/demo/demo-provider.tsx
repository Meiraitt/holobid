import { createContext, type ReactNode, useContext, useState } from 'react';

import { createDemoState, demoCards } from './fixtures';
import { assertAmount, bidDemo, depositDemo, reservedBalance } from './model';
import type { CreateAuctionInput, DemoCard, DemoState, DemoUser } from './types';

interface DemoContextValue extends DemoState {
  cards: DemoCard[];
  reservedCents: number;
  availableCents: number;
  deposit: (cents: number) => void;
  placeBid: (auctionId: string, cents: number) => void;
  createAuction: (input: CreateAuctionInput) => string;
  cancelAuction: (id: string) => void;
  reset: () => void;
}

const DemoContext = createContext<DemoContextValue | null>(null);

export function DemoProvider({ children, user }: { children: ReactNode; user: DemoUser | null }) {
  const [state, setState] = useState(() => ({ ...createDemoState(), user }));

  if (state.user?.email !== user?.email || state.user?.role !== user?.role) {
    setState({ ...createDemoState(), user });
  }

  const reservedCents = reservedBalance(state);
  const value: DemoContextValue = {
    ...state,
    cards: demoCards,
    reservedCents,
    availableCents: state.totalCents - reservedCents,
    deposit: (cents) => setState(depositDemo(state, cents)),
    placeBid: (id, cents) => setState(bidDemo(state, id, cents)),
    createAuction: (input) => {
      if (state.user?.role !== 'auctioneer') {
        throw new Error('Entre como leiloeiro para criar um lote.');
      }

      const card = demoCards.find((item) => item.id === input.cardId);

      if (!card) {
        throw new Error('Selecione uma carta do catálogo.');
      }

      assertAmount(input.startingBidCents);
      assertAmount(input.incrementCents);

      const start = Date.parse(input.startsAt);
      const end = Date.parse(input.endsAt);

      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < Date.now() - 60000 ||
        end <= Math.max(start, Date.now())
      ) {
        throw new Error('Informe um início futuro e encerramento posterior ao início.');
      }

      const id = `demo-${crypto.randomUUID()}`;

      setState({
        ...state,
        auctions: [
          {
            id,
            card,
            status: start > Date.now() ? 'scheduled' : 'live',
            startingBidCents: input.startingBidCents,
            currentBidCents: input.startingBidCents,
            incrementCents: input.incrementCents,
            bidCount: 0,
            startsAt: new Date(start).toISOString(),
            endsAt: new Date(end).toISOString(),
            seller: 'Mesa HoloBid',
            mine: true,
            settlement: 'none',
            integrity: 'verified',
          },
          ...state.auctions,
        ],
      });

      return id;
    },
    cancelAuction: (id) => {
      const auction = state.auctions.find((item) => item.id === id);

      if (state.user?.role !== 'auctioneer' || !auction?.mine) {
        throw new Error('Somente o leiloeiro responsável pode cancelar.');
      }

      if (auction.bidCount > 0 || !['scheduled', 'live'].includes(auction.status)) {
        throw new Error('Somente lotes sem lances e ainda não encerrados podem ser cancelados.');
      }

      setState({
        ...state,
        auctions: state.auctions.map((item) =>
          item.id === id ? { ...item, status: 'cancelled' } : item,
        ),
      });
    },
    reset: () => setState({ ...createDemoState(), user }),
  };

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo() {
  const value = useContext(DemoContext);

  if (!value) {
    throw new Error('DemoProvider is required.');
  }

  return value;
}
