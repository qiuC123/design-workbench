import test from 'node:test';
import assert from 'node:assert/strict';
import { websiteApi, WebsiteApiError, type WorkspaceSnapshot } from './api';

const workspace: WorkspaceSnapshot = {
  state: { version: 4, companies: [], contacts: [], projects: [], activities: [] },
  revision: 3,
  updatedAt: '2026-10-09T10:00:00.000Z',
};

test('保存命令发送会话、CSRF、明确的版本与幂等编号', async t => {
  let actualUrl: string | URL | Request | undefined;
  let actualOptions: RequestInit | undefined;
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, options?: RequestInit) => {
    actualUrl = url; actualOptions = options;
    return Response.json(workspace);
  });
  const command = { type: 'dismissMigration', payload: {} } as const;
  assert.deepEqual(await websiteApi.execute(command, 2, 'request-a', 'csrf-a'), workspace);
  assert.equal(actualUrl, '/api/commands');
  assert.equal(actualOptions?.credentials, 'same-origin');
  assert.equal(actualOptions?.method, 'POST');
  assert.equal(new Headers(actualOptions?.headers).get('X-CSRF-Token'), 'csrf-a');
  assert.deepEqual(JSON.parse(String(actualOptions?.body)), { command, expectedRevision: 2, requestId: 'request-a' });
});

test('冲突带回最新快照并抛错，不自动重试覆盖', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests += 1;
    return Response.json({ error: 'conflict', code: 'CONFLICT', workspace }, { status: 409 });
  });
  await assert.rejects(websiteApi.restore('backup-1', 1, 'request-a', 'csrf-a'), error => {
    assert.ok(error instanceof WebsiteApiError);
    assert.equal(error.status, 409);
    assert.equal(error.code, 'CONFLICT');
    assert.deepEqual(error.workspace, workspace);
    assert.match(error.message, /本次未保存/);
    return true;
  });
  assert.equal(requests, 1);
});

test('会话失效保留 401 状态供登录切换', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 }));
  await assert.rejects(websiteApi.workspace(), error => error instanceof WebsiteApiError && error.status === 401 && error.code === 'UNAUTHORIZED' && error.message.includes('重新登录'));
});

test('登录密码错误显示具体原因，不误报为登录过期', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: '账号或密码不正确', code: 'BAD_CREDENTIALS' }, { status: 401 }));
  await assert.rejects(websiteApi.login({ username: '老板', password: 'incorrect' }), error => error instanceof WebsiteApiError && error.status === 401 && error.message === '账号或密码不正确');
});

test('修改密码时当前密码错误仍显示字段错误，而真正失效仍提示重新登录', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: '当前密码不正确', code: 'PASSWORD' }, { status: 401 }));
  await assert.rejects(websiteApi.changePassword({ currentPassword: 'wrong-password', newPassword: 'long-new-password' }, 'csrf-a'), error => error instanceof WebsiteApiError && error.code === 'PASSWORD' && error.message === '当前密码不正确');
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: '请先登录', code: 'AUTH' }, { status: 401 }));
  await assert.rejects(websiteApi.changePassword({ currentPassword: 'old-password', newPassword: 'long-new-password' }, 'csrf-a'), error => error instanceof WebsiteApiError && error.code === 'AUTH' && error.message.includes('重新登录'));
});

test('网络断开明确失败，不返回本地或空数据', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(websiteApi.workspace(), error => error instanceof WebsiteApiError && error.status === 0 && error.code === 'NETWORK_ERROR');
});

test('代理错误页不会被误认为保存成功', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>Bad Gateway</html>', { status: 502 }));
  await assert.rejects(websiteApi.importState(workspace.state, 2, 'request-a', 'csrf-a'), error => error instanceof WebsiteApiError && error.status === 502 && error.code === 'SERVER_ERROR');
});

test('初始化与登录不依赖已有 CSRF，保持账号输入', async t => {
  const calls: RequestInit[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    calls.push(options);
    return Response.json({ initialized: true, authenticated: true, user: { username: '老板' }, csrfToken: 'csrf-new' });
  });
  const result = await websiteApi.setup({ token: 'one-time', username: '老板', password: 'long-password' });
  assert.equal(result.csrfToken, 'csrf-new');
  assert.equal(new Headers(calls[0].headers).has('X-CSRF-Token'), false);
  assert.equal(JSON.parse(String(calls[0].body)).username, '老板');
});
