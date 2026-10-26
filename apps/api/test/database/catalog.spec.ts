import process from 'node:process';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/configure-app';
import { DatabaseService } from '../../src/database/database.service';
import { AuthRateLimiter } from '../../src/modules/auth/auth-rate-limiter';
import { CatalogHttpService } from '../../src/modules/catalog/catalog-http.service';
import { CatalogImportService } from '../../src/modules/catalog/catalog-import.service';
import { CatalogRepository } from '../../src/modules/catalog/catalog.repository';
import { SourceError } from '../../src/modules/catalog/catalog.errors';

if (process.env.HOLOBID_ISOLATED_DATABASE_TEST !== '1') throw new Error('Run npm run test:db.');
const fixtures = join(__dirname, '../../fixtures/tcgdex');
const card = JSON.parse(readFileSync(join(fixtures, 'base1-58.json'), 'utf8'));
const image = readFileSync(join(fixtures, 'base1-58.webp'));
const sha256 = createHash('sha256').update(image).digest('hex');
const list = JSON.parse(readFileSync(join(fixtures, 'list.json'), 'utf8'));
const origin = 'http://localhost:5173';

describe('Catalog authorization and persisted media', () => {
  let app: NestExpressApplication;
  let db: DatabaseService;
  let token: string;
  let source: { get: jest.Mock };
  async function boot() {
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CatalogHttpService).useValue(source).compile();
    app = module.createNestApplication<NestExpressApplication>({ logger: false }); configureApp(app); await app.init();
    db = app.get(DatabaseService); jest.spyOn(app.get(AuthRateLimiter), 'consume').mockReturnValue(null);
  }
  beforeEach(async () => {
    source = { get: jest.fn(async (url: string, kind: string) => kind === 'image'
      ? { bytes: image, mimeType: 'image/webp' }
      : { bytes: Buffer.from(JSON.stringify(url.includes('/cards/') ? card : list)), mimeType: 'application/json' }) };
    await boot(); token = await register('AUCTIONEER');
  });
  afterEach(async () => { await app.close(); });
  async function register(role: 'BIDDER' | 'AUCTIONEER') {
    const result = await request(app.getHttpServer()).post('/api/v1/auth/register').set('Origin', origin).set('X-CSRF-Protection', '1')
      .send({ email: `${randomUUID()}@example.test`, password: 'Catalog password 42!' }).expect(201);
    await db.client.user.update({ where: { id: result.body.user.id }, data: { role } });
    return result.body.accessToken as string;
  }
  function get(path = 'catalog/items') { return request(app.getHttpServer()).get(`/api/v1/${path}`).set('Authorization', `Bearer ${token}`); }
  async function persist() {
    const importer = app.get(CatalogImportService); const prepared = await importer.prepare(card.id);
    return db.transaction(tx => importer.persist(prepared, tx));
  }
  it('requires an auctioneer session, with no provider request for forbidden users', async () => {
    await get().unset('Authorization').expect(401);
    const bidder = await register('BIDDER'); await get().set('Authorization', `Bearer ${bidder}`).expect(403);
    await get(`catalog/items/${card.id}`).set('Authorization', `Bearer ${bidder}`).expect(403);
    expect(source.get).not.toHaveBeenCalled();
    const result = await get().query({ q: 'Pikachu', page: 1, limit: 2 }).expect(200);
    expect(result.body).toMatchObject({ page: 1, hasMore: true, source: 'tcgdex', stale: false }); expect(result.body.items).toHaveLength(2);
    expect(source.get).toHaveBeenCalledTimes(1);
    const detail = await get(`catalog/items/${card.id}`).expect(200);
    expect(detail.body).toMatchObject({ externalId: card.id, setName: 'Base Set', title: 'Pikachu' });
    expect(detail.headers['cache-control']).toBe('no-store'); expect(detail.body).not.toHaveProperty('image');
  });
  it('rejects invalid pagination, search types and IDs before provider access', async () => {
    for (const query of [{ limit: 21 }, { limit: 0 }, { page: 0 }, { page: 1.5 }, { page: '1e2' }, { page: 10001 }, { page: ['1', '2'] }, { q: 'x'.repeat(81) }, { q: ['a', 'b'] }, { language: 'pt' }]) {
      await get().query(query).expect(400);
    }
    await get('catalog/items/invalid@id').expect(400); expect(source.get).not.toHaveBeenCalled();
  });
  it('returns empty pages, a safe 503 on provider failure, and 404 for a missing card', async () => {
    source.get.mockResolvedValueOnce({ bytes: Buffer.from('[]'), mimeType: 'application/json' });
    expect((await get().expect(200)).body).toMatchObject({ items: [], hasMore: false });
    source.get.mockRejectedValueOnce(new SourceError(false, 404));
    await get('catalog/items/missing-card').expect(404).expect(({ body }) => expect(body.code).toBe('ITEM_NOT_FOUND'));
    source.get.mockRejectedValueOnce(new Error('Sensitive provider details'));
    const unavailable = await get().query({ page: 2 }).expect(503);
    expect(unavailable.body.code).toBe('CATALOG_UNAVAILABLE'); expect(JSON.stringify(unavailable.body)).not.toContain('Sensitive');
  });
  it('rate limits both catalog endpoints together, with readable CORS retry headers', async () => {
    for (let i = 0; i < 30; i++) await get().expect(200);
    const limited = await get(`catalog/items/${card.id}`).set('Origin', origin).expect(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.headers['access-control-expose-headers']).toContain('Retry-After');
    expect(source.get).toHaveBeenCalledTimes(1);
  });
  it('stores minimal snapshots and serves public bytes even after a restart and provider outage', async () => {
    const saved = await persist();
    const snapshot = await db.client.catalogSnapshot.findUniqueOrThrow({ where: { id: saved.snapshotId } });
    expect(snapshot).toMatchObject({ provider: 'TCGDEX', externalId: card.id, title: card.name, language: 'en', setName: 'Base Set' });
    expect(snapshot.attributes).toEqual({ category: 'Pokemon', rarity: 'Common', illustrator: 'Mitsuhiro Arita', hp: 40, types: ['Lightning'] });
    await app.close(); source.get.mockReset().mockRejectedValue(new Error('Provider offline')); await boot();
    const response = await get(`media/${saved.imageId}`).unset('Authorization').expect(200);
    expect(response.body).toEqual(image); expect(response.headers['content-type']).toBe('image/webp');
    expect(response.headers['content-length']).toBe(String(image.length)); expect(response.headers['etag']).toBe(`"${sha256}"`);
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable'); expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(source.get).not.toHaveBeenCalled();
    expect(await db.client.catalogSnapshot.findUnique({ where: { id: saved.snapshotId } })).toEqual(snapshot);
  });
  it('handles strong/weak ETag validators and absent media without network requests', async () => {
    const saved = await persist(); source.get.mockClear();
    for (const match of [`"${sha256}"`, `W/"${sha256}"`, `"other", W/"${sha256}"`, '*']) {
      const response = await get(`media/${saved.imageId}`).set('If-None-Match', match).expect(304); expect(response.text).toBe('');
    }
    await get(`media/${saved.imageId}`).set('If-None-Match', '"other"').expect(200);
    const missing = await get(`media/${randomUUID()}`).expect(404); expect(missing.headers['cache-control']).toBe('no-store');
    await get('media/not-a-uuid').expect(400); expect(source.get).not.toHaveBeenCalled();
    const cors = await request(app.getHttpServer()).options(`/api/v1/media/${saved.imageId}`).set('Origin', origin)
      .set('Access-Control-Request-Method', 'GET').set('Access-Control-Request-Headers', 'If-None-Match').expect(204);
    expect(cors.headers['access-control-allow-headers']).toContain('If-None-Match');
  });
  it('deduplicates concurrent image imports while keeping independent immutable snapshots', async () => {
    const importer = app.get(CatalogImportService); const prepared = await importer.prepare(card.id); source.get.mockClear();
    const results = await Promise.all(Array.from({ length: 3 }, () => db.transaction(tx => importer.persist(prepared, tx))));
    expect(new Set(results.map(result => result.imageId)).size).toBe(1); expect(new Set(results.map(result => result.snapshotId)).size).toBe(3);
    expect(await db.client.mediaAsset.count({ where: { sha256 } })).toBe(1); expect(source.get).not.toHaveBeenCalled();
  });
  it('rolls back the image if snapshot persistence fails', async () => {
    const charizard = JSON.parse(readFileSync(join(fixtures, 'base1-4.json'), 'utf8'));
    const bytes = readFileSync(join(fixtures, 'base1-4.webp'));
    source.get.mockImplementation(async (_url: string, kind: string) => kind === 'image' ? { bytes, mimeType: 'image/webp' }
      : { bytes: Buffer.from(JSON.stringify(charizard)), mimeType: 'application/json' });
    const importer = app.get(CatalogImportService); const prepared = await importer.prepare(charizard.id);
    const imagesBefore = await db.client.mediaAsset.count(); const snapshotsBefore = await db.client.catalogSnapshot.count();
    jest.spyOn(app.get(CatalogRepository), 'create').mockRejectedValueOnce(new Error('Injected snapshot failure'));
    await expect(db.transaction(tx => importer.persist(prepared, tx))).rejects.toThrow('Injected snapshot failure');
    expect(await db.client.mediaAsset.count()).toBe(imagesBefore); expect(await db.client.catalogSnapshot.count()).toBe(snapshotsBefore);
  });
  it('cannot prepare an incomplete publication when the CDN fails or bytes have the wrong signature', async () => {
    source.get.mockImplementation(async (_url: string, kind: string) => {
      if (kind === 'image') throw new SourceError(true, 503);
      return { bytes: Buffer.from(JSON.stringify(card)), mimeType: 'application/json' };
    });
    const importer = app.get(CatalogImportService); const count = await db.client.catalogSnapshot.count();
    await expect(importer.prepare(card.id)).rejects.toMatchObject({ code: 'CATALOG_UNAVAILABLE' });
    source.get.mockResolvedValueOnce({ bytes: Buffer.from('<svg>invalid image</svg>'), mimeType: 'image/webp' });
    await expect(importer.prepare(card.id)).rejects.toMatchObject({ code: 'CATALOG_UNAVAILABLE' });
    expect(await db.client.catalogSnapshot.count()).toBe(count);
  });
});
