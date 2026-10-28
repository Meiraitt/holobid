import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { URL } from 'node:url';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const auth = config.rewrites.find((route) => route.source === '/api/v1/auth/:path*');
const origin = new URL(auth.destination).origin;

assert.equal(new URL(origin).protocol, 'https:', 'Deployment requires an HTTPS backend.');
for (const name of ['VITE_API_URL', 'VITE_SOCKET_URL']) {
  assert.ok(
    !process.env[name] || process.env[name] === origin,
    `${name} must match the auth rewrite origin in vercel.json.`,
  );
}

// Public endpoints only: derive both clients from the versioned auth destination.
const result = spawnSync('npm', ['run', 'build:web'], {
  cwd: new URL('../', import.meta.url),
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    VITE_API_URL: origin,
    VITE_SOCKET_URL: origin,
  },
});

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
