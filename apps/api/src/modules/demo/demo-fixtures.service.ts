import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { mapCard } from '../catalog/catalog-mapper';
import { validateImage } from '../media/image-validation';
@Injectable()
export class DemoFixtures {
  prepare(id: 'base1-58' | 'base1-4') {
    const root = join(__dirname, '../../../fixtures/tcgdex');
    const provenance = JSON.parse(readFileSync(join(root, 'provenance.json'), 'utf8')) as { fetchedAt: string; cards: Array<{ id: string; sha256: string }> };
    const item = mapCard(JSON.parse(readFileSync(join(root, `${id}.json`), 'utf8')), id), bytes = readFileSync(join(root, `${id}.webp`));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (provenance.cards.find(card => card.id === id)?.sha256 !== sha256) throw new Error('Demo fixture checksum mismatch.');
    validateImage(bytes, 'image/webp');
    return { item, fetchedAt: provenance.fetchedAt, image: { bytes, mimeType: 'image/webp', sha256 } };
  }
}
