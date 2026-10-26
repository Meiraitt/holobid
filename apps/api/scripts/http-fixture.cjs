/* global __dirname */
// Test-only preload for the compiled process. Never imported by application code.
const { readFileSync, appendFileSync } = require('node:fs');
const { join } = require('node:path');
const { URL } = require('node:url');
const process = require('node:process');
const { Buffer } = require('node:buffer');
if (process.env.HOLOBID_ISOLATED_DATABASE_TEST !== '1' || !process.env.HOLOBID_HTTP_CONTROL) throw new Error('Isolated HTTP runner required.');
const control = () => JSON.parse(readFileSync(process.env.HOLOBID_HTTP_CONTROL, 'utf8'));
const compiled = name => require(join(__dirname, '../dist', name));
const { AuctionClock } = compiled('modules/auctions/auction-clock.js');
AuctionClock.prototype.now = function () { const state = control(); return new Date(state.now ?? Date.now()); };
const originalFetch = globalThis.fetch;
globalThis.fetch = async function (input, options) {
  const url = new URL(input), state = control();
  if (!['api.tcgdex.net', 'assets.tcgdex.net'].includes(url.hostname)) throw new Error('Unexpected external test request.');
  appendFileSync(process.env.HOLOBID_HTTP_FETCH_LOG, JSON.stringify({ host: url.hostname, path: url.pathname, mode: state.provider }) + '\n');
  if (state.provider === 'live') return originalFetch(input, options);
  if (state.provider === 'offline') throw new TypeError('Simulated upstream unavailable');
  if (state.provider === 'timeout') return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  if (state.provider === '429') return new globalThis.Response('{}', { status: 429, headers: { 'content-type': 'application/json' } });
  if (state.provider === 'malformed') return new globalThis.Response('{broken', { headers: { 'content-type': 'application/json' } });
  if (url.hostname === 'assets.tcgdex.net') return new globalThis.Response(readFileSync(join(__dirname, '../fixtures/tcgdex/base1-58.webp')), { headers: { 'content-type': 'image/webp' } });
  if (url.pathname.endsWith('/cards')) return new globalThis.Response(JSON.stringify(url.searchParams.get('name')?.includes('empty') ? [] : [JSON.parse(readFileSync(join(__dirname, '../fixtures/tcgdex/base1-58.json'), 'utf8'))]), { headers: { 'content-type': 'application/json' } });
  const id = url.pathname.split('/').at(-1);
  if (!['base1-58', 'base1-4'].includes(id)) return new globalThis.Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  return new globalThis.Response(readFileSync(join(__dirname, `../fixtures/tcgdex/${id}.json`)), { headers: { 'content-type': 'application/json' } });
};
// Inject failure after SQL writes, so rollback is exercised through the real HTTP route.
const { BidsRepository } = compiled('modules/bids/bids.repository.js');
const accept = BidsRepository.prototype.accept;
BidsRepository.prototype.accept = async function (...args) {
  const result = await accept.apply(this, args);
  if (control().failBid) throw new Error('injected-private-database-secret');
  return result;
};
const { RealtimeRepository } = compiled('modules/realtime/realtime.repository.js');
const lot = RealtimeRepository.prototype.lot;
RealtimeRepository.prototype.lot = async function (...args) {
  if (control().failNotification) throw new Error('injected-private-notification-secret');
  return lot.apply(this, args);
};
// Buffer is explicitly imported so future test-only byte manipulation cannot depend on globals.
void Buffer;
