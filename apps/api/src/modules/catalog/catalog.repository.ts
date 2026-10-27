import { Injectable } from '@nestjs/common';

import type { CatalogItem } from '@holobid/contracts';

import type { TransactionContext } from '../../database/database.service';

@Injectable()
export class CatalogRepository {
  create(item: CatalogItem, fetchedAt: string, tx: TransactionContext) {
    const { category, rarity, illustrator, types, hp } = item;

    return tx.catalogSnapshot.create({
      data: {
        provider: 'TCGDEX',
        externalId: item.externalId,
        language: item.language,
        title: item.title,
        description: item.description,
        setId: item.setId,
        setName: item.setName,
        cardNumber: item.cardNumber,
        fetchedAt: new Date(fetchedAt),
        attributes: {
          category,
          ...(rarity !== undefined ? { rarity } : {}),
          ...(illustrator !== undefined ? { illustrator } : {}),
          ...(types !== undefined ? { types } : {}),
          ...(hp !== undefined ? { hp } : {}),
        },
      },
    });
  }
}
