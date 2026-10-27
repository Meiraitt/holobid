import type { WalletResponse } from '@holobid/contracts';

import { moneyToNumber } from '../../common/money';
import type { Wallet } from '../../generated/main/client';

export function presentWallet(wallet: Wallet, now = new Date()): WalletResponse {
  return {
    totalCents: moneyToNumber(wallet.totalCents),
    reservedCents: moneyToNumber(wallet.reservedCents),
    availableCents: moneyToNumber(wallet.totalCents - wallet.reservedCents),
    version: wallet.version,
    serverTime: now.toISOString(),
  };
}
