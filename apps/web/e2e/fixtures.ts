import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import AxeBuilder from '@axe-core/playwright';
import { type BrowserContext, expect, type Page, test as base } from '@playwright/test';
import pg from 'pg';

import type { AuctionDetail } from '@holobid/contracts';

export const apiOrigin = process.env.VITE_API_URL!;

const password = 'Browser-Journey-2026!';

export function configure(patch: object) {
  const path = process.env.HOLOBID_HTTP_CONTROL!;

  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), ...patch }));
}

export async function accessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();

  expect(results.violations).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'No horizontal page overflow',
  ).toBe(true);
}

export async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export async function deposit(page: Page, amount = '500,00') {
  await page.goto('/wallet');
  await page.getByRole('button', { name: 'Adicionar saldo simulado', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Valor (R$)', { exact: true }).fill(amount);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Adicionar R/ })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Saldo simulado adicionado', { exact: true })).toBeVisible();
}

export async function publish(page: Page): Promise<AuctionDetail> {
  await page.goto('/auctions/new');
  await page.getByLabel('Buscar carta', { exact: true }).fill('Pikachu');
  await page.getByRole('group', { name: 'Cartas disponíveis' }).getByRole('button').first().click();
  await page.getByLabel('Lance inicial (R$)', { exact: true }).fill('100,00');
  await page.getByLabel('Incremento mínimo (R$)', { exact: true }).fill('10,00');
  await expect(page.getByRole('button', { name: 'Publicar leilão' })).toBeEnabled();

  const response = page.waitForResponse(
    (r) => r.url() === `${apiOrigin}/api/v1/auctions` && r.request().method() === 'POST',
  );

  await page.getByRole('button', { name: 'Publicar leilão' }).click();

  const result = await response;

  expect(result.status()).toBe(201);

  const lot: AuctionDetail = await result.json();

  // The UI chooses startsAt from the browser clock; advance the controlled API clock
  // past that instant before reading the room, without waiting on wall-clock time.
  configure({ now: Date.parse(lot.startsAt) + 1000 });

  return lot;
}

export async function bid(page: Page, value: string) {
  await expect(page.getByLabel('Seu lance (R$)', { exact: true })).toBeEnabled();
  await page.getByLabel('Seu lance (R$)', { exact: true }).fill(value);
  await page.getByRole('button', { name: /^Dar lance/ }).click();
  await expect(page.getByText('Você está na liderança', { exact: true })).toBeVisible();
}

type Actor = { page: Page; context: BrowserContext; email: string };

type Fixtures = {
  journey: {
    sql: pg.Client;
    auditSql: pg.Client;
    actor: (role?: 'bidder' | 'seller' | 'visitor') => Promise<Actor>;
    counters: { requests: number; auctionEvents: number };
  };
};

export const test = base.extend<Fixtures>({
  journey: async ({ browser }, use, testInfo) => {
    assert.equal(process.env.HOLOBID_ISOLATED_DATABASE_TEST, '1');
    for (const key of ['DATABASE_URL', 'AUDIT_DATABASE_URL']) {
      assert.equal(new URL(process.env[key]!).hostname, '127.0.0.1');
    }

    const sql = new pg.Client({ connectionString: process.env.DATABASE_URL });
    const auditSql = new pg.Client({ connectionString: process.env.AUDIT_DATABASE_URL });
    const contexts: BrowserContext[] = [];
    const errors: string[] = [];
    const counters = { requests: 0, auctionEvents: 0 };

    await sql.connect();
    await auditSql.connect();
    configure({ now: Date.now(), reconcileSettlements: false, provider: 'fixture' });

    async function actor(role: 'bidder' | 'seller' | 'visitor' = 'bidder'): Promise<Actor> {
      const context = await browser.newContext({
        baseURL: process.env.HOLOBID_E2E_ORIGIN,
        viewport: { width: 1440, height: 1000 },
        locale: 'pt-BR',
        timezoneId: 'UTC',
      });
      const page = await context.newPage();
      const email = `browser-${randomUUID()}@holobid.test`;

      contexts.push(context);
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('request', (request) => {
        if (request.url().includes('/api/v1/')) {
          counters.requests++;
        }
      });
      page.on('websocket', (socket) => {
        socket.on('framereceived', ({ payload }) => {
          if (String(payload).includes('auction.updated')) {
            counters.auctionEvents++;
          }
        });
      });
      if (role !== 'visitor') {
        await page.goto('/register');
        await page.getByLabel('E-mail', { exact: true }).fill(email);
        await page.getByLabel('Senha', { exact: true }).fill(password);
        await page.getByLabel('Confirmar senha', { exact: true }).fill(password);
        await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
        await expect(page).not.toHaveURL(/\/register/);
        if (role === 'seller') {
          // Administrative test setup only; production registration always creates a bidder.
          await sql.query('UPDATE "User" SET role=\'AUCTIONEER\' WHERE email=$1', [email]);
          await page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
          await expect(
            page.getByRole('button', { name: 'Sair da conta', exact: true }),
          ).toHaveCount(0);
          await login(page, email);
        }
      }

      return { context, page, email };
    }

    try {
      await use({ sql, auditSql, actor, counters });
      expect(errors, 'Uncaught browser exceptions').toEqual([]);
    } finally {
      await testInfo.attach('browser-errors', {
        body: JSON.stringify(errors),
        contentType: 'application/json',
      });
      await Promise.all(contexts.map((context) => context.close()));
      await sql.end();
      await auditSql.end();
      await testInfo.attach('transport-counts', {
        body: JSON.stringify(counters),
        contentType: 'application/json',
      });
    }
  },
});

export { expect };
