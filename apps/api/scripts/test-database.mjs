import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const container = `holobid-test-${randomUUID()}`;
let created = false;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', ...options });
  if (result.error || result.status !== 0) throw new Error(`${command} failed. Check the output above.`);
  return result.stdout?.trim();
}

function cleanup() {
  if (created) {
    spawnSync('docker', ['rm', '--force', container], { stdio: 'ignore', timeout: 15_000 });
    created = false;
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { cleanup(); process.exit(signal === 'SIGINT' ? 130 : 143); });
}

try {
  try { run('docker', ['info'], { stdio: 'ignore' }); }
  catch { throw new Error('Docker is unavailable. Start Docker before running database checks.'); }
  run('docker', ['run', '--detach', '--rm', '--name', container,
    '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data',
    '--env', `POSTGRES_PASSWORD=${randomUUID()}`, 'postgres:16-alpine'], { stdio: 'pipe', encoding: 'utf8' });
  created = true;
  let available = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    // TCP avoids the temporary Unix-socket-only server used during first initialization.
    const probe = spawnSync('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], { stdio: 'ignore' });
    if (probe.status === 0) { available = true; break; }
    await setTimeout(500);
  }
  if (!available) throw new Error('The isolated PostgreSQL instance did not become ready.');
  run('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
    input: readFileSync(new URL('../prisma/local-init.sql', import.meta.url)), stdio: ['pipe', 'inherit', 'inherit'],
  });
  const port = run('docker', ['port', container, '5432/tcp'], { stdio: 'pipe', encoding: 'utf8' }).split(':').at(-1);
  if (!/^\d+$/.test(port)) throw new Error('Could not determine the isolated database port.');
  // Never read a caller-supplied database URL or .env: tests only touch this fresh container.
  const env = { ...process.env, NODE_ENV: 'test',
    DATABASE_URL: `postgresql://holobid:holobid_local@127.0.0.1:${port}/holobid`,
    AUDIT_DATABASE_URL: `postgresql://holobid_audit:holobid_audit_local@127.0.0.1:${port}/holobid_audit`,
    DIRECT_DATABASE_URL: '', DIRECT_AUDIT_DATABASE_URL: '',
    HOLOBID_ISOLATED_DATABASE_TEST: '1',
  };
  delete env.DIRECT_DATABASE_URL;
  delete env.DIRECT_AUDIT_DATABASE_URL;
  for (let pass = 1; pass <= 2; pass++) {
    process.stdout.write(`Migration pass ${pass}: ${pass === 1 ? 'empty databases' : 'idempotent replay'}\n`);
    run('npm', ['run', 'db:migrate'], { env });
    run('npm', ['run', 'db:audit:migrate'], { env });
  }
  run('npm', ['exec', '--', 'jest', '--config', 'jest.database.config.mjs', '--runInBand'], { env });
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
} finally {
  cleanup();
}
