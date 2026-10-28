import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import { parseArgs } from 'node:util';

import { chromium, expect as playwrightExpect } from '@playwright/test';

const { values } = parseArgs({
  options: { web: { type: 'string' }, 'allow-write': { type: 'boolean' } },
});

assert.ok(
  values.web && values['allow-write'],
  'Pass --web https://host --allow-write. This creates permanent demo users, simulated deposits and one auction.',
);

const web = new URL(values.web);
const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const backend = new URL(config.rewrites[0].destination).origin;

assert.equal(web.protocol, 'https:');
assert.equal(web.origin, values.web);

const output = resolve('apps/web/test-results/release');
const password = `Release-${randomUUID()}!`;
const browser = await chromium.launch({ args: ['--test-third-party-cookie-phaseout'] });
const contexts = [];
const report = {
  web: web.origin,
  checks: [],
  requests: 0,
  auctionEvents: 0,
  errors: [],
  responses: [],
};

mkdirSync(output, { recursive: true });

const expect = playwrightExpect.configure({ timeout: 30_000 });

async function step(name, run) {
  await run();
  report.checks.push(name);
  process.stdout.write(`PASS ${name}\n`);
}

async function actor(role) {
  const context = await browser.newContext({
    baseURL: web.origin,
    viewport: { width: 1440, height: 1000 },
    locale: 'pt-BR',
    timezoneId: 'UTC',
  });
  const page = await context.newPage();
  const email = `release-${randomUUID()}@holobid.test`;

  contexts.push(context);
  page.on('response', (response) => {
    if (response.url().includes('/api/v1/')) {
      report.responses.push({ path: new URL(response.url()).pathname, status: response.status() });
    }
  });
  page.on('pageerror', (error) => report.errors.push(error.message));
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/')) {
      report.requests++;
    }

    if (request.url().includes('/api/v1/auth/')) {
      assert.equal(new URL(request.url()).origin, web.origin, 'Auth stays same-origin.');
    }
  });
  page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      if (String(payload).includes('auction.updated')) {
        report.auctionEvents++;
      }
    });
  });
  if (role !== 'visitor') {
    const seller = role === 'seller';

    await page.goto(seller ? '/login' : '/register');
    await page
      .getByLabel('E-mail', { exact: true })
      .fill(seller ? 'auctioneer@demo.holobid.test' : email);
    await page.getByLabel('Senha', { exact: true }).fill(seller ? 'HoloBidDemo123!' : password);
    if (!seller) {
      await page.getByLabel('Confirmar senha', { exact: true }).fill(password);
    }

    await page
      .getByRole('button', { name: seller ? 'Entrar' : 'Criar conta', exact: true })
      .click();
    await expect(page.getByRole('button', { name: 'Sair da conta', exact: true })).toBeVisible();
  }

  return { page, context, email };
}

async function deposit(page) {
  await page.goto('/wallet');
  await page.getByRole('button', { name: 'Adicionar saldo simulado', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Valor (R$)', { exact: true }).fill('500,00');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Adicionar R/ })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Resumo do saldo')).toContainText('500,00');
}

async function bid(page, amount) {
  await expect(page.getByLabel('Seu lance (R$)', { exact: true })).toBeEnabled();
  await page.getByLabel('Seu lance (R$)', { exact: true }).fill(amount);
  await page.getByRole('button', { name: /^Dar lance/ }).click();
  await expect(page.getByText('Você está na liderança', { exact: true })).toBeVisible();
}

