import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createWebsiteServer, type WebsiteOptions, type WorkspaceEnvelope } from './app.ts';

const credentials = { username: '老板', password: 'a-good-password-2026' };
async function fixture(t: TestContext, extra: Partial<WebsiteOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sj-website-test-'));
  const staticDir = join(dir, 'site');
  mkdirSync(join(staticDir, 'assets'), { recursive: true });
  writeFileSync(join(staticDir, 'index.html'), '<html>序间网站</html>');
  writeFileSync(join(staticDir, 'assets', 'main.js'), 'window.app = true;');
  writeFileSync(join(dir, 'secret.txt'), 'do-not-expose');
  const options = { dataDir: join(dir, 'data'), staticDir, ...extra };
  let app = createWebsiteServer(options);
  async function listen() {
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  }
  let url = await listen();
  t.after(async () => {
    await app.close();
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith('sj-website-test-'));
    rmSync(dir, { recursive: true, force: true });
  });
  type Auth = { cookie: string; csrf: string };
  async function request(path: string, method = 'GET', value?: unknown, auth?: Auth, headers: Record<string, string> = {}) {
    const response = await fetch(url + path, {
      method,
      headers: { ...(method === 'POST' ? { Origin: url, 'Content-Type': 'application/json' } : {}), ...(auth ? { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrf } : {}), ...headers },
      ...(value !== undefined ? { body: JSON.stringify(value) } : {}),
    });
    const content = response.headers.get('Content-Type')?.includes('application/json') ? await response.json() : await response.text();
    return { response, content, auth: { cookie: (response.headers.get('Set-Cookie') || '').split(';')[0], csrf: content.csrfToken || '' } };
  }
  async function setup() {
    const token = options.setupToken || readFileSync(app.setupTokenPath, 'utf8').trim();
    const result = await request('/api/setup', 'POST', { token, ...credentials });
    assert.equal(result.response.status, 200, JSON.stringify(result.content));
    return result.auth;
  }
  return { dir, options, get app() { return app; }, get url() { return url; }, request, setup, async restart() { await app.close(); app = createWebsiteServer(options); url = await listen(); } };
}
const saveProject = (title = '真实项目验证') => ({ type: 'saveProject', payload: { companyName: 'DemoA', project: { title, description: '', ownerIds: ['member-one', 'member-two'], contactIds: [], startDate: '2026-10-09', endDate: '2026-10-12', status: 'doing', priority: 'normal' } } });
const change = (command: object, expectedRevision = 0, requestId = randomUUID()) => ({ command, expectedRevision, requestId });

test('empty website initializes once, authenticates and never creates demo projects', async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.request('/api/session')).content, { initialized: false, authenticated: false });
  assert.equal((await f.request('/api/workspace')).response.status, 401);
  const invalid = await f.request('/api/setup', 'POST', { token: 'invalid', ...credentials });
  assert.equal(invalid.response.status, 403);
  const auth = await f.setup();
  assert.equal(existsSync(f.app.setupTokenPath), false);
  const state = (await f.request('/api/workspace', 'GET', undefined, auth)).content as WorkspaceEnvelope;
  assert.equal(state.revision, 0);
  assert.equal(state.state.projects.length, 0);
  assert.equal(state.state.companies.length, 4);
  assert.deepEqual((await f.request('/api/session', 'GET', undefined, auth)).content.user, { username: '老板' });
  assert.equal((await f.request('/api/setup', 'POST', { token: 'any', ...credentials })).response.status, 409);
  const db = new DatabaseSync(f.app.dataFile);
  const owner = db.prepare('SELECT password_hash FROM admin').get()!;
  assert.notEqual(owner.password_hash, credentials.password);
  const session = db.prepare('SELECT hash FROM sessions').get()!;
  assert.notEqual(session.hash, auth.cookie.split('=')[1]);
  db.close();
});

