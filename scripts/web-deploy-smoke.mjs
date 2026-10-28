import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { URL } from 'node:url';
import { parseArgs } from 'node:util';

import { io } from 'socket.io-client';

const { values } = parseArgs({ options: { web: { type: 'string' } } });

assert.ok(values.web, 'Pass --web https://YOUR-PROJECT.vercel.app');

const web = new URL(values.web);

assert.equal(web.protocol, 'https:', 'The release check requires HTTPS.');
assert.equal(web.origin, values.web, 'Pass only the frontend origin, without a trailing slash.');

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const backend = new URL(config.rewrites[0].destination).origin;
let requests = 0;

async function request(url, status, options = {}) {
  const response = await globalThis.fetch(url, {
    ...options,
    headers: { Origin: web.origin, ...options.headers },
    redirect: 'error',
    signal: globalThis.AbortSignal.timeout(20_000),
  });

  requests++;
  assert.equal(response.status, status, `${options.method ?? 'GET'} ${new URL(url).pathname}`);

  return response;
}

const catalogResponse = await request(`${backend}/api/v1/auctions?limit=1`, 200);

assert.equal(catalogResponse.headers.get('access-control-allow-origin'), web.origin);

const catalog = await catalogResponse.json();
const auctionId = catalog.items[0]?.id ?? '00000000-0000-4000-8000-000000000000';

for (const path of [
  '/',
  '/wallet',
  '/participations',
  `/auctions/${auctionId}`,
  `/auctions/${auctionId}/audit`,
  '/receipts/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
]) {
  const response = await request(`${web.origin}${path}`, 200);
  const html = await response.text();

  assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  assert.match(html, /id="root"/, `SPA shell at ${path}`);
  if (path === '/') {
    const scriptPath = html.match(/<script[^>]+src="([^"]+)"/)?.[1];

    assert.ok(scriptPath, 'Built JavaScript entry is present.');

    const asset = new URL(scriptPath, web);

    assert.equal(asset.origin, web.origin);

    const script = await request(asset, 200);

    assert.match(script.headers.get('content-type') ?? '', /javascript/);
  }
}

await request(`${web.origin}/assets/missing-release-check.js`, 404);
await request(`${web.origin}/api/missing-release-check`, 404);

const refresh = await request(`${web.origin}/api/v1/auth/refresh`, 401, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' },
  body: '{}',
});
const problem = await refresh.json();

assert.ok(problem.code && problem.requestId, 'Auth rewrite returns an API error, not SPA HTML.');
assert.match(refresh.headers.get('cache-control') ?? '', /no-store/);

const preflight = await request(`${backend}/api/v1/wallet`, 204, {
  method: 'OPTIONS',
  headers: {
    'Access-Control-Request-Method': 'GET',
    'Access-Control-Request-Headers': 'authorization',
  },
});

assert.equal(preflight.headers.get('access-control-allow-origin'), web.origin);
assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /authorization/i);

const socket = io(backend, {
  autoConnect: false,
  transports: ['websocket'],
  reconnection: false,
  timeout: 15_000,
  extraHeaders: { Origin: web.origin },
});

try {
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
    socket.connect();
  });
  if (catalog.items.length) {
    const ack = await socket.timeout(5000).emitWithAck('auction.subscribe', { auctionId });

    assert.equal(ack.ok, true, 'Public room subscription acknowledged.');
  }

  process.stdout.write(
    `PASS: ${requests} real HTTPS requests, SPA deep links, uncached auth proxy, exact CORS and anonymous WebSocket.\nAuthenticated cookies and financial/browser journeys still require the release acceptance.\n`,
  );
} finally {
  socket.disconnect();
}
