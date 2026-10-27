import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { auctionStatus } from '../src/modules/auctions/auction.presenter';
import { AuctionCursorService } from '../src/modules/auctions/auction-cursor.service';

describe('Auction time and cursor boundaries', () => {
  it('treats the start as inclusive and the end as exclusive', () => {
    const startsAt = new Date('2030-01-01T00:00:00Z');
    const endsAt = new Date('2030-01-01T00:01:00Z');
    const auction = { lifecycle: 'OPEN' as const, startsAt, endsAt };

    expect(auctionStatus(auction, new Date(startsAt.getTime() - 1))).toBe('SCHEDULED');
    expect(auctionStatus(auction, startsAt)).toBe('LIVE');
    expect(auctionStatus(auction, new Date(endsAt.getTime() - 1))).toBe('LIVE');
    expect(auctionStatus(auction, endsAt)).toBe('ENDED');
    expect(auctionStatus({ ...auction, lifecycle: 'CANCELLED' }, endsAt)).toBe('CANCELLED');
  });
  it('signs keyset cursors and binds them to their filter', () => {
    const cursors = new AuctionCursorService(
      new ConfigService({ JWT_SECRET: Buffer.alloc(32, 7).toString('base64url') }),
    );
    const position = { id: randomUUID(), createdAt: new Date('2030-01-01T00:00:00.000Z') };
    const encoded = cursors.encode(position, 'LIVE');

    expect(cursors.decode(encoded, 'LIVE')).toEqual(position);
    expect(() => cursors.decode(encoded, 'ENDED')).toThrow();

    const [body, mac] = encoded.split('.');
    const changed = Buffer.from(
      JSON.stringify([1, 'auctions', 'LIVE', position.createdAt.toISOString(), randomUUID()]),
    ).toString('base64url');

    expect(() => cursors.decode(`${changed}.${mac}`, 'LIVE')).toThrow();
    expect(() => cursors.decode(`${body}.bad`, 'LIVE')).toThrow();
    expect(() => cursors.decode('x'.repeat(513))).toThrow();
  });
});
