import { accessible, expect, test } from './fixtures';

test('landing explains the auction, supports both themes and leads visitors into real routes', async ({
  journey,
}) => {
  const visitor = await journey.actor('visitor');
  const { page } = visitor;
  const home = page.getByRole('link', { name: 'HoloBid, página inicial', exact: true });

  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Sua próxima carta começa com um lance.', exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(home).toHaveAttribute('href', '/');
  await expect(home.locator('svg')).toBeVisible();
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg');

  const favicon = await page.request.get('/favicon.svg');

  expect(favicon.status()).toBe(200);
  expect(favicon.headers()['content-type']).toContain('image/svg+xml');

  await test.step('the hero, process and public audit explain the actual product', async () => {
    await expect(
      page.getByRole('img', { name: /Carta Pokémon Charizard em destaque/ }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Como funciona', exact: true }).click();
    await expect(page).toHaveURL(/\/#como-funciona$/);
    await expect(
      page.getByRole('heading', { name: 'Da descoberta ao arremate.', exact: true }),
    ).toBeInViewport();

    const balanceQuestion = page.getByText('Como funciona o saldo?', { exact: true });
    const balanceAnswer = page.getByText(/depósitos e valores são simulados, sem cobrança/);

    await expect(balanceAnswer).not.toBeVisible();
    await balanceQuestion.focus();
    await page.keyboard.press('Enter');
    await expect(balanceAnswer).toBeVisible();
    await expect(balanceAnswer).toContainText('a reserva é liberada');
    await accessible(page);
    await page.keyboard.press('Enter');
    await expect(balanceAnswer).not.toBeVisible();
    await page.getByText('Quem pode publicar um lote?', { exact: true }).click();
    await expect(page.getByText(/leiloeiros não podem dar lances/)).toBeVisible();
    await page.getByText('Quem pode publicar um lote?', { exact: true }).click();
  });

  await test.step('desktop and mobile have accessible light and dark layouts', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['dark', 'light']) {
        const toggle = page.getByRole('button', {
          name: theme === 'dark' ? 'Ativar tema escuro' : 'Ativar tema claro',
        });

        if (await toggle.count()) {
          await toggle.click();
        }

        await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);
        await accessible(page);
        await test.info().attach(`landing-${width}-${theme}`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: 'image/png',
        });
      }
    }

    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Ativar tema escuro', exact: true }),
    ).toBeVisible();
  });

  await test.step('links reach the storefront, its ended filter and registration', async () => {
    await page.getByRole('link', { name: 'Explorar leilões', exact: true }).click();
    await expect(page).toHaveURL(/\/auctions$/);
    await expect(
      page.getByRole('heading', { name: 'Leilões de cartas', exact: true }),
    ).toBeVisible();
    await home.click();
    await expect(page).toHaveURL(/\/$/);
    await page.getByRole('link', { name: 'Consultar leilões encerrados', exact: true }).click();
    await expect(page).toHaveURL(/\/auctions\?status=ended$/);
    await expect(page.getByRole('tab', { name: 'Encerrados', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await home.click();
    await page.getByRole('link', { name: 'Criar minha conta', exact: true }).click();
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByLabel('E-mail', { exact: true })).toBeVisible();
  });

  await test.step('an authenticated participant is invited to the auctions instead of registration', async () => {
    const bidder = await journey.actor();

    await bidder.page.goto('/');
    await expect(
      bidder.page.getByRole('link', { name: 'Ver os leilões', exact: true }),
    ).toBeVisible();
    await expect(
      bidder.page.getByRole('link', { name: 'Criar minha conta', exact: true }),
    ).toHaveCount(0);
  });
});