test('authentication, cookies, Origin and CSRF protect every write and private read', async t => {
  const f = await fixture(t, { secureCookies: true });
  const init = await f.request('/api/setup', 'POST', { token: readFileSync(f.app.setupTokenPath, 'utf8').trim(), ...credentials });
  assert.equal(init.response.status, 200);
  const cookie = init.response.headers.get('set-cookie')!;
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/); assert.match(cookie, /Secure/);
  const auth = init.auth;
  for (const path of ['/api/workspace', '/api/export', '/api/backups']) assert.equal((await f.request(path)).response.status, 401);
  for (const path of ['/api/commands', '/api/import', '/api/restore', '/api/logout', '/api/password']) {
    assert.equal((await f.request(path, 'POST', {}, auth, { 'X-CSRF-Token': 'bad' })).response.status, 403);
    assert.equal((await f.request(path, 'POST', {}, auth, { Origin: 'https://attacker.example' })).response.status, 403);
  }
  assert.equal((await f.request('/api/login', 'POST', credentials, undefined, { Origin: 'null' })).response.status, 403);
  assert.equal((await f.request('/api/login', 'POST', credentials, undefined, { Origin: '' })).response.status, 403);
  assert.equal((await f.request('/api/login', 'POST', { ...credentials, password: 'wrong-password' })).response.status, 401);
  assert.equal((await f.request('/api/login', 'POST', credentials)).response.status, 200);
});

test('commands synchronize two sessions, reject stale writes and deduplicate retries', async t => {
  const f = await fixture(t);
  const first = await f.setup();
  const second = (await f.request('/api/login', 'POST', credentials)).auth;
  const input = change(saveProject());
  const saved = await f.request('/api/commands', 'POST', input, first);
  assert.equal(saved.response.status, 200);
  assert.equal(saved.content.revision, 1);
  assert.equal(saved.content.state.projects.length, 1);
  assert.equal((await f.request('/api/workspace', 'GET', undefined, second)).content.state.projects[0].title, '真实项目验证');
  const conflict = await f.request('/api/commands', 'POST', change(saveProject('stale')), second);
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.content.code, 'CONFLICT');
  assert.equal(conflict.content.workspace.revision, 1);
  assert.equal((await f.request('/api/commands', 'POST', input, second)).content.revision, 1);
  const reused = await f.request('/api/commands', 'POST', change(saveProject('changed'), 0, input.requestId), first);
  assert.equal(reused.response.status, 409);
  assert.equal(reused.content.code, 'REQUEST_REUSED');
  assert.equal((await f.request('/api/backups', 'GET', undefined, first)).content.backups.length, 1);
});

test('concurrent writes with the same revision commit exactly one change', async t => {
  const f = await fixture(t);
  const auth = await f.setup();
  const results = await Promise.all([f.request('/api/commands', 'POST', change(saveProject('first')), auth), f.request('/api/commands', 'POST', change(saveProject('second')), auth)]);
  assert.deepEqual(results.map(r => r.response.status).sort(), [200, 409]);
  const current = (await f.request('/api/workspace', 'GET', undefined, auth)).content;
  assert.equal(current.revision, 1);
  assert.equal(current.state.projects.length, 1);
});

test('invalid commands and imports do not write data, revisions or backups', async t => {
  const f = await fixture(t);
  const auth = await f.setup();
  const initial = (await f.request('/api/workspace', 'GET', undefined, auth)).content;
  const invalid = saveProject(); invalid.payload.project.ownerIds = ['outsider'];
  for (const command of [invalid, { type: 'unknown', payload: {} }, { type: 'saveProject', payload: {} }, { type: 'reviewProject', payload: { id: 'missing', approved: 'yes', note: '' } }]) {
    assert.equal((await f.request('/api/commands', 'POST', change(command), auth)).response.status, 400);
  }
  assert.equal((await f.request('/api/import', 'POST', { state: { version: 4 }, expectedRevision: 0, requestId: randomUUID() }, auth)).response.status, 400);
  assert.deepEqual((await f.request('/api/workspace', 'GET', undefined, auth)).content, initial);
  assert.deepEqual((await f.request('/api/backups', 'GET', undefined, auth)).content.backups, []);
});

