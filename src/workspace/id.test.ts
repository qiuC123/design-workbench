import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createRecordId } from './id';
import { execute } from './model';
import type { ProjectInput, WorkbenchState } from './types';

const cryptoWithoutUUID = { getRandomValues: (bytes: Uint8Array<ArrayBuffer>) => webcrypto.getRandomValues(bytes) };
const uuidPattern = /^[a-z]+-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const emptyState = (): WorkbenchState => ({ version: 4, companies: [], contacts: [], projects: [], activities: [] });
const project: Omit<ProjectInput, 'companyId'> = {
  title: '手机试用项目', description: '', ownerIds: ['member-one'], contactIds: [],
  startDate: '2026-10-08', endDate: '2026-10-09', status: 'doing', priority: 'normal',
};

function withCrypto(source: unknown, run: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: source });
  try { run(); }
  finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    else Reflect.deleteProperty(globalThis, 'crypto');
  }
}

test('优先使用客户端原生 randomUUID', () => {
  const uuid = '12345678-1234-4234-8234-123456789abc';
  assert.equal(createRecordId('project', {
    randomUUID: () => uuid,
    getRandomValues: () => { throw new Error('不应进入兼容路径'); },
  }), `project-${uuid}`);
});

test('只有 getRandomValues 的 WebView 仍产生不同的 RFC 4122 v4 标识', () => {
  const ids = Array.from({ length: 128 }, () => createRecordId('project', cryptoWithoutUUID));
  assert.ok(ids.every(id => uuidPattern.test(id)));
  assert.equal(new Set(ids).size, ids.length);
});

test('缺少 randomUUID 时能保存项目及新公司、客户联系人和活动，并保留编辑前身份', () => {
  withCrypto(cryptoWithoutUUID, () => {
    const state = execute(emptyState(), { type: 'saveProject', payload: {
      companyName: '试用客户公司', newContactNames: ['试用联系人'], project,
    } });
    const saved = state.projects[0];
    const records = [...state.projects, ...state.companies, ...state.contacts, ...state.activities];
    assert.ok(records.every(record => uuidPattern.test(record.id)));
    assert.equal(new Set(records.map(record => record.id)).size, records.length);
    assert.equal(saved.companyId, state.companies[0].id);
    assert.deepEqual(saved.contactIds, [state.contacts[0].id]);
    assert.equal(state.contacts[0].companyId, saved.companyId);
    assert.ok(state.activities.some(activity => activity.projectId === saved.id));

    const edited = execute(state, { type: 'saveProject', payload: {
      id: saved.id, companyName: state.companies[0].name,
      project: { ...project, contactIds: saved.contactIds, title: '修改后的手机项目' },
    } });
    assert.equal(edited.projects[0].id, saved.id);
    assert.equal(edited.projects[0].companyId, saved.companyId);
    assert.deepEqual(edited.projects[0].contactIds, saved.contactIds);
    assert.equal(edited.projects[0].title, '修改后的手机项目');
  });
});

test('缺少所有 Web Crypto 能力时清楚报错，保存失败不改变原始数据', () => {
  for (const source of [undefined, {}]) withCrypto(source, () => {
    const state = emptyState();
    assert.throws(() => execute(state, { type: 'saveProject', payload: {
      companyName: '不能创建的公司', newContactNames: ['不能创建的联系人'], project,
    } }), /缺少安全随机数能力/);
    assert.deepEqual(state, emptyState());
  });
});
