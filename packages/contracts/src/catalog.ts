export type CatalogItemSummary = {
  externalId: string;
  source: 'tcgdex';
  language: 'en';
  title: string;
  cardNumber: string;
  previewImageUrl: string;
};
export type CatalogItem = CatalogItemSummary & {
  setId: string;
  setName: string;
  category: 'Pokemon' | 'Trainer' | 'Energy';
  description?: string;
  rarity?: string;
  illustrator?: string;
  types?: string[];
  hp?: number;
};
export type CatalogPage = {
  items: CatalogItemSummary[];
  page: number;
  hasMore: boolean;
  source: 'tcgdex';
  stale: boolean;
  fetchedAt: string;
};
