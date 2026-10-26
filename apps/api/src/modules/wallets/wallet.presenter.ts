import type { WalletResponse } from '@holobid/contracts';
import type { Wallet } from '../../generated/main/client';
import { moneyToNumber } from '../../common/money';
export function presentWallet(wallet: Wallet, now = new Date()): WalletResponse {
  return { totalCents: moneyToNumber(wallet.totalCents), reservedCents: moneyToNumber(wallet.reservedCents),
    availableCents: moneyToNumber(wallet.totalCents - wallet.reservedCents), version: wallet.version, serverTime: now.toISOString() };
}
