import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

// Own the entire lifecycle: accepting an external URL here could erase real data.
export function processDatabases(run) {
  const instances = [];

  async function start() {
    if (process.getuid?.() === 0) throw new Error('Run PostgreSQL checks as a non-root user.');
    const version = run('pg_ctl', ['--version'], { stdio: 'pipe', encoding: 'utf8' });
    if (!/^pg_ctl \(PostgreSQL\) 16\./.test(version)) throw new Error('Checks require PostgreSQL 16.');

    const ports = [];
    for (let index = 0; index < 2; index++) {
      const root = mkdtempSync(join(tmpdir(), 'holobid-check-db-'));
      const data = join(root, 'data');
      instances.push({ root, data });
      const password = join(root, 'password');
      writeFileSync(password, randomUUID(), { mode: 0o600 });
      run('initdb', ['-D', data, '-U', 'postgres', '--auth-local=trust', '--auth-host=scram-sha-256',
        `--pwfile=${password}`, '--encoding=UTF8', '--locale=C'], { stdio: 'pipe', encoding: 'utf8' });
      rmSync(password);

      const port = await unusedPort();
      const socketDirectory = root.replaceAll("'", "''");
      writeFileSync(join(data, 'postgresql.auto.conf'),
        `listen_addresses = '127.0.0.1'\nport = ${port}\nunix_socket_directories = '${socketDirectory}'\n`);
      run('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-w', '-t', '60', 'start']);
      run('psql', ['-h', root, '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
        input: readFileSync(new URL('../prisma/local-init.sql', import.meta.url)),
        stdio: ['pipe', 'inherit', 'inherit'],
      });
      ports.push(String(port));
    }
    return ports;
  }

  function cleanup() {
    for (const { root, data } of instances.splice(0)) {
      if (existsSync(join(data, 'postmaster.pid'))) {
        const result = spawnSync('pg_ctl', ['-D', data, '-m', 'immediate', '-w', '-t', '10', 'stop'], { stdio: 'ignore' });
        if (result.error || result.status !== 0) {
          process.stderr.write('Could not stop an isolated PostgreSQL instance.\n');
          process.exitCode = 1;
          continue;
        }
      }
      rmSync(root, { recursive: true, force: true });
    }
  }

  return { start, cleanup };
}
