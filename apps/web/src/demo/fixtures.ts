import type { DemoAuction, DemoCard, DemoState } from './types';

export const demoCards: DemoCard[] = [
  {
    id: 'base1-4',
    name: 'Charizard',
    edition: 'Base Set',
    number: '4',
    rarity: 'Rare',
    image: '/cards/charizard.webp',
    types: ['Fire'],
    hp: 120,
    illustrator: 'Mitsuhiro Arita',
  },
  {
    id: 'base1-58',
    name: 'Pikachu',
    edition: 'Base Set',
    number: '58',
    rarity: 'Common',
    image: '/cards/pikachu.webp',
    types: ['Lightning'],
    hp: 40,
    illustrator: 'Mitsuhiro Arita',
  },
  {
    id: 'base1-2',
    name: 'Blastoise',
    edition: 'Base Set',
    number: '2',
    rarity: 'Rare',
    image: '/cards/blastoise.webp',
    types: ['Water'],
    hp: 100,
    illustrator: 'Ken Sugimori',
  },
  {
    id: 'base1-15',
    name: 'Venusaur',
    edition: 'Base Set',
    number: '15',
    rarity: 'Rare',
    image: '/cards/venusaur.webp',
    types: ['Grass'],
    hp: 100,
    illustrator: 'Mitsuhiro Arita',
  },
];

export function createDemoState(now = Date.now()): DemoState {
  const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
  const make = (id: string, cardIndex: number, patch: Partial<DemoAuction>): DemoAuction => ({
    id,
    card: demoCards[cardIndex]!,
    status: 'live',
    startingBidCents: 10000,
    currentBidCents: 38000,
    incrementCents: 2000,
    bidCount: 12,
    startsAt: at(-180),
    endsAt: at(18),
    seller: 'Mesa HoloBid',
    mine: false,
    settlement: 'none',
    integrity: 'verified',
    ...patch,
  });
  const auctions: DemoAuction[] = [
    make('charizard-live', 0, {
      myBidCents: 36000,
      position: 2,
      participation: 'outbid',
      endsAt: at(4),
      mine: true,
    }),
    make('pikachu-live', 1, {
      currentBidCents: 25000,
      myBidCents: 25000,
      position: 1,
      participation: 'leading',
      bidCount: 7,
      endsAt: at(42),
      incrementCents: 1000,
    }),
    make('blastoise-live', 2, {
      currentBidCents: 105000,
      bidCount: 18,
      endsAt: at(80),
      incrementCents: 5000,
    }),
    make('venusaur-live', 3, {
      currentBidCents: 50000,
      bidCount: 5,
      endsAt: at(110),
      startingBidCents: 30000,
    }),
    make('pikachu-second', 1, {
      currentBidCents: 8500,
      startingBidCents: 5000,
      incrementCents: 500,
      bidCount: 8,
      endsAt: at(240),
    }),
    make('venusaur-scheduled', 3, {
      status: 'scheduled',
      bidCount: 0,
      currentBidCents: 30000,
      startingBidCents: 30000,
      startsAt: at(120),
      endsAt: at(1440),
      mine: true,
    }),
    make('pikachu-scheduled', 1, {
      status: 'scheduled',
      bidCount: 0,
      currentBidCents: 5000,
      startingBidCents: 5000,
      startsAt: at(240),
      endsAt: at(2880),
      incrementCents: 500,
      mine: true,
    }),
    make('charizard-won', 0, {
      status: 'ended',
      currentBidCents: 65000,
      myBidCents: 65000,
      position: 1,
      participation: 'won',
      endsAt: at(-50),
      settlement: 'settled',
      receiptId: 'HB-2026-001',
    }),
    make('pikachu-lost', 1, {
      status: 'ended',
      currentBidCents: 18000,
      myBidCents: 16000,
      position: 2,
      participation: 'lost',
      endsAt: at(-180),
      settlement: 'settled',
      receiptId: 'HB-2026-002',
      mine: true,
    }),
    make('blastoise-pending', 2, {
      status: 'ended',
      currentBidCents: 80000,
      endsAt: at(-5),
      settlement: 'pending',
      integrity: 'pending',
      receiptId: 'HB-2026-003',
      mine: true,
    }),
    make('venusaur-cancelled', 3, {
      status: 'cancelled',
      bidCount: 0,
      currentBidCents: 20000,
      startingBidCents: 20000,
      endsAt: at(-300),
      mine: true,
    }),
    make('charizard-review', 0, {
      status: 'ended',
      currentBidCents: 72000,
      endsAt: at(-1400),
      settlement: 'failed',
      integrity: 'tampered',
      receiptId: 'HB-2026-004',
      mine: true,
    }),
  ];

  for (const auction of auctions) {
    if (Date.parse(auction.startsAt) >= Date.parse(auction.endsAt)) {
      auction.startsAt = new Date(Date.parse(auction.endsAt) - 180 * 60000).toISOString();
    }

    auction.bidCount = Math.min(
      auction.bidCount,
      Math.floor((auction.currentBidCents - auction.startingBidCents) / auction.incrementCents) + 1,
    );
  }

  const bids = auctions.flatMap((auction) =>
    Array.from({ length: auction.bidCount }, (_, index) => {
      const isMine = !!auction.myBidCents && index === (auction.position === 1 ? 0 : 1);
      const lastBid = Math.min(now - 60000, Date.parse(auction.endsAt) - 60000);

      return {
        id: `${auction.id}-bid-${index}`,
        auctionId: auction.id,
        amountCents: auction.currentBidCents - index * auction.incrementCents,
        bidder: isMine ? 'Você' : index % 2 ? 'Lic. C41A' : 'Lic. 8FD2',
        at: new Date(lastBid - index * 60000).toISOString(),
        isMine,
      };
    }),
  );

  return {
    user: { name: 'Marina', email: 'marina@example.test', role: 'bidder' },
    auctions,
    bids,
    totalCents: 125000,
  };
}
