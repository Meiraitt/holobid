import { Injectable } from '@nestjs/common';

import type { CatalogItem, CatalogPage } from '@holobid/contracts';

import { catalogUnavailable, itemNotFound, SourceError } from './catalog.errors';
import { CatalogCache } from './catalog-cache';
import { CatalogHttpService } from './catalog-http.service';
import { EXTERNAL_ID, mapCard, mapSummary } from './catalog-mapper';

type CardResult = { item: CatalogItem; fetchedAt: string };

@Injectable()
export class TCGdexCatalogAdapter {
  private readonly pages = new CatalogCache<CatalogPage>();

  private readonly cards = new CatalogCache<CardResult>();

  constructor(private readonly http: CatalogHttpService) {}

  async search(q: string, page: number, limit: number): Promise<CatalogPage> {
    const url = new URL('https://api.tcgdex.net/v2/en/cards');

    if (q) {
      url.searchParams.set('name', q);
    }

    url.searchParams.set('image', 'notnull:');
    url.searchParams.set('pagination:page', String(page));
    url.searchParams.set('pagination:itemsPerPage', String(limit));

    const cached = this.pages.get(url.href);

    if (cached) {
      return cached;
    }

    try {
      const result = await this.http.get(url.href, 'json');
      const raw: unknown = JSON.parse(result.bytes.toString('utf8'));

      if (!Array.isArray(raw) || raw.length > limit) {
        throw new SourceError();
      }

      const items = raw.flatMap((card) => {
        try {
          return [mapSummary(card)];
        } catch {
          return [];
        }
      });
      const data: CatalogPage = {
        items,
        page,
        hasMore: raw.length === limit,
        source: 'tcgdex',
        stale: false,
        fetchedAt: new Date().toISOString(),
      };

      this.pages.set(url.href, data);

      return data;
    } catch {
      throw catalogUnavailable();
    }
  }

  async detail(externalId: string): Promise<CardResult> {
    if (!EXTERNAL_ID.test(externalId)) {
      throw itemNotFound();
    }

    const cached = this.cards.get(externalId);

    if (cached) {
      return cached;
    }

    try {
      const result = await this.http.get(
        `https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(externalId)}`,
        'json',
      );
      const data = {
        item: mapCard(JSON.parse(result.bytes.toString('utf8')), externalId),
        fetchedAt: new Date().toISOString(),
      };

      this.cards.set(externalId, data);

      return data;
    } catch (error) {
      if (error instanceof SourceError && error.status === 404) {
        throw itemNotFound();
      }

      throw catalogUnavailable();
    }
  }
}
