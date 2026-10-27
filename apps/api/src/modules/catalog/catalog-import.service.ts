import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { CatalogItem } from '@holobid/contracts';

import type { TransactionContext } from '../../database/database.service';
import { validateImage } from '../media/image-validation';
import type { PreparedImage } from '../media/media.repository';
import { MediaRepository } from '../media/media.repository';

import { catalogUnavailable } from './catalog.errors';
import { CatalogRepository } from './catalog.repository';
import { CatalogHttpService } from './catalog-http.service';
import { TCGdexCatalogAdapter } from './tcgdex-catalog.adapter';

type PreparedCard = { item: CatalogItem; fetchedAt: string; image: PreparedImage };

@Injectable()
export class CatalogImportService {
  constructor(
    private readonly catalog: TCGdexCatalogAdapter,
    private readonly http: CatalogHttpService,
    private readonly snapshots: CatalogRepository,
    private readonly media: MediaRepository,
  ) {}

  // Fetch before starting a caller-owned transaction. No client metadata is accepted.
  async prepare(externalId: string): Promise<PreparedCard> {
    const card = await this.catalog.detail(externalId);

    try {
      const imageUrl = card.item.previewImageUrl.replace(/\/low\.webp$/, '/high.webp');
      const { bytes, mimeType } = await this.http.get(imageUrl, 'image');

      validateImage(bytes, mimeType);

      return {
        ...card,
        image: { bytes, mimeType, sha256: createHash('sha256').update(bytes).digest('hex') },
      };
    } catch {
      throw catalogUnavailable();
    }
  }

  async persist(prepared: PreparedCard, tx: TransactionContext) {
    const image = await this.media.store(prepared.image, tx);
    const snapshot = await this.snapshots.create(prepared.item, prepared.fetchedAt, tx);

    return { snapshotId: snapshot.id, imageId: image.id };
  }
}
