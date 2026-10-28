import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

import { runtime } from './http-runtime.mjs';

const h = await runtime();
const probe = createServer();

await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));

const port = probe.address().port;

await new Promise((resolve) => probe.close(resolve));

// Local HTTP only. Production Secure cookies are checked separately on the HTTPS deployment.
h.env.NODE_ENV = 'test';
h.env.WEB_ORIGIN = `http://127.0.0.1:${port}`;

const env = {
  ...h.env,
  VITE_API_URL: `http://127.0.0.1:${h.env.PORT}`,
  HOLOBID_E2E_ORIGIN: h.env.WEB_ORIGIN,
};
let preview;

async function run(args) {
  await new Promise((resolve, reject) => {
    const child = spawn('npm', args, {
      cwd: h.cwd,
      env: { ...env, NODE_ENV: args[1] === 'build' ? 'production' : 'test' },
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`E2E command failed (${code}).`)),
    );
  });
}

try {
  await h.boot();
  await run(['run', 'build', '--workspace=@holobid/web']);
  preview = spawn(
    'npm',
    ['run', 'preview', '--workspace=@holobid/web', '--', '--port', String(port), '--strictPort'],
    { cwd: h.cwd, env, stdio: 'ignore', detached: true },
  );
  preview.on('error', () => {});

  let ready = false;

  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await globalThis.fetch(env.HOLOBID_E2E_ORIGIN);

      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // Wait for the production preview to bind its isolated port.
    }

    await delay(100);
  }

  assert.ok(ready, 'Frontend preview did not become ready.');
  await run(['run', 'test:e2e', '--workspace=@holobid/web']);
} finally {
  if (preview?.pid && preview.exitCode === null) {
    try {
      process.kill(-preview.pid, 'SIGTERM');
    } catch {
      // The process group may already have exited after a failed startup.
    }
  }

  await h.close();
}
