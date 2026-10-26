import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import pg from 'pg';
import { io } from 'socket.io-client';

export async function runtime() {
  assert.equal(process.env.HOLOBID_ISOLATED_DATABASE_TEST, '1', 'Use the isolated database runner.');
  for (const name of ['DATABASE_URL', 'AUDIT_DATABASE_URL']) assert.equal(new URL(process.env[name]).hostname, '127.0.0.1');
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'holobid-http-'));
  const sql = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  assert.equal((await sql.query('SELECT count(*)::int AS n FROM "User"')).rows[0].n, 0, 'HTTP checks require a fresh database.');
  const net = createServer(); await new Promise(r => net.listen(0, '127.0.0.1', r)); const port = net.address().port; await new Promise(r => net.close(r));
  const origin = 'https://holobid.example';
  const env = { ...process.env, NODE_ENV: 'production', DEMO_MODE: 'false', WEB_ORIGIN: origin, PORT: String(port),
    JWT_SECRET: randomBytes(32).toString('base64url'), AUDIT_HMAC_SECRET: randomBytes(32).toString('base64url'),
    AUDIT_PSEUDONYM_SECRET: randomBytes(32).toString('base64url'), AUDIT_KEY_ID: 'v1',
    HOLOBID_HTTP_CONTROL: join(dir, 'control.json'), HOLOBID_HTTP_FETCH_LOG: join(dir, 'fetch.jsonl'),
  };
  delete env.NODE_OPTIONS; delete env.DIRECT_DATABASE_URL; delete env.DIRECT_AUDIT_DATABASE_URL;
  const state = { now: Date.now(), provider: 'fixture' };
  const configure = patch => { Object.assign(state, patch); writeFileSync(env.HOLOBID_HTTP_CONTROL, JSON.stringify(state)); };
  configure({}); writeFileSync(env.HOLOBID_HTTP_FETCH_LOG, '');
  let api, logs = '', serial = 0;
  const records = [], cases = [], clients = [], credentials = [];
  const base = `http://127.0.0.1:${port}/api/v1`;
  async function command(cmd, args, input, extraEnv = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { cwd, env: { ...env, ...extraEnv }, stdio: ['pipe', 'pipe', 'pipe'] });
      const out = [], err = []; child.stdout.on('data', x => out.push(x)); child.stderr.on('data', x => err.push(x));
      child.once('error', reject); child.once('exit', code => code === 0 ? resolve(Buffer.concat(out).toString()) : reject(new Error(`${cmd} failed (${code}): ${Buffer.concat(err).toString()}`)));
      child.stdin.end(input);
    });
  }
  async function call(path, expected = 200, options = {}) {
    const { method = options.body === undefined && options.raw === undefined ? 'GET' : 'POST', body, raw, token, cookie, key, headers = {}, code, label = path } = options;
    const id = ++serial, output = join(dir, `${id}.body`), header = join(dir, `${id}.headers`);
    const requestHeaders = { Origin: origin, ...(body !== undefined || raw !== undefined ? { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(key ? { 'Idempotency-Key': key } : {}), ...headers };
    const escape = value => String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\r', '').replaceAll('\n', '');
    let config = Object.entries(requestHeaders).filter(([,v]) => v !== null).map(([k,v]) => `header = "${escape(k + ': ' + v)}"`).join('\n');
    const args = ['--silent', '--show-error', '--max-time', '20', '--request', method, '--url', `${base}${path}`, '--dump-header', header, '--output', output, '--write-out', '%{http_code}', '--config', '-'];
    if (body !== undefined || raw !== undefined) { const file = join(dir, `${id}.input`); writeFileSync(file, raw ?? JSON.stringify(body), { mode: 0o600 }); args.push('--data-binary', '@' + file); }
    const started = Date.now(); const status = Number(await command('curl', args, config));
    const bytes = existsSync(output) ? readFileSync(output) : Buffer.alloc(0), rawHeaders = readFileSync(header, 'utf8');
    const responseHeaders = Object.fromEntries(rawHeaders.trim().split(/\r?\n/).slice(1).map(s => { const i=s.indexOf(':'); return [s.slice(0,i).toLowerCase(),s.slice(i+1).trim()]; }));
    let json; try { json = JSON.parse(bytes.toString()); } catch { json = null; }
    records.push({ request: id, label, method, path, status, expected, code: json?.code, durationMs: Date.now() - started });
    if (expected !== null) assert.equal(status, expected, `${label}: ${method} ${path}: ${status}; ${JSON.stringify(json)}`);
    if (code) assert.equal(json?.code, code, label);
    if (status >= 400) { assert.ok(json?.code && json?.message && json?.requestId, `${label}: structured error`); assert.doesNotMatch(JSON.stringify(json), /injected-private|postgresql:|passwordHash|"stack"/); }
    return { status, json, headers: responseHeaders, bytes, cookie: responseHeaders['set-cookie']?.split(';')[0] };
  }
  async function boot() {
    api = spawn(process.execPath, ['--require', './scripts/http-fixture.cjs', 'dist/main.js'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    api.stdout.on('data', b => { logs += b; }); api.stderr.on('data', b => { logs += b; });
    for (let i=0;i<150;i++) { try { const r = await globalThis.fetch(`${base}/health/live`); if (r.ok) return; } catch { /* Await binding. */ } await delay(100); }
    throw new Error('Compiled API did not become live.');
  }
  async function stop() {
    for (const c of clients.splice(0)) c.disconnect();
    if (!api || api.exitCode !== null || api.signalCode !== null) return;
    const exited = new Promise(r => api.once('exit', r)); api.kill('SIGTERM');
    const success = await Promise.race([exited.then(() => true), delay(5000, false)]);
    if (!success) { api.kill('SIGKILL'); throw new Error('API failed graceful shutdown.'); }
  }
  async function restart(patch = {}) { await stop(); configure(patch); await boot(); }
  async function test(name, ids, work) {
    const first = records.length, started = Date.now();
    try { await work(); cases.push({ name, ids, status: 'PASS', requests: records.length-first, durationMs: Date.now()-started }); process.stdout.write(`PASS ${name}\n`); }
    catch(error) { cases.push({ name, ids, status: 'FAIL', requests: records.length-first, error: error.message }); throw error; }
  }
  async function socket(token, transport = 'websocket') {
    const c = io(`http://127.0.0.1:${port}`, { autoConnect:false, transports:[transport], reconnection:false, extraHeaders:{Origin:origin}, auth: token ? {token} : {} }); clients.push(c);
    await new Promise((resolve,reject) => { c.once('connect', resolve); c.once('connect_error', reject); c.connect(); }); return c;
  }
  async function close() {
    await stop(); await sql.end();
    for (const secret of [...credentials, env.JWT_SECRET,env.AUDIT_HMAC_SECRET,env.AUDIT_PSEUDONYM_SECRET,'injected-private-database-secret','injected-private-notification-secret']) assert.ok(!logs.includes(secret), 'No sensitive data in logs');
    const report = { generatedAt: new Date().toISOString(), transport:'curl over TCP to compiled Node API; real PostgreSQL; Socket.IO clients', environment:'local isolated, production configuration, test-only time/upstream/failure injection', liveProvider:process.env.HOLOBID_HTTP_LIVE === '1', cases, requests:records, counts:{ cases:cases.length, requests:records.length, passed:cases.filter(c=>c.status==='PASS').length } };
    if (process.env.HOLOBID_HTTP_REPORT) writeFileSync(process.env.HOLOBID_HTTP_REPORT, JSON.stringify(report,null,2));
    process.stdout.write(`HTTP acceptance: ${report.counts.passed}/${cases.length} scenarios, ${records.length} cURL requests.\n`);
    rmSync(dir, {recursive:true,force:true});
  }
  return { call, boot, stop, restart, configure, state, sql, test, socket, close, command, env, cwd, credentials,
    upstreamCalls: () => readFileSync(env.HOLOBID_HTTP_FETCH_LOG,'utf8').trim().split('\n').filter(Boolean).length };
}
