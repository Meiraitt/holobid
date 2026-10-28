import { apiOrigin, bid, deposit, expect, publish, test } from './fixtures';

test('paints public room content before WebSocket connects and verifies missed bids before enabling actions', async ({
  journey,
}) => {
  const seller = await journey.actor('seller');
  const lot = await publish(seller.page);
  const a = await journey.actor();
  const b = await journey.actor();

  await deposit(a.page);
  await deposit(b.page);
  await b.page.goto(`/auctions/${lot.id}`);

  let releasedSocket = false;
  const bufferedFrames: (() => void)[] = [];

  // Delay delivery only: both the WebSocket server and HTTP endpoints are real.
  await a.page.routeWebSocket('**/socket.io/**', (socket) => {
    const server = socket.connectToServer();

    server.onMessage((message) => {
      if (releasedSocket) {
        socket.send(message);
      } else {
        bufferedFrames.push(() => socket.send(message));
      }
    });
  });

  let releaseVerification!: () => void;
  const verificationGate = new Promise<void>((resolve) => {
    releaseVerification = resolve;
  });
  let verificationStarted = false;
  let bidRequests = 0;
  let firstReadStarted = false;
  let releaseFirstRead!: () => void;
  const firstReadGate = new Promise<void>((resolve) => {
    releaseFirstRead = resolve;
  });
  const abortedReads: string[] = [];
  const detailUrl = `${apiOrigin}/api/v1/auctions/${lot.id}`;

  a.page.on('requestfailed', (request) => {
    if (request.url() === detailUrl) {
      abortedReads.push(request.failure()?.errorText ?? 'unknown');
    }
  });
  a.page.on('request', (request) => {
    if (request.url() === `${detailUrl}/bids` && request.method() === 'POST') {
      bidRequests++;
    }
  });
  await a.page.route(detailUrl, async (route) => {
    if (releasedSocket) {
      verificationStarted = true;
      await verificationGate;
    } else {
      firstReadStarted = true;
      await firstReadGate;
    }

    await route.continue();
  });

  try {
    await a.page.goto(`/auctions/${lot.id}`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => firstReadStarted).toBe(true);
    await expect(a.page.getByRole('button', { name: 'Sair da conta', exact: true })).toBeVisible();
    releaseFirstRead();
    await expect(a.page.getByRole('heading', { name: lot.title, exact: true })).toBeVisible();
    expect(abortedReads).toEqual([]);
    await expect(a.page.getByRole('img', { name: new RegExp(`^${lot.title},`) })).toBeVisible();
    await expect.poll(() => bufferedFrames.length).toBeGreaterThan(0);
    await expect(a.page.getByLabel('Seu lance (R$)', { exact: true })).toHaveCount(0);
    await expect(a.page.getByText('Atualizações ao vivo', { exact: true })).toHaveCount(0);

    // This bid occurs before A subscribes. The fresh HTTP read must discover it.
    await bid(b.page, '100,00');
    releasedSocket = true;
    bufferedFrames.splice(0).forEach((send) => send());
    await expect.poll(() => verificationStarted).toBe(true);
    await expect(a.page.getByLabel('Seu lance (R$)', { exact: true })).toBeDisabled();
    await expect(a.page.getByText('Atualizações ao vivo', { exact: true })).toHaveCount(0);
    expect(bidRequests).toBe(0);

    releaseVerification();
    await expect(a.page.getByRole('button', { name: /Usar mínimo.*110/ })).toBeVisible();
    await expect(a.page.getByLabel('Seu lance (R$)', { exact: true })).toBeEnabled();
    await bid(a.page, '110,00');
    await expect(b.page.getByText('Você foi superado', { exact: true })).toBeVisible();
    await expect.poll(() => journey.counters.auctionEvents).toBeGreaterThan(0);
    expect(bidRequests).toBe(1);

    await a.page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
    await expect(a.page.getByRole('heading', { name: lot.title, exact: true })).toBeVisible();
    await expect(a.page.getByLabel('Seu lance (R$)', { exact: true })).toHaveCount(0);
    await expect(a.page.getByText('Você está na liderança', { exact: true })).toHaveCount(0);
    await expect(
      a.page.getByRole('link', { name: 'Entrar para dar lance', exact: true }),
    ).toBeVisible();
  } finally {
    releasedSocket = true;
    bufferedFrames.splice(0).forEach((send) => send());
    releaseVerification();
    releaseFirstRead();
    await a.page.unroute(detailUrl);
  }
});
