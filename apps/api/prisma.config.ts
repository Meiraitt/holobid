import { existsSync } from 'node:fs';
import process, { loadEnvFile } from 'node:process';

import { defineConfig } from 'prisma/config';

if (process.env.NODE_ENV !== 'test' && existsSync('.env')) {
  loadEnvFile('.env');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Generation does not need credentials. Migration commands fail if no URL is set.
  datasource: { url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL },
});
