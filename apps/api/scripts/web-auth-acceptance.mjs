import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import process from 'node:process';
import { setTimeout } from 'node:timers/promises';
import { URL } from 'node:url';

assert.equal(process.env.HOLOBID_ISOLATED_DATABASE_TEST, '1');
for (const key of ['DATABASE_URL', 'AUDIT_DATABASE_URL']) {
  assert.equal(new URL(process.env[key]).hostname, '127.0.0.1');
}

const probe = createServer();

await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));

const port = probe.address().port;

await new Promise((resolve) => probe.close(resolve));

const env = {
  ...process.env,
  NODE_ENV: 'test',
  PORT: String(port),
  DEMO_MODE: 'false',
  WEB_ORIGIN: 'http://127.0.0.1:5173',
  JWT_SECRET: randomBytes(32).toString('base64url'),
  AUDIT_HMAC_SECRET: randomBytes(32).toString('base64url'),
  AUDIT_PSEUDONYM_SECRET: randomBytes(32).toString('base64url'),
  AUDIT_KEY_ID: 'v1',
  HOLOBID_AUTH_API_URL: `http://127.0.0.1:${port}`,
};
const api = spawn(process.execPath, ['dist/main.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });

api.stdout.resume();
api.stderr.resume();

let ready = false;

try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await globalThis.fetch(`${env.HOLOBID_AUTH_API_URL}/api/v1/health/ready`)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* Wait for the isolated API to bind. */
    }

    await setTimeout(100);
  }

  assert.ok(ready, 'Isolated auth API did not become ready');

  const result = spawnSync('npm', ['run', 'test:auth', '--workspace=@holobid/web'], {
    env,
    stdio: 'inherit',
  });

  if (result.error || result.status !== 0) {
    process.exitCode = 1;
  }
} finally {
  api.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => api.once('exit', resolve)), setTimeout(5000)]);
  if (api.exitCode === null && api.signalCode === null) {
    api.kill('SIGKILL');
  }
}
