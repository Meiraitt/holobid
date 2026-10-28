import assert from 'node:assert/strict';
import process from 'node:process';

import { defineConfig } from '@playwright/test';

assert.equal(
  process.env.HOLOBID_ISOLATED_DATABASE_TEST,
  '1',
  'Run npm run test:e2e from the root.',
);
assert.equal(new URL(process.env.HOLOBID_E2E_ORIGIN!).hostname, '127.0.0.1');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL: process.env.HOLOBID_E2E_ORIGIN,
    browserName: 'chromium',
    viewport: { width: 1440, height: 1000 },
    locale: 'pt-BR',
    timezoneId: 'UTC',
    // Network traces contain credentials and must not become CI artifacts.
    trace: 'off',
    screenshot: 'only-on-failure',
  },
});