test('export/import/restore are durable, retain previous state and advance revision', async t => {
  const f = await fixture(t);
  const auth = await f.setup();
  await f.request('/api/commands', 'POST', change(saveProject()), auth);
  const exported = await f.request('/api/export', 'GET', undefined, auth);
  assert.match(exported.response.headers.get('Content-Disposition')!, /attachment/);
  const imported = structuredClone(exported.content.state);
  imported.projects[0].title = '导入后的项目';
  assert.equal((await f.request('/api/import', 'POST', { state: imported, expectedRevision: 1, requestId: randomUUID() }, auth)).content.revision, 2);
  const backups = (await f.request('/api/backups', 'GET', undefined, auth)).content.backups;
  assert.equal(backups[0].reason, 'import');
  assert.equal(backups[0].projectCount, 1);
  const restored = await f.request('/api/restore', 'POST', { backupId: backups[0].id, expectedRevision: 2, requestId: randomUUID() }, auth);
  assert.equal(restored.content.revision, 3);
  assert.equal(restored.content.state.projects[0].title, '真实项目验证');
  const restoreSnapshot = (await f.request('/api/backups', 'GET', undefined, auth)).content.backups[0];
  assert.equal(restoreSnapshot.reason, 'restore');
  await f.restart();
  assert.equal(existsSync(f.app.setupTokenPath), false);
  assert.equal((await f.request('/api/session', 'GET', undefined, auth)).content.authenticated, true);
  assert.equal((await f.request('/api/workspace', 'GET', undefined, auth)).content.revision, 3);
  assert.equal((await f.request('/api/restore', 'POST', { backupId: restoreSnapshot.id, expectedRevision: 3, requestId: randomUUID() }, auth)).content.state.projects[0].title, '导入后的项目');
});

test('only latest 30 backups remain, idempotency still works after restart', async t => {
  const f = await fixture(t);
  const auth = await f.setup();
  const first = change({ type: 'saveCompany', payload: { changes: { name: 'first', note: '' } } });
  await f.request('/api/commands', 'POST', first, auth);
  for (let revision = 1; revision < 32; revision++) {
    const result = await f.request('/api/commands', 'POST', change({ type: 'saveCompany', payload: { changes: { name: `company-${revision}`, note: '' } } }, revision), auth);
    assert.equal(result.response.status, 200);
  }
  assert.equal((await f.request('/api/backups', 'GET', undefined, auth)).content.backups.length, 30);
  await f.restart();
  assert.equal((await f.request('/api/commands', 'POST', first, auth)).content.revision, 32);
  assert.equal((await f.request('/api/workspace', 'GET', undefined, auth)).content.state.companies.length, 36);
});

test('password changes rotate the session and revoke other sessions; logout revokes current', async t => {
  const f = await fixture(t);
  const first = await f.setup();
  const second = (await f.request('/api/login', 'POST', credentials)).auth;
  assert.equal((await f.request('/api/password', 'POST', { currentPassword: 'wrong', newPassword: 'new-good-password' }, first)).response.status, 401);
  const result = await f.request('/api/password', 'POST', { currentPassword: credentials.password, newPassword: 'new-good-password' }, first);
  assert.equal(result.response.status, 200);
  assert.notEqual(result.auth.cookie, first.cookie);
  assert.equal((await f.request('/api/workspace', 'GET', undefined, first)).response.status, 401);
  assert.equal((await f.request('/api/workspace', 'GET', undefined, second)).response.status, 401);
  assert.equal((await f.request('/api/login', 'POST', credentials)).response.status, 401);
  assert.equal((await f.request('/api/login', 'POST', { username: credentials.username, password: 'new-good-password' })).response.status, 200);
  assert.equal((await f.request('/api/logout', 'POST', {}, result.auth)).content.authenticated, false);
  assert.equal((await f.request('/api/workspace', 'GET', undefined, result.auth)).response.status, 401);
});

test('session expires and login attempts are bounded', async t => {
  const f = await fixture(t, { sessionTtlMs: 1 });
  const auth = await f.setup();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal((await f.request('/api/workspace', 'GET', undefined, auth)).response.status, 401);
  for (let attempt = 0; attempt < 10; attempt++) assert.equal((await f.request('/api/login', 'POST', { ...credentials, password: 'wrong-password' })).response.status, 401);
  assert.equal((await f.request('/api/login', 'POST', credentials)).response.status, 429);
});

