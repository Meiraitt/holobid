import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';

const demo = process.argv[2] === '--tamper-demo';
const http = ['--http', '--http-live'].includes(process.argv[2]);
if (process.argv.length > 2 && ((!demo && !http) || process.argv.length !== 3)) throw new Error('Unsupported database runner arguments.');
if (demo && process.env.NODE_ENV === 'production') throw new Error('Tamper demonstration is disabled in production.');

const cwd = fileURLToPath(new URL('../', import.meta.url));
const ciServices = !http && !demo && process.env.GITHUB_ACTIONS === 'true';
const names = ciServices ? [process.env.HOLOBID_CI_MAIN_CONTAINER, process.env.HOLOBID_CI_AUDIT_CONTAINER]
  : [`holobid-main-test-${randomUUID()}`, `holobid-audit-test-${randomUUID()}`];
if (ciServices && names.some(name => !/^[0-9a-f]{12,64}$/.test(name ?? ''))) throw new Error('Expected isolated GitHub service container IDs.');
const owned = [];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', ...options });
  if (result.error || result.status !== 0) throw new Error(`${command} failed. Check the output above.`);
  return result.stdout?.trim();
}

function cleanup() {
  for (const container of owned.splice(0)) spawnSync('docker', ['rm', '--force', container], { stdio: 'ignore', timeout: 15_000 });
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { cleanup(); process.exit(signal === 'SIGINT' ? 130 : 143); });
}

try {
  try { run('docker', ['info'], { stdio: 'ignore' }); }
  catch { throw new Error('Docker is unavailable. Start Docker before running database checks.'); }
  const ports = [];
  for (const container of names) {
    if (!ciServices) {
      run('docker', ['run', '--detach', '--rm', '--name', container,
        '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data',
        '--env', `POSTGRES_PASSWORD=${randomUUID()}`, 'postgres:16-alpine'], { stdio: 'pipe', encoding: 'utf8' });
      owned.push(container);
    } else if (run('docker', ['inspect', '--format', '{{.Config.Image}}', container], { stdio: 'pipe', encoding: 'utf8' }) !== 'postgres:16-alpine') {
      throw new Error('Unexpected CI PostgreSQL image.');
    }
    let available = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const probe = spawnSync('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], { stdio: 'ignore' });
      if (probe.status === 0) { available = true; break; }
      await setTimeout(500);
    }
    if (!available) throw new Error('The isolated PostgreSQL instance did not become ready.');
    // Fresh services only: CREATE fails rather than resetting any existing database.
    run('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
      input: readFileSync(new URL('../prisma/local-init.sql', import.meta.url)), stdio: ['pipe', 'inherit', 'inherit'],
    });
    const binding = run('docker', ['port', container, '5432/tcp'], { stdio: 'pipe', encoding: 'utf8' }).split('\n')[0];
    const port = binding.split(':').at(-1);
    if (!/^\d+$/.test(port)) throw new Error('Could not determine the isolated database port.');
    ports.push(port);
  }
  // Never read a caller-supplied database URL or .env: tests only touch this fresh container.
  const env = { ...process.env, NODE_ENV: 'test',
    DATABASE_URL: `postgresql://holobid:holobid_local@127.0.0.1:${ports[0]}/holobid`,
    AUDIT_DATABASE_URL: `postgresql://holobid_audit:holobid_audit_local@127.0.0.1:${ports[1]}/holobid_audit`,
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
  if (http) run(process.execPath, ['scripts/http-acceptance.mjs'], { env: { ...env, HOLOBID_HTTP_LIVE: process.argv[2] === '--http-live' ? '1' : '0' } });
  else run('npm', ['exec', '--', 'jest', '--config', 'jest.database.config.mjs', '--runInBand', ...(demo ? ['--runTestsByPath', 'test/database/public-audit.spec.ts', '--testNamePattern=isolated tamper demonstration'] : [])], { env });
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
} finally {
  cleanup();
}
