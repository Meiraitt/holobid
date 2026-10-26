import type { MyAuctionState } from '@holobid/contracts';
import { moneyToNumber } from '../../common/money';
import { auctionStatus } from '../auctions/auction.presenter';
import type { AccountAuction, RankedBid } from './accounts.repository';

export function presentMyAuction(lot: AccountAuction, userId: string, pseudonym: string, ranks: RankedBid[], reserved: bigint, now: Date): MyAuctionState {
  const participants = ranks.filter(row => row.auctionId === lot.id);
  const highest = participants.find(row => row.bidderId === userId)?._max.amountCents ?? null;
  const leading = highest !== null && lot.currentBid?.bidderId === userId;
  const ended = auctionStatus(lot, now) === 'ENDED';
  const settled = ended && lot.settlementStatus === 'COMPLETED';
  const receiptCode = settled && leading ? lot.receipt?.publicCode ?? null : null;
  let state: MyAuctionState['state'] = 'NOT_PARTICIPATING';
  if (highest !== null) {
    if (!ended) state = leading ? 'LEADING' : 'OUTBID';
    else if (!settled || (leading && !receiptCode)) state = 'PROCESSING';
    else state = leading ? 'WON' : 'LOST';
  }
  return { auctionId: lot.id, myPseudonym: pseudonym, rank: highest === null ? null : 1 + participants.filter(row => row._max.amountCents! > highest).length,
    highestBidCents: highest === null ? null : moneyToNumber(highest), isLeading: leading, hasParticipated: highest !== null,
    reservedForThisAuctionCents: moneyToNumber(reserved), receiptCode, state, settlementStatus: lot.settlementStatus };
}
