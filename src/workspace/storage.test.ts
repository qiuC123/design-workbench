import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeed as oldSeed } from '../board/seed';
import { createSeed as scheduleSeed } from '../scheduling/seed';
import { createSeed as workflowSeed } from '../domain/seed';
import { createSeed } from './seed';
import { execute } from './model';
import { loadWorkbench, migrateV3, saveWorkbench, STORAGE_KEY, validateState } from './storage';
import type { WorkbenchState } from './types';

const V3 = 'xu-jian-tasks-v3';
const V2 = 'xu-jian-schedule-v2';
const V1 = 'xu-jian-workbench-v1';
function oldNine() {
  const state = oldSeed();
  state.tasks.push({ ...state.tasks[0], id: 'user-project-9', title: '香氛空间', description: '用户填写的说明', ownerIds: ['member-five', 'member-one'], contactIds: ['boss', 'member-two'], startDate: '2026-10-16', endDate: '2026-10-31' });
  state.activities.push({ id: 'user-activity', projectId: state.projects[0].id, taskId: 'user-project-9', text: '用户原文：新增安排，允许并行', at: '2026-10-08T08:30:00.000Z' });
  return state;
}
function withStorage(initial: Record<string, string>, body: (store: Map<string, string>, writes: string[]) => void, failWrite = false) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const store = new Map(Object.entries(initial));
  const writes: string[] = [];
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { writes.push(key); if (failWrite) throw new Error('quota'); store.set(key, value); },
  } });
  try { body(store, writes); }
  finally { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else Reflect.deleteProperty(globalThis, 'localStorage'); }
}

test('九张原任务一对一转项目，日期、多人负责人、状态和历史保留', () => {
  const old = oldNine(); const original = structuredClone(old);
  const next = migrateV3(old);
  assert.equal(next.version, 4);
  assert.equal(next.projects.length, 9);
  for (const task of old.tasks) {
    const project = next.projects.find(project => project.id === task.id)!;
    for (const field of ['title', 'description', 'ownerIds', 'startDate', 'endDate', 'status', 'priority', 'createdAt', 'updatedAt', 'completedAt'] as const) assert.deepEqual(project[field], task[field], field);
  }
  assert.equal(next.activities.find(activity => activity.id === 'user-activity')?.projectId, 'user-project-9');
  assert.equal(next.activities.find(activity => activity.id === 'user-activity')?.text, '用户原文：新增安排，允许并行');
  assert.equal(next.projects.find(project => project.id === 'user-project-9')?.companyId, 'company-demob');
  assert.deepEqual(old, original, 'pure migration never changes source state');
});

test('只归属明确公司，新品品牌和城市不猜测，不自动从旧分类造新公司', () => {
  const next = migrateV3(oldNine());
  assert.deepEqual(next.companies.map(company => company.name), ['DemoA', '示例乙', '示例丙', '示例丁（示例设计公司）']);
  assert.equal(next.projects.find(project => project.id === 'example-task-7')?.companyId, 'company-demoa');
  for (const id of ['example-task-3', 'example-task-4', 'example-task-5', 'example-task-6']) assert.equal(next.projects.find(project => project.id === id)?.companyId, '');
  assert.match(next.migrationNotice!, /4 个项目的所属公司待确认/);
  assert.match(next.projects.find(project => project.id === 'example-task-3')!.legacyNote!, /新品展示/);
  const old = oldNine();
  old.projects[1].client = '示例丙';
  old.projects[2].client = '示例丁';
  old.projects[3].name = ' deMoA ';
  const explicit = migrateV3(old);
  assert.equal(explicit.projects.find(project => project.id === 'example-task-3')?.companyId, 'company-democ');
  assert.equal(explicit.projects.find(project => project.id === 'example-task-5')?.companyId, 'company-demod');
  assert.equal(explicit.projects.find(project => project.id === 'example-task-7')?.companyId, 'company-demoa');
  old.projects[0].client = 'DemoA';
  assert.equal(migrateV3(old).projects.find(project => project.id === 'example-task-1')?.companyId, '', 'conflicting exact evidence is not guessed');
});

test('旧老板及内部经理不成为客户对接人，原联络字段保留在历史说明', () => {
  const next = migrateV3(oldNine());
  assert.deepEqual(next.contacts, []);
  assert.ok(next.projects.every(project => project.contactIds.length === 0));
  const project = next.projects.find(project => project.id === 'user-project-9')!;
  assert.match(project.legacyNote!, /原内部对接记录：老板、成员二/);
  assert.match(project.legacyNote!, /陈女士（示例）/);
  assert.match(project.legacyNote!, /未加入客户通讯录/);
});

test('没有任务的旧分类仍归档资料，不制造额外项目卡', () => {
  const old = oldNine();
  old.projects.push({ ...old.projects[0], id: 'empty-category', name: '未落实的旧分类', contact: '待核实姓名', note: '需保留原预算说明' });
  const next = migrateV3(old);
  assert.equal(next.projects.length, 9);
  const archive = next.activities.find(activity => activity.id === 'v4-group-archive-empty-category')!;
  assert.match(archive.text, /该分类没有任务/);
  assert.match(archive.text, /待核实姓名/);
  assert.match(archive.text, /需保留原预算说明/);
});

test('早期单负责人、验收人版本兼容迁入，不改写传入对象', () => {
  const original = JSON.parse(JSON.stringify(oldNine()));
  for (const task of original.tasks) {
    task.ownerId = task.ownerIds[0] || ''; task.reviewerId = task.contactIds[0] || 'boss';
    delete task.ownerIds; delete task.contactIds;
  }
  const raw = JSON.stringify(original);
  const next = migrateV3(original);
  assert.equal(next.projects.length, 9);
  assert.deepEqual(next.projects.find(project => project.id === 'user-project-9')?.ownerIds, ['member-five']);
  assert.equal(JSON.stringify(original), raw);
});