test('static server exposes only built assets, has health endpoint, rejects unsafe paths and bodies', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/')).response.status, 200);
  assert.match((await f.request('/')).content, /序间网站/);
  assert.equal((await f.request('/assets/main.js')).response.status, 200);
  assert.deepEqual((await f.request('/healthz')).content, { ok: true, mode: 'website', sharedData: true });
  for (const path of ['/src/workspace/model.ts', '/server/app.ts', '/.data/setup-token.txt', '/.data/workbench.sqlite', '/package.json', '/assets/../../secret.txt', '/assets/..%2f..%2fsecret.txt', '/assets/%5c..%5c..%5csecret.txt']) assert.equal((await f.request(path)).response.status, 404, path);
  assert.equal((await f.request('/', 'POST', {})).response.status, 405);
  assert.equal((await f.request('/api/setup', 'POST', {}, undefined, { 'Content-Type': 'text/plain' })).response.status, 415);
  const tooLarge = await f.request('/api/setup', 'POST', { huge: 'x'.repeat(5 * 1024 * 1024) });
  assert.equal(tooLarge.response.status, 413);
});

test('configured public Origin works without trusting arbitrary Host or forwarded headers', async t => {
  const f = await fixture(t, { allowedOrigins: ['https://work.example.com'] });
  const token = readFileSync(f.app.setupTokenPath, 'utf8').trim();
  assert.equal((await f.request('/api/setup', 'POST', { token, ...credentials }, undefined, { Origin: 'https://work.example.com' })).response.status, 200);
  assert.equal((await f.request('/api/login', 'POST', credentials)).response.status, 403);
  assert.equal((await f.request('/api/login', 'POST', credentials, undefined, { Origin: 'https://evil.example', 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'https' })).response.status, 403);
});

test('simultaneous first setup creates one owner without overwriting credentials', async t => {
  const f = await fixture(t);
  const token = readFileSync(f.app.setupTokenPath, 'utf8').trim();
  const result = await Promise.all([f.request('/api/setup', 'POST', { token, username: 'one', password: credentials.password }), f.request('/api/setup', 'POST', { token, username: 'two', password: credentials.password })]);
  assert.deepEqual(result.map(r => r.response.status).sort(), [200, 409]);
  const winner = result.find(r => r.response.status === 200)!;
  assert.equal((await f.request('/api/session', 'GET', undefined, winner.auth)).content.user.username, winner.content.user.username);
});

test('proxy: forwarding headers cannot bypass rate limits without a trusted socket', async t => {
  for (const trustProxy of [[], ['192.0.2.10']]) {
    const f = await fixture(t, { trustProxy });
    await f.setup();
    for (let attempt = 0; attempt < 10; attempt++) {
      const result = await f.request('/api/login', 'POST', { ...credentials, password: 'wrong-password' }, undefined, { 'X-Forwarded-For': `198.51.100.${attempt + 1}` });
      assert.equal(result.response.status, 401);
    }
    assert.equal((await f.request('/api/login', 'POST', credentials, undefined, { 'X-Forwarded-For': '203.0.113.99', 'X-Real-IP': '203.0.113.100' })).response.status, 429);
  }
});

test('proxy: trusted proxy limits clients independently and rejects spoofed forwarding prefixes', async t => {
  const f = await fixture(t, { trustProxy: ['127.0.0.1', '10.20.30.0/24'] });
  await f.setup();
  for (let attempt = 0; attempt < 10; attempt++) {
    // The left prefix is attacker-controlled. The rightmost untrusted hop is
    // the client actually observed by the configured proxy chain.
    const result = await f.request('/api/login', 'POST', { ...credentials, password: 'wrong-password' }, undefined, { 'X-Forwarded-For': `198.51.100.${attempt + 1}, 203.0.113.7, 10.20.30.8` });
    assert.equal(result.response.status, 401);
  }
  assert.equal((await f.request('/api/login', 'POST', credentials, undefined, { 'X-Forwarded-For': '198.51.100.99, 203.0.113.7, 10.20.30.8' })).response.status, 429);
  assert.equal((await f.request('/api/login', 'POST', credentials, undefined, { 'X-Forwarded-For': '203.0.113.8, 10.20.30.8' })).response.status, 200);
  assert.equal((await f.request('/api/login', 'POST', credentials, undefined, { 'X-Forwarded-For': '2001:db8::123, 10.20.30.8' })).response.status, 200);
});

test('proxy: invalid or universal trust settings fail closed before opening a database', () => {
  for (const proxy of ['*', '0.0.0.0/0', '::/0', '127.0.0.1/33', 'localhost', '198.51.100.5/bad']) {
    assert.throws(() => createWebsiteServer({ dataDir: 'not-created-invalid-proxy', trustProxy: [proxy] }), /SJ_TRUST_PROXY/);
  }
});
