import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

assert.equal(Number(process.versions.node.split('.')[0]), 24, 'Use the deployment Node.js 24 runtime');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(root, 'dist-server/main.mjs');
const staticDirectory = resolve(root, 'dist-website');
await access(entry);
await access(resolve(staticDirectory, 'index.html'));
const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'sj-runtime-smoke-'));
const isolatedEntry = resolve(temporaryRoot, 'main.mjs');
const dataDirectory = resolve(temporaryRoot, 'data');
const setupToken = randomBytes(24).toString('hex');
const credentials = { username: 'runtime-smoke', password: randomBytes(24).toString('hex') };
const checks = [];
let child;
let childStopped;
let output = '';
let origin = '';

async function freePort() {
  const probe = createServer();
  await new Promise((done, fail) => { probe.once('error', fail); probe.listen(0, '127.0.0.1', done); });
  const port = probe.address().port;
  await new Promise((done, fail) => probe.close(error => error ? fail(error) : done()));
  return port;
}

async function start() {
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !key.toUpperCase().startsWith('SJ_') && !['NODE_OPTIONS', 'NODE_PATH'].includes(key.toUpperCase())));
  child = spawn(process.execPath, [isolatedEntry], {
    cwd: temporaryRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...environment, NODE_ENV: 'production',
      SJ_HOST: '127.0.0.1', SJ_PORT: String(port),
      SJ_DATA_DIR: dataDirectory, SJ_STATIC_DIR: staticDirectory,
      SJ_ALLOWED_ORIGINS: origin, SJ_COOKIE_SECURE: 'false',
      SJ_TRUST_PROXY: '', SJ_SETUP_TOKEN: setupToken,
    },
  });
  const processForThisRun = child;
  let spawnError;
  child.on('error', error => { spawnError = error; });
  childStopped = new Promise(done => child.once('close', done));
  const rememberOutput = chunk => { output = (output + chunk.toString()).slice(-4000); };
  child.stdout.on('data', rememberOutput);
  child.stderr.on('data', rememberOutput);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (processForThisRun.exitCode !== null || processForThisRun.signalCode) {
      throw new Error(`Bundled server exited before health check:\n${output}`);
    }
    try {
      const response = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        assert.deepEqual(await response.json(), { ok: true, mode: 'website', sharedData: true });
        return;
      }
    } catch { /* The child may still be opening its isolated SQLite database. */ }
    await delay(100);
  }
  throw new Error(`Bundled server did not become healthy:\n${output}`);
}

async function stop() {
  if (!child) return;
  if (child.exitCode === null && !child.signalCode) child.kill('SIGTERM');
  const stopped = await Promise.race([childStopped.then(() => true), delay(5000, false)]);
  if (!stopped) {
    child.kill('SIGKILL');
    await childStopped;
  }
  child = undefined;
}

async function request(path, { method = 'GET', body, auth, status = 200 } = {}) {
  const response = await fetch(origin + path, {
    method,
    headers: {
      ...(method === 'POST' ? { Origin: origin, 'Content-Type': 'application/json' } : {}),
      ...(auth ? { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrf } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, status, `${method} ${path} returned an unexpected status`);
  const data = await response.json();
  return {
    data,
    auth: { cookie: (response.headers.get('set-cookie') || '').split(';')[0], csrf: data.csrfToken || '' },
  };
}

try {
  // Execute the exact bundle outside the repository; no tsx loader or project node_modules.
  await copyFile(entry, isolatedEntry);
  await start();
  checks.push('standalone bundle health');
  const page = await fetch(origin, { signal: AbortSignal.timeout(5000) });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<div id="root"><\/div>/);
  checks.push('existing static website served');
  assert.deepEqual((await request('/api/session')).data, { initialized: false, authenticated: false });
  await request('/api/workspace', { status: 401 });
  checks.push('private workspace requires login');
  const setup = await request('/api/setup', { method: 'POST', body: { ...credentials, token: setupToken } });
  assert.equal(setup.data.authenticated, true);
  await request('/api/logout', { method: 'POST', auth: setup.auth });
  const loggedIn = await request('/api/login', { method: 'POST', body: credentials });
  assert.equal(loggedIn.data.authenticated, true);
  assert.ok(loggedIn.auth.cookie && loggedIn.auth.csrf);
  checks.push('initialization, logout and login');
  const initial = (await request('/api/workspace', { auth: loggedIn.auth })).data;
  assert.equal(initial.state.projects.length, 0);
  const day = new Date().toISOString().slice(0, 10);
  const saved = await request('/api/commands', {
    method: 'POST', auth: loggedIn.auth,
    body: {
      expectedRevision: initial.revision, requestId: randomUUID(),
      command: { type: 'saveProject', payload: {
        companyName: 'Runtime Smoke Company', newContactNames: ['Runtime Smoke Contact'],
        project: { title: '运行包隔离测试项目', description: 'synthetic smoke data',
          ownerIds: ['member-one', 'member-two'], contactIds: [],
          startDate: day, endDate: day, status: 'doing', priority: 'normal' },
      } },
    },
  });
  assert.equal(saved.data.state.projects.length, 1);
  const projectId = saved.data.state.projects[0].id;
  const anotherSession = await request('/api/login', { method: 'POST', body: credentials });
  const read = (await request('/api/workspace', { auth: anotherSession.auth })).data;
  assert.equal(read.state.projects[0].id, projectId);
  assert.deepEqual(read.state.projects[0].ownerIds, ['member-one', 'member-two']);
  checks.push('saved project visible to another login');
  await stop();
  await start();
  const afterRestart = await request('/api/login', { method: 'POST', body: credentials });
  const restored = (await request('/api/workspace', { auth: afterRestart.auth })).data;
  assert.equal(restored.state.projects[0].id, projectId);
  assert.equal(restored.revision, saved.data.revision);
  checks.push('SQLite account and project survive restart');
} finally {
  await stop();
  // Only delete the uniquely created temporary tree, never the workspace or actual .data.
  assert.equal(dirname(resolve(temporaryRoot)), resolve(tmpdir()));
  assert.ok(basename(temporaryRoot).startsWith('sj-runtime-smoke-'));
  await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log(JSON.stringify({ result: 'passed', node: process.version, checks, isolatedDataRemoved: true }, null, 2));