test('迁入只写新 v4 key，旧 v1/v2/v3 原文逐字不变且刷新不会重新迁入', () => {
  const oldRaw = JSON.stringify(oldNine(), null, 2);
  withStorage({ [V3]: oldRaw, [V2]: '历史 v2 原文', [V1]: '历史 v1 原文' }, (store, writes) => {
    const first = loadWorkbench();
    assert.equal(first.warning, undefined);
    assert.equal(first.state.projects.length, 9);
    assert.deepEqual(writes, [STORAGE_KEY]);
    assert.equal(store.get(V3), oldRaw); assert.equal(store.get(V2), '历史 v2 原文'); assert.equal(store.get(V1), '历史 v1 原文');
    first.state.projects[0].title = '迁入后重新命名';
    saveWorkbench(first.state);
    const second = loadWorkbench();
    assert.equal(second.state.projects[0].title, '迁入后重新命名');
    assert.equal(second.state.projects.length, 9);
    assert.deepEqual(second.state, first.state);
    assert.equal(store.get(V3), oldRaw);
    assert.deepEqual(writes, [STORAGE_KEY, STORAGE_KEY]);
  });
});

test('迁移保存失败时完整返回迁入数据并暂停写入，原文不覆盖', () => {
  const raw = JSON.stringify(oldNine());
  withStorage({ [V3]: raw }, (store, writes) => {
    const result = loadWorkbench();
    assert.equal(result.state.projects.length, 9);
    assert.match(result.warning!, /未能保存.*暂停写入/);
    assert.equal(store.get(V3), raw); assert.equal(store.has(STORAGE_KEY), false);
    assert.deepEqual(writes, [STORAGE_KEY]);
  }, true);
});

test('损坏的新数据或旧数据均不退回覆盖为示例，不绕过优先版本', () => {
  const cases: Record<string, string>[] = [
    { [STORAGE_KEY]: '{bad', [V3]: JSON.stringify(oldNine()) },
    { [V3]: '{bad', [V2]: JSON.stringify(scheduleSeed()) },
    { [V2]: '{bad', [V1]: JSON.stringify(workflowSeed()) },
  ];
  for (const initial of cases) withStorage(initial, (store, writes) => {
    const before = [...store.entries()];
    const result = loadWorkbench();
    assert.match(result.warning!, /暂停写入/); assert.equal(result.state.projects.length, 0);
    assert.deepEqual([...store.entries()], before); assert.deepEqual(writes, []);
  });
});

test('缺少 v3 时可逐级读入 v2/v1，原始文本完整保留', () => {
  for (const [key, raw] of [[V2, JSON.stringify(scheduleSeed())], [V1, JSON.stringify(workflowSeed())]]) {
    withStorage({ [key]: raw }, (store, writes) => {
      const result = loadWorkbench();
      assert.equal(result.warning, undefined); assert.equal(result.state.version, 4);
      assert.equal(store.get(key), raw); assert.deepEqual(writes, [STORAGE_KEY]);
      assert.ok(validateState(result.state));
    });
  }
});

test('客户对接人身份按公司校验，停用后旧引用可读取，内部负责人固定', () => {
  const state = migrateV3(oldNine()); const now = new Date().toISOString();
  state.contacts.push({ id: 'contact-demob', companyId: 'company-demob', name: '客户姓名', note: '', active: false, createdAt: now, updatedAt: now });
  state.projects[0].contactIds = ['contact-demob'];
  assert.equal(validateState(state), state);
  state.projects[0].companyId = 'company-demoa';
  assert.throws(() => validateState(state), /对接人必须属于/);
  state.projects[0].companyId = '';
  assert.throws(() => validateState(state), /对接人/);
  state.projects[0].companyId = 'company-demob';
  state.projects[0].ownerIds = ['contact-demob'];
  assert.throws(() => validateState(state), /固定的五位内部成员/);
});

test('严格校验重复身份、无效日期与完成时间，但允许历史完成无负责人', () => {
  const state = migrateV3(oldNine());
  const check = (change: (copy: WorkbenchState) => void, message: RegExp) => {
    const copy = structuredClone(state); change(copy); assert.throws(() => validateState(copy), message);
  };
  check(copy => { copy.companies.push(copy.companies[0]); }, /身份重复/);
  check(copy => { copy.projects[0].ownerIds.push(copy.projects[0].ownerIds[0]); }, /重复/);
  check(copy => { copy.projects[0].startDate = '2026-02-30'; }, /排期/);
  check(copy => { copy.projects[0].endDate = '2020-01-01'; }, /排期/);
  check(copy => { copy.projects[0].status = 'done'; }, /完成时间/);
  const completed = state.projects.find(project => project.status === 'done')!;
  completed.ownerIds = [];
  assert.equal(validateState(state), state);
});

test('干净浏览器使用新版种子，不在读取时产生写入', () => {
  withStorage({}, (_store, writes) => {
    const result = loadWorkbench(); assert.equal(result.warning, undefined);
    assert.equal(result.state.version, 4); assert.ok(validateState(result.state));
    assert.deepEqual(writes, []);
  });
  assert.ok(validateState(createSeed()));
});

test('删除项目后历史可持久化，刷新仍保留删除记录', () => {
  const state = migrateV3(oldNine());
  const deleted = execute(state, { type: 'deleteProject', payload: { id: 'user-project-9' } });
  assert.equal(deleted.projects.length, 8);
  assert.ok(deleted.activities.some(activity => activity.projectId === 'user-project-9'));
  withStorage({}, () => {
    saveWorkbench(deleted);
    assert.deepEqual(loadWorkbench().state, deleted);
  });
});
