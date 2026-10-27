import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SourceError } from '../src/modules/catalog/catalog.errors';
import { CatalogCache } from '../src/modules/catalog/catalog-cache';
import { CatalogHttpService, MAX_IMAGE_BYTES } from '../src/modules/catalog/catalog-http.service';
import { mapCard, mapSummary } from '../src/modules/catalog/catalog-mapper';
import { TCGdexCatalogAdapter } from '../src/modules/catalog/tcgdex-catalog.adapter';
import { validateImage } from '../src/modules/media/image-validation';

const fixtures = join(__dirname, '../fixtures/tcgdex');
const card = JSON.parse(readFileSync(join(fixtures, 'base1-58.json'), 'utf8'));
const brief = JSON.parse(readFileSync(join(fixtures, 'list.json'), 'utf8'));
const image = readFileSync(join(fixtures, 'base1-58.webp'));
const endpoint = 'https://api.tcgdex.net/v2/en/cards/base1-58';
const imageUrl = `${card.image}/high.webp`;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('TCGdex HTTP boundary', () => {
  let http: CatalogHttpService;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    http = new CatalogHttpService();
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });
  it('reads bounded JSON and images with a manual redirect policy and deadline', async () => {
    fetchMock.mockResolvedValueOnce(json(card));

    const result = await http.get(endpoint, 'json');

    expect(JSON.parse(result.bytes.toString())).toEqual(card);

    const options = fetchMock.mock.calls[0]![1]!;

    expect(options.redirect).toBe('manual');
    expect(options.signal).toBeInstanceOf(AbortSignal);
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array(image), { headers: { 'Content-Type': 'image/webp' } }),
    );
    expect((await http.get(imageUrl, 'image')).bytes).toEqual(image);
  });
  it.each([429, 500, 503])('retries a transient %i once', async (status) => {
    fetchMock.mockResolvedValueOnce(json({}, status)).mockResolvedValueOnce(json(card));
    await http.get(endpoint, 'json');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('stops after two network failures', async () => {
    fetchMock.mockRejectedValue(new TypeError('Private network diagnostic'));
    await expect(http.get(endpoint, 'json')).rejects.toMatchObject({ retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('does not retry a missing item', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 404));
    await expect(http.get(endpoint, 'json')).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([
    'http://assets.tcgdex.net/a',
    'https://evil.example/a',
    'https://assets.tcgdex.net.evil.example/a',
    'https://name:secret@assets.tcgdex.net/a',
    'https://assets.tcgdex.net:444/a',
    'https://127.0.0.1/a',
    'https://assets.tcgdex.net/a#fragment',
    'file:///etc/passwd',
  ])('rejects an unsafe source URL %s before fetching', async (url) => {
    await expect(http.get(url, 'image')).rejects.toBeInstanceOf(SourceError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('validates every redirect and follows only bounded same-host redirects', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: '/v2/en/cards/base1-58' } }),
      )
      .mockResolvedValueOnce(json(card));
    await http.get(endpoint, 'json');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock
      .mockClear()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }),
      );
    await expect(http.get(endpoint, 'json')).rejects.toBeInstanceOf(SourceError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock
      .mockClear()
      .mockImplementation(
        async () => new Response(null, { status: 302, headers: { location: endpoint } }),
      );
    await expect(http.get(endpoint, 'json')).rejects.toBeInstanceOf(SourceError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('rejects unsupported MIME and oversized declared bodies without retrying', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } }),
    );
    await expect(http.get(imageUrl, 'image')).rejects.toBeInstanceOf(SourceError);
    fetchMock.mockResolvedValueOnce(
      new Response('tiny', {
        headers: { 'Content-Type': 'image/webp', 'Content-Length': String(MAX_IMAGE_BYTES + 1) },
      }),
    );
    await expect(http.get(imageUrl, 'image')).rejects.toBeInstanceOf(SourceError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('enforces streaming limits without trusting Content-Length', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array(MAX_IMAGE_BYTES + 1), {
        headers: { 'Content-Type': 'image/webp' },
      }),
    );
    await expect(http.get(imageUrl, 'image')).rejects.toBeInstanceOf(SourceError);
    fetchMock.mockResolvedValueOnce(
      new Response('a'.repeat(512 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } }),
    );
    await expect(http.get(endpoint, 'json')).rejects.toBeInstanceOf(SourceError);
  });
  it('aborts a stalled response body using the same five-second request deadline', async () => {
    const deadline = jest.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const controller = new AbortController();

      setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), 5);

      return controller.signal;
    });

    fetchMock.mockImplementation(
      async (_url, options) =>
        new Response(
          new ReadableStream({
            start(controller) {
              options!.signal!.addEventListener('abort', () =>
                controller.error(options!.signal!.reason),
              );
            },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    );
    await expect(http.get(endpoint, 'json')).rejects.toBeInstanceOf(SourceError);
    expect(deadline).toHaveBeenCalledWith(5000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('Catalog mapping and cache', () => {
  it('preserves edition IDs, optional fields and supported card categories without exposing prices', () => {
    const mapped = mapCard({ ...card, pricing: { secret: 1 }, arbitrary: 'ignored' }, card.id);

    expect(mapped).toMatchObject({
      externalId: 'base1-58',
      title: 'Pikachu',
      setId: 'base1',
      cardNumber: '58',
      hp: 40,
    });
    expect(mapped).not.toHaveProperty('pricing');
    expect(mapped).not.toHaveProperty('arbitrary');

    const other = mapSummary({ ...card, id: 'basep-1' });

    expect(other.title).toBe(mapped.title);
    expect(other.externalId).not.toBe(mapped.externalId);
    for (const category of ['Pokemon', 'Trainer', 'Energy']) {
      const minimal = mapCard(
        {
          ...card,
          category,
          rarity: null,
          description: undefined,
          illustrator: null,
          hp: undefined,
          types: undefined,
        },
        card.id,
      );

      expect(minimal.category).toBe(category);
      expect(minimal).not.toHaveProperty('rarity');
      expect(minimal).not.toHaveProperty('description');
    }
  });
  it.each([
    { image: undefined },
    { image: 'https://evil.example/a' },
    { name: '' },
    { localId: undefined },
    { set: {} },
    { category: 'Vehicle' },
    { id: 'other-id' },
  ])('rejects incomplete or unrelated cards %j', (change) => {
    expect(() => mapCard({ ...card, ...change }, card.id)).toThrow(SourceError);
  });
  it('validates actual image bytes and detects MIME mismatches and truncation', () => {
    expect(() => validateImage(image, 'image/webp')).not.toThrow();
    expect(() => validateImage(image, 'image/png')).toThrow();
    expect(() => validateImage(image.subarray(0, 100), 'image/webp')).toThrow();
    expect(() => validateImage(Buffer.from('<svg>not a bitmap</svg>'), 'image/webp')).toThrow();

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5V8AAAAASUVORK5CYII=',
      'base64',
    );

    expect(() => validateImage(png, 'image/png')).not.toThrow();
  });
  it('evicts entries at capacity and never returns expired data', () => {
    const cache = new CatalogCache<string>(100, 2);

    cache.set('a', 'one', 0);
    cache.set('b', 'two', 0);
    cache.set('c', 'three', 1);
    expect(cache.get('a', 2)).toBeUndefined();
    expect(cache.get('b', 2)).toBe('two');
    expect(cache.get('b', 100)).toBeUndefined();
  });
  it('uses one paginated list request, skips unusable cards and caches successful responses', async () => {
    const http = new CatalogHttpService();
    const get = jest.spyOn(http, 'get').mockResolvedValue({
      bytes: Buffer.from(JSON.stringify([brief[0], { id: 'missing-image' }])),
      mimeType: 'application/json',
    });
    const adapter = new TCGdexCatalogAdapter(http);
    const first = await adapter.search('Pikachu & friends', 2, 2);

    expect(first.items).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    expect(first.stale).toBe(false);
    expect(await adapter.search('Pikachu & friends', 2, 2)).toBe(first);
    expect(get).toHaveBeenCalledTimes(1);

    const url = new URL(get.mock.calls[0]![0]);

    expect(url.searchParams.get('name')).toBe('Pikachu & friends');
    expect(url.searchParams.get('pagination:page')).toBe('2');
    expect(url.searchParams.get('pagination:itemsPerPage')).toBe('2');
    expect(url.searchParams.get('image')).toBe('notnull:');
    get.mockResolvedValueOnce({ bytes: Buffer.from('[]'), mimeType: 'application/json' });
    expect(await adapter.search('', 100, 20)).toMatchObject({
      items: [],
      page: 100,
      hasMore: false,
    });
  });
  it('maps missing cards to 404 and upstream/format failures to a sanitized 503', async () => {
    const http = new CatalogHttpService();
    const get = jest.spyOn(http, 'get');
    const adapter = new TCGdexCatalogAdapter(http);

    get.mockRejectedValueOnce(new SourceError(false, 404));
    await expect(adapter.detail('missing')).rejects.toMatchObject({
      code: 'ITEM_NOT_FOUND',
      status: 404,
    });
    get.mockResolvedValueOnce({ bytes: Buffer.from('not json'), mimeType: 'application/json' });
    await expect(adapter.search('', 1, 20)).rejects.toMatchObject({
      code: 'CATALOG_UNAVAILABLE',
      status: 503,
    });
    get.mockResolvedValueOnce({ bytes: Buffer.from('{}'), mimeType: 'application/json' });
    await expect(adapter.search('', 1, 20)).rejects.toMatchObject({ code: 'CATALOG_UNAVAILABLE' });
    get.mockRejectedValueOnce(new Error('Private internal diagnostics'));
    await expect(adapter.detail(card.id)).rejects.toMatchObject({
      message: 'The card catalog is temporarily unavailable.',
    });
  });
  it('refetches after five minutes and does not serve expired details during an outage', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const http = new CatalogHttpService();
    const get = jest.spyOn(http, 'get').mockResolvedValue({
      bytes: Buffer.from(JSON.stringify(card)),
      mimeType: 'application/json',
    });
    const adapter = new TCGdexCatalogAdapter(http);
    const first = await adapter.detail(card.id);

    expect(await adapter.detail(card.id)).toBe(first);
    expect(get).toHaveBeenCalledTimes(1);
    now.mockReturnValue(301_000);
    get.mockRejectedValueOnce(new SourceError());
    await expect(adapter.detail(card.id)).rejects.toMatchObject({ code: 'CATALOG_UNAVAILABLE' });
    expect(get).toHaveBeenCalledTimes(2);
  });
});
