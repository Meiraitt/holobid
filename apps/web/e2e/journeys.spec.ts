import {
  accessible,
  apiOrigin,
  bid,
  configure,
  deposit,
  expect,
  login,
  publish,
  test,
} from './fixtures';

test('seller, two bidders and visitor complete the auction through real HTTP and WebSocket', async ({
  journey,
}) => {
  const seller = await journey.actor('seller');
  const a = await journey.actor();
  const b = await journey.actor();
  const visitor = await journey.actor('visitor');
  const lot = await publish(seller.page);
  const path = `/auctions/${lot.id}`;

  await deposit(a.page);
  await deposit(b.page);
  await a.page.goto(path);
  await b.page.goto(path);
  await visitor.page.goto(`${path}/audit`);

  await test.step('refusal persists, preserves the typed amount and focuses the invalid input', async () => {
    const input = a.page.getByLabel('Seu lance (R$)', { exact: true });

    await expect(input).toBeEnabled();
    await input.fill('99,00');
    await a.page.getByRole('button', { name: /^Dar lance/ }).click();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toHaveValue('99,00');
    await expect(input).toBeFocused();
    await a.page.getByRole('button', { name: 'Fechar notificação' }).last().click();
    await expect(a.page.locator('#bid-amount-error')).toContainText('pelo menos');
  });

  await test.step('a real bid updates the other client and cannot be cancelled by the seller', async () => {
    configure({ now: Date.parse(lot.endsAt) - 10_000 });
    await bid(a.page, '100,00');

    const changed = await journey.sql.query('SELECT "endsAt" FROM "Auction" WHERE id=$1', [lot.id]);

    expect(changed.rows[0].endsAt.getTime()).toBeGreaterThan(Date.parse(lot.endsAt));
    await expect(a.page.getByText('Lance registrado', { exact: true })).toHaveCount(1);
    await expect(b.page.getByRole('button', { name: /Usar mínimo.*110/ })).toBeVisible();
    await expect.poll(() => journey.counters.auctionEvents).toBeGreaterThan(0);
    await seller.page.goto('/my-auctions');
    await expect(
      seller.page.getByRole('button', { name: 'Cancelar lote', exact: true }),
    ).toHaveCount(0);
  });

  await test.step('reconnect restores the current position and releases the outbid reservation', async () => {
    await a.context.setOffline(true);
    await bid(b.page, '110,00');
    await a.context.setOffline(false);
    await expect(a.page.getByText('Você foi superado', { exact: true })).toBeVisible();
    await expect(a.page.getByText(/Reservado neste lote:.*0,00/)).toBeVisible();
    await a.page.goto('/wallet');
    await expect(a.page.getByLabel('Resumo do saldo')).toContainText('500,00');
  });

  await test.step('settlement produces a public receipt and independently verified audit', async () => {
    const settledLot = await journey.sql.query('SELECT "endsAt" FROM "Auction" WHERE id=$1', [
      lot.id,
    ]);

    configure({ now: settledLot.rows[0].endsAt.getTime() + 1000, reconcileSettlements: true });
    await expect(b.page.getByText('Carta arrematada por você', { exact: true })).toBeVisible();
    await b.page.goto('/participations');

    const receiptLink = b.page.getByRole('link', { name: /comprovante/i }).first();

    await expect(receiptLink).toBeVisible();

    const href = await receiptLink.getAttribute('href');

    expect(href).toMatch(/^\/receipts\//);
    await visitor.page.goto(href!);
    await expect(
      visitor.page.getByRole('heading', { name: 'Comprovante de arremate' }).first(),
    ).toBeVisible();
    await expect(visitor.page.getByRole('main')).toContainText('110,00');
    await expect(visitor.page.getByRole('main')).not.toContainText(b.email);
    await accessible(visitor.page);
    await visitor.page.goto(`${path}/audit`);
    await expect(visitor.page.getByRole('heading', { name: 'Histórico verificado' })).toBeVisible();
    await accessible(visitor.page);
    await b.page.goto('/wallet');
    await expect(b.page.getByLabel('Resumo do saldo')).toContainText('390,00');
  });

  await test.step('a fresh verification reports tampering instead of retaining a green result', async () => {
    const original = await journey.sql.query(
      'SELECT id, "amountCents" FROM "Bid" WHERE "auctionId"=$1 ORDER BY sequence LIMIT 1',
      [lot.id],
    );
    const record = original.rows[0];

    try {
      await journey.sql.query('UPDATE "Bid" SET "amountCents"="amountCents"+1 WHERE id=$1', [
        record.id,
      ]);
      await visitor.page.reload();
      await expect(
        visitor.page.getByRole('heading', { name: 'Adulteração detectada' }),
      ).toBeVisible();
      await expect(visitor.page.getByRole('heading', { name: 'Histórico verificado' })).toHaveCount(
        0,
      );
    } finally {
      await journey.sql.query('UPDATE "Bid" SET "amountCents"=$2 WHERE id=$1', [
        record.id,
        record.amountCents,
      ]);
    }
  });
  await test.step('unavailable verification key is incomplete, never a valid or tampered result', async () => {
    const checkpoint = await journey.auditSql.query(
      'SELECT "keyId" FROM "AuditCheckpoint" WHERE "auctionId"=$1',
      [lot.id],
    );

    try {
      await journey.auditSql.query('UPDATE "AuditCheckpoint" SET "keyId"=$1 WHERE "auctionId"=$2', [
        'unavailable-e2e-key',
        lot.id,
      ]);
      await visitor.page.reload();
      await expect(
        visitor.page.getByRole('heading', { name: 'Verificação incompleta' }),
      ).toBeVisible();
      await expect(visitor.page.getByRole('heading', { name: 'Histórico verificado' })).toHaveCount(
        0,
      );
    } finally {
      await journey.auditSql.query('UPDATE "AuditCheckpoint" SET "keyId"=$1 WHERE "auctionId"=$2', [
        checkpoint.rows[0].keyId,
        lot.id,
      ]);
    }
  });
});

test('a committed deposit with a lost response survives reload without double credit', async ({
  journey,
}) => {
  const { page, context } = await journey.actor();
  const keys: string[] = [];
  let loseResponse = true;

  await page.route(`${apiOrigin}/api/v1/wallet/deposits`, async (route) => {
    keys.push(route.request().headers()['idempotency-key']!);

    const response = await route.fetch();

    expect(response.ok()).toBe(true);
    if (loseResponse) {
      loseResponse = false;
      await route.abort('failed');
    } else {
      await route.fulfill({ response });
    }
  });
  await page.goto('/wallet');

  const trigger = page.getByRole('button', { name: 'Adicionar saldo simulado', exact: true });

  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Valor (R$)', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole('dialog').getByLabel('Valor (R$)', { exact: true }).fill('100,00');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Adicionar R/ })
    .click();
  await expect(page.getByRole('button', { name: 'Consultar depósito', exact: true })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/wallet$/);
  await page.getByRole('button', { name: 'Consultar depósito', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Resumo do saldo')).toContainText('100,00');
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  expect((await context.cookies()).some((cookie) => cookie.httpOnly)).toBe(true);
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
  await page.goto('/wallet');
  await expect(page).toHaveURL(/\/login/);
});

test('all views have named controls, both themes and mobile reflow; dialogs work with keyboard', async ({
  journey,
}) => {
  test.setTimeout(300_000);

  const seller = await journey.actor('seller');
  const bidder = await journey.actor();
  const visitor = await journey.actor('visitor');
  const lot = await publish(seller.page);
  const cases = [
    {
      page: visitor.page,
      paths: [
        '/auctions',
        '/login',
        '/register',
        `/auctions/${lot.id}`,
        `/auctions/${lot.id}/audit`,
        '/receipts/missing',
        '/missing',
      ],
    },
    { page: bidder.page, paths: ['/wallet', '/participations'] },
    { page: seller.page, paths: ['/my-auctions', '/auctions/new'] },
  ];

  for (const { page, paths } of cases) {
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      for (const theme of ['dark', 'light']) {
        for (const path of paths) {
          await page.goto(path);
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

          const toggle = page.getByRole('button', {
            name: theme === 'dark' ? 'Ativar tema escuro' : 'Ativar tema claro',
          });

          if (await toggle.count()) {
            await toggle.click();
          }

          await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);
          await expect(page.getByText(/^Carregando/)).toHaveCount(0);
          await accessible(page);
        }
      }
    }
  }

  await visitor.page.goto('/auctions');
  await visitor.page.reload();
  await expect(visitor.page.getByRole('button', { name: 'Ativar tema escuro' })).toBeVisible();
  await visitor.page.getByRole('button', { name: 'Abrir menu' }).focus();
  await visitor.page.keyboard.press('Enter');
  await expect(visitor.page.getByRole('dialog')).toBeVisible();
  await accessible(visitor.page);
  await visitor.page.keyboard.press('Tab');
  await expect(visitor.page.getByRole('dialog')).toContainText('Entrar');
  expect(
    await visitor.page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))),
  ).toBe(true);
  await visitor.page.keyboard.press('Escape');
  await expect(visitor.page.getByRole('button', { name: 'Abrir menu' })).toBeFocused();

  await seller.page.setViewportSize({ width: 1440, height: 1000 });
  await seller.page.goto('/my-auctions');
  await seller.page.getByRole('button', { name: 'Cancelar lote', exact: true }).click();
  await expect(seller.page.getByRole('alertdialog')).toBeVisible();
  await accessible(seller.page);
  await seller.page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Cancelar lote', exact: true })
    .click();
  await expect(seller.page.getByRole('alertdialog')).toHaveCount(0);
  await expect(seller.page.getByText('Cancelado', { exact: true })).toBeVisible();

  await bidder.page.setViewportSize({ width: 1440, height: 1000 });
  await bidder.page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
  await login(bidder.page, seller.email);
  await bidder.page.goto('/wallet');
  await expect(
    bidder.page.getByRole('heading', { name: 'Esta área pertence a outro perfil' }),
  ).toBeVisible();
  await expect(bidder.page.getByLabel('Resumo do saldo')).toHaveCount(0);
});
