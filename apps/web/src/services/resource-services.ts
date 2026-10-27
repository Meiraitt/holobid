import type {
  AuctionDetail,
  AuctioneerSummary,
  AuctionPage,
  AuctionPublicationPending,
  AuctionStatus,
  BidHistory,
  BidInput,
  BidPending,
  BidResult,
  CatalogItem,
  CatalogPage,
  CreateAuctionInput,
  DepositInput,
  DepositResponse,
  MyAuctionState,
  OwnedAuctionDetail,
  OwnedAuctionPage,
  ParticipationPage,
  PublicAudit,
  PublicReceipt,
  WalletResponse,
} from '@holobid/contracts';

import type { ApiClient } from './api-client';
import type { Operation } from './operations';

type Page = { cursor?: string; limit?: number };

function query(input: object) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }

  return params.size ? `?${params}` : '';
}

export function resourceServices(client: ApiClient) {
  const get = async <T>(path: string, authenticated = false, signal?: AbortSignal) =>
    (await client.request<T>(path, { authenticated, signal })).data;
  const post = <T>(path: string, operation: Operation<object>) =>
    client.request<T>(path, {
      method: 'POST',
      authenticated: true,
      body: operation.input,
      idempotencyKey: operation.key,
    });
  const auctionPath = (id: string) => `/auctions/${encodeURIComponent(id)}`;

  return {
    auctions: {
      list: (
        input: Page & { status?: Exclude<AuctionStatus, 'CANCELLED'> } = {},
        signal?: AbortSignal,
      ) => get<AuctionPage>(`/auctions${query(input)}`, false, signal),
      detail: (id: string, signal?: AbortSignal) =>
        get<AuctionDetail>(auctionPath(id), false, signal),
      create: (operation: Operation<CreateAuctionInput>) =>
        post<AuctionDetail | AuctionPublicationPending>('/auctions', operation),
      cancel: (id: string, operation: Operation<Record<string, never>>) =>
        post<OwnedAuctionDetail>(`${auctionPath(id)}/cancel`, operation),
      bid: (id: string, operation: Operation<BidInput>) =>
        post<BidResult | BidPending>(`${auctionPath(id)}/bids`, operation),
      bids: (id: string, page: Page = {}, signal?: AbortSignal) =>
        get<BidHistory>(`${auctionPath(id)}/bids${query(page)}`, false, signal),
      audit: (id: string, page: Page = {}, signal?: AbortSignal) =>
        get<PublicAudit>(`${auctionPath(id)}/audit${query(page)}`, false, signal),
      mine: (id: string, signal?: AbortSignal) =>
        get<MyAuctionState>(`${auctionPath(id)}/me`, true, signal),
    },
    catalog: {
      search: (input: { q?: string; page?: number; limit?: number } = {}, signal?: AbortSignal) =>
        get<CatalogPage>(`/catalog/items${query(input)}`, true, signal),
      detail: (id: string, signal?: AbortSignal) =>
        get<CatalogItem>(`/catalog/items/${encodeURIComponent(id)}`, true, signal),
    },
    wallet: {
      get: (signal?: AbortSignal) => get<WalletResponse>('/wallet', true, signal),
      deposit: (operation: Operation<DepositInput>) =>
        post<DepositResponse>('/wallet/deposits', operation),
    },
    account: {
      participations: (
        input: Page & { filter?: 'all' | 'active' | 'won' } = {},
        signal?: AbortSignal,
      ) => get<ParticipationPage>(`/me/participations${query(input)}`, true, signal),
      auctions: (input: Page & { status?: AuctionStatus } = {}, signal?: AbortSignal) =>
        get<OwnedAuctionPage>(`/auctioneer/auctions${query(input)}`, true, signal),
      summary: (signal?: AbortSignal) =>
        get<AuctioneerSummary>('/auctioneer/summary', true, signal),
    },
    receipt: (code: string, signal?: AbortSignal) =>
      get<PublicReceipt>(`/receipts/${encodeURIComponent(code)}`, false, signal),
  };
}
