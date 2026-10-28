import { expect, test } from '@playwright/test';

test('keeps the landing independent and recovers from a failed route download', async ({
  page,
}) => {
  const routeChunk = /\/assets\/AuctionsView-[^/]+\.js$/;
  const routeRequests: string[] = [];

  page.on('request', (request) => {
    if (routeChunk.test(request.url())) {
      routeRequests.push(request.url());
    }
  });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Sua próxima carta começa com um lance.', exact: true }),
  ).toBeVisible();
  expect(routeRequests).toEqual([]);

  let failDownload!: () => void;
  const stalledDownload = new Promise<void>((resolve) => {
    failDownload = resolve;
  });

  await page.route(routeChunk, async (route) => {
    await stalledDownload;
    await route.abort('failed');
  });
  try {
    await page.goto('/auctions', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('status').filter({ hasText: 'Carregando leilões.' })).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'HoloBid, página inicial', exact: true }),
    ).toBeVisible();
    failDownload();
    await expect(
      page.getByRole('heading', { name: 'Não foi possível abrir esta página', exact: true }),
    ).toBeVisible();
    await page.unroute(routeChunk);

    const list = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/auctions?') &&
        response.request().method() === 'GET' &&
        response.status() === 200,
    );

    await page.getByRole('button', { name: 'Recarregar página', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Leilões de cartas', exact: true }),
    ).toBeVisible();
    await list;
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally {
    failDownload();
    await page.unroute(routeChunk);
  }
});
