export type WalletResponse = {
  totalCents: number;
  reservedCents: number;
  availableCents: number;
  version: number;
  serverTime: string;
};
export type DepositInput = { amountCents: number };
export type DepositResponse = { depositId: string; wallet: WalletResponse };
