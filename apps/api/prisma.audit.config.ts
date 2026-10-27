import { existsSync } from 'node:fs';
import process, { loadEnvFile } from 'node:process';

import { defineConfig } from 'prisma/config';

if (process.env.NODE_ENV !== 'test' && existsSync('.env')) {
  loadEnvFile('.env');
}

export default defineConfig({
  schema: 'prisma/audit/schema.prisma',
  migrations: { path: 'prisma/audit/migrations' },
  // Generation does not need credentials. Migration commands fail if no URL is set.
  datasource: { url: process.env.DIRECT_AUDIT_DATABASE_URL ?? process.env.AUDIT_DATABASE_URL },
});
