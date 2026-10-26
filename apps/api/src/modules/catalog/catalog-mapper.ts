import type { CatalogItem, CatalogItemSummary } from '@holobid/contracts';
import { SourceError } from './catalog.errors';
import { validateSourceUrl } from './catalog-http.service';

export const EXTERNAL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SourceError();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new SourceError();
  return value;
}
function optionalText(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim() && value.length <= max ? value : undefined;
}
export function mapSummary(value: unknown): CatalogItemSummary {
  const card = object(value);
  const externalId = text(card.id, 128);
  if (!EXTERNAL_ID.test(externalId)) throw new SourceError();
  const base = validateSourceUrl(text(card.image, 1024), 'image');
  if (base.search || base.pathname.endsWith('/')) throw new SourceError();
  return { externalId, source: 'tcgdex', language: 'en', title: text(card.name, 256),
    cardNumber: text(card.localId, 32), previewImageUrl: `${base.href}/low.webp` };
}
export function mapCard(value: unknown, requestedId: string): CatalogItem {
  const card = object(value);
  const summary = mapSummary(card);
  if (summary.externalId !== requestedId) throw new SourceError();
  const set = object(card.set);
  const category = card.category;
  if (category !== 'Pokemon' && category !== 'Trainer' && category !== 'Energy') throw new SourceError();
  const result: CatalogItem = { ...summary, setId: text(set.id, 128), setName: text(set.name, 256), category };
  for (const key of ['description', 'rarity', 'illustrator'] as const) {
    const value = optionalText(card[key], key === 'description' ? 4000 : 256);
    if (value !== undefined) result[key] = value;
  }
  if (typeof card.hp === 'number' && Number.isInteger(card.hp) && card.hp >= 0 && card.hp <= 100_000) result.hp = card.hp;
  if (Array.isArray(card.types) && card.types.length <= 10 && card.types.every(type => optionalText(type, 64))) result.types = card.types;
  return result;
}
