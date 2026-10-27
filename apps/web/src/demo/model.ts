import type { DemoState } from './types';

export function reservedBalance(state: DemoState) {
  return state.auctions.reduce(
    (sum, auction) =>
      sum +
      (auction.participation === 'leading' && auction.status === 'live'
        ? (auction.myBidCents ?? 0)
        : 0),
    0,
  );
}

export function assertAmount(cents: number) {
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 100_000_000) {
    throw new Error('Informe um valor entre R$ 0,01 e R$ 1.000.000,00.');
  }
}

export function depositDemo(state: DemoState, cents: number): DemoState {
  if (state.user?.role !== 'bidder') {
    throw new Error('Entre como licitante para adicionar saldo.');
  }

  assertAmount(cents);
  if (state.totalCents + cents > 100_000_000) {
    throw new Error('O saldo máximo desta demonstração é R$ 1.000.000,00.');
  }

  return { ...state, totalCents: state.totalCents + cents };
}

export function bidDemo(
  state: DemoState,
  auctionId: string,
  cents: number,
  now = Date.now(),
): DemoState {
  if (state.user?.role !== 'bidder') {
    throw new Error('Entre como licitante para dar um lance.');
  }

  assertAmount(cents);

  const auction = state.auctions.find((item) => item.id === auctionId);

  if (!auction || auction.status !== 'live' || Date.parse(auction.endsAt) <= now) {
    throw new Error('Este lote não está recebendo lances.');
  }

  if (auction.participation === 'leading') {
    throw new Error('Você já está liderando este lote.');
  }

  const minimum =
    auction.bidCount === 0
      ? auction.startingBidCents
      : auction.currentBidCents + auction.incrementCents;

  if (cents < minimum) {
    throw new Error('O valor está abaixo do lance mínimo.');
  }

  if (cents > state.totalCents - reservedBalance(state)) {
    throw new Error('Saldo disponível insuficiente para este lance.');
  }

  return {
    ...state,
    auctions: state.auctions.map((item) =>
      item.id !== auctionId
        ? item
        : {
            ...item,
            currentBidCents: cents,
            myBidCents: cents,
            bidCount: item.bidCount + 1,
            position: 1,
            participation: 'leading',
            endsAt:
              Date.parse(item.endsAt) - now <= 120000
                ? new Date(now + 120000).toISOString()
                : item.endsAt,
          },
    ),
    bids: [
      {
        id: `demo-${now}`,
        auctionId,
        amountCents: cents,
        bidder: 'Você',
        at: new Date(now).toISOString(),
        isMine: true,
      },
      ...state.bids,
    ],
  };
}