try {
  const seller = await actor('seller');
  const a = await actor('bidder');
  const b = await actor('bidder');
  const visitor = await actor('visitor');
  let lot;

  await step(
    'HTTPS registration/login, first-party Secure HttpOnly refresh and deep-link reload',
    async () => {
      const cookie = (await a.context.cookies()).find((value) => value.name === 'holobid_refresh');

      assert.ok(cookie?.secure);
      assert.ok(cookie.httpOnly);
      assert.equal(cookie.sameSite, 'Strict');
      assert.equal(cookie.domain, web.hostname);
      await a.page.goto('/wallet');
      await expect(a.page.getByRole('heading', { name: 'Carteira', exact: true })).toBeVisible();
      await a.page.reload();
      await expect(a.page.getByRole('heading', { name: 'Carteira', exact: true })).toBeVisible();
    },
  );
  await step('seller publishes a real TCGdex card with persisted media', async () => {
    await seller.page.goto('/auctions/new');
    await seller.page.getByLabel('Buscar carta', { exact: true }).fill('Pikachu');
    await seller.page
      .getByRole('group', { name: 'Cartas disponíveis' })
      .getByRole('button')
      .first()
      .click();
    await expect(
      seller.page.getByRole('complementary', { name: 'Revise seu leilão' }).getByRole('img'),
    ).toBeVisible();
    await seller.page.getByLabel('Lance inicial (R$)', { exact: true }).fill('100,00');
    await seller.page.getByLabel('Incremento mínimo (R$)', { exact: true }).fill('10,00');
    await seller.page
      .locator('#create-endsAt')
      .fill(new Date(Date.now() + 180_000).toISOString().slice(0, 16));
    await expect(seller.page.getByRole('button', { name: 'Publicar leilão' })).toBeEnabled();

    const response = seller.page.waitForResponse(
      (r) => r.url() === `${backend}/api/v1/auctions` && r.request().method() === 'POST',
    );

    await seller.page.getByRole('button', { name: 'Publicar leilão' }).click();

    const result = await response;

    assert.equal(result.status(), 201);
    lot = await result.json();
    report.auctionId = lot.id;
  });
  await step('simulated deposits, bid refusal, two-client live update and reconnect', async () => {
    await deposit(a.page);
    await deposit(b.page);
    await a.page.goto(`/auctions/${lot.id}`);
    await b.page.goto(`/auctions/${lot.id}`);

    const input = a.page.getByLabel('Seu lance (R$)', { exact: true });

    await expect(input).toBeEnabled();
    await input.fill('99,00');
    await a.page.getByRole('button', { name: /^Dar lance/ }).click();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toHaveValue('99,00');
    await bid(a.page, '100,00');
    await expect(b.page.getByRole('button', { name: /Usar mínimo.*110/ })).toBeVisible();
    await a.context.setOffline(true);
    await bid(b.page, '110,00');
    await a.context.setOffline(false);
    await expect(a.page.getByText('Você foi superado', { exact: true })).toBeVisible();
    await expect(a.page.getByText(/Reservado neste lote:\s*R\$\s*0,00$/)).toBeVisible();
    await a.page.goto('/wallet');
    await expect(a.page.getByLabel('Resumo do saldo')).toContainText('500,00');
  });
  process.stdout.write(
    'Waiting for the real server clock and settlement worker (up to 4 minutes).\n',
  );
  await step('real-time settlement, winner debit, public receipt and verified audit', async () => {
    await expect(b.page.getByText('Carta arrematada por você', { exact: true })).toBeVisible({
      timeout: 240_000,
    });
    await b.page.goto('/participations');
    await b.page.getByRole('button', { name: 'Arrematados', exact: true }).click();

    const receipt = b.page.getByRole('link', { name: /comprovante/i }).first();

    await expect(receipt).toBeVisible();

    const href = await receipt.getAttribute('href');

    assert.match(href, /^\/receipts\//);
    report.receiptPath = href;
    await visitor.page.goto(href);
    await expect(
      visitor.page.getByRole('heading', { name: 'Comprovante de arremate' }).first(),
    ).toBeVisible();
    await expect(visitor.page.getByRole('main')).toContainText('110,00');
    await expect(visitor.page.getByRole('main')).not.toContainText(b.email);
    await visitor.page.screenshot({ path: resolve(output, 'receipt.png'), fullPage: true });
    await visitor.page.goto(`/auctions/${lot.id}/audit`);
    await expect(visitor.page.getByRole('heading', { name: 'Histórico verificado' })).toBeVisible();
    await b.page.goto('/wallet');
    await expect(b.page.getByLabel('Resumo do saldo')).toContainText('390,00');
    await b.page.screenshot({ path: resolve(output, 'wallet.png'), fullPage: true });
  });
  await step('mouse logout, revoked session and guarded private deep link', async () => {
    const logout = a.page.waitForResponse(
      (response) => response.url() === `${web.origin}/api/v1/auth/logout`,
    );

    await a.page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
    assert.equal((await logout).status(), 204);
    await expect(a.page.getByRole('button', { name: 'Sair da conta', exact: true })).toHaveCount(0);
    await a.page.goto('/wallet');
    await expect(a.page).toHaveURL(/\/login/);
    await a.page.reload();
    await expect(a.page).toHaveURL(/\/login/);
    assert.equal(
      (await a.context.cookies()).filter((cookie) => cookie.name === 'holobid_refresh').length,
      0,
    );
  });
  assert.ok(report.auctionEvents > 0);
  assert.deepEqual(report.errors, []);
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.failure = error.message;
  for (const [index, context] of contexts.entries()) {
    await context
      .pages()[0]
      ?.screenshot({ path: resolve(output, `failure-${index}.png`), fullPage: true });
  }

  throw error;
} finally {
  writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
