import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, applyCommand, bookings, conflicts, memberDay, nextFreeDate, today, weekStart } from './model';
import { createSeed } from './seed';
import { loadSchedule, migrateWorkflow, saveSchedule, SCHEDULE_STORAGE_KEY } from './storage';
import { createSeed as workflowSeed } from '../domain/seed';
import type { ProjectInput, ScheduleCommand, ScheduleState } from './types';

const input = (): ProjectInput => ({ name: '新排班项目', client: '虚构客户', contact: '许女士', location: '上海', startDate: today(), endDate: addDays(today(), 14), status: 'planned', note: '测试项目' });
const blank = (): ScheduleState => ({ version: 2, members: createSeed().members, projects: [], logs: [] });
function flow() {
  let state = applyCommand(blank(), { type: 'createProject', payload: input() });
  const projectId = state.projects[0].id;
  const run = (command: ScheduleCommand) => { state = applyCommand(state, command); return state; };
  const assign = (role: 'manager' | 'lead', memberId = 'm-lin', startDate = today(), endDate = addDays(today(), 5)) => run({ type: 'assign', payload: { projectId, role, memberId, startDate, endDate } });
  return { get state() { return state; }, projectId, run, assign };
}

test('创建空角色项目，先分经理、组长可长期待定，所有操作留中文记录', () => {
  const f = flow();
  assert.equal(f.state.projects[0].managerId, '');
  assert.equal(f.state.projects[0].leadId, '');
  assert.equal(bookings(f.state).length, 0);
  f.assign('manager');
  assert.equal(f.state.projects[0].managerId, 'm-lin');
  assert.equal(f.state.projects[0].leadId, '');
  assert.equal(bookings(f.state).length, 1);
  assert.ok(f.state.logs.some(log => log.text.includes('项目经理')));
  assert.ok(f.state.logs.some(log => log.text.includes('组长待定')));
});

test('按周查看从周一开始，真实日历日期与跨月运算正确', () => {
  assert.equal(weekStart('2026-10-08'), '2026-10-05');
  assert.equal(weekStart('2026-10-11'), '2026-10-05');
  assert.equal(weekStart('2026-10-12'), '2026-10-12');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  for (const invalid of ['2026-02-30', '2026-2-1', '2026-13-01', '0000-01-01', 'hello']) assert.throws(() => addDays(invalid, 0), /日期/);
});

test('日期必须有效、开始不晚于结束、角色排期在项目计划内', () => {
  assert.throws(() => applyCommand(blank(), { type: 'createProject', payload: { ...input(), startDate: '2026-02-30' } }), /日期/);
  assert.throws(() => applyCommand(blank(), { type: 'createProject', payload: { ...input(), endDate: addDays(today(), -1) } }), /结束日期不能早于/);
  const f = flow();
  assert.throws(() => f.assign('manager', 'm-lin', addDays(today(), -1)), /项目计划/);
  assert.throws(() => f.assign('manager', 'm-lin', today(), addDays(today(), 15)), /项目计划/);
  assert.throws(() => f.assign('manager', 'm-lin', addDays(today(), 2), today()), /结束日期不能早于/);
});

test('更改项目日期不得让已有角色静默超界，提示先调角色或扩大项目日期', () => {
  const f = flow(); f.assign('manager');
  assert.throws(() => f.run({ type: 'editProject', payload: { projectId: f.projectId, changes: { startDate: addDays(today(), 1) } } }), /项目经理排期.*先调整该角色排期或扩大项目日期/);
  assert.throws(() => f.run({ type: 'editProject', payload: { projectId: f.projectId, changes: { endDate: addDays(today(), 4) } } }), /项目经理排期/);
  f.assign('manager', 'm-lin', addDays(today(), 2), addDays(today(), 4));
  f.run({ type: 'editProject', payload: { projectId: f.projectId, changes: { startDate: addDays(today(), 1), endDate: addDays(today(), 5) } } });
  assert.equal(f.state.projects[0].startDate, addDays(today(), 1));
});

test('同人同项目两角色只计一个项目，首尾日期都占用', () => {
  const f = flow(); f.assign('manager'); f.assign('lead');
  const todayWork = memberDay(f.state, 'm-lin', today());
  assert.equal(todayWork.bookings.length, 2);
  assert.equal(todayWork.projectCount, 1);
  assert.equal(todayWork.conflicting, false);
  assert.equal(todayWork.free, false);
  assert.equal(memberDay(f.state, 'm-lin', addDays(today(), 5)).projectCount, 1);
  assert.equal(memberDay(f.state, 'm-lin', addDays(today(), 6)).free, true);
  assert.equal(conflicts(f.state, f.projectId, 'm-lin', today(), addDays(today(), 5)).length, 0);
});

test('跨项目重叠不阻止分配，明确计数和记录重叠提醒', () => {
  const f = flow(); f.assign('manager');
  f.run({ type: 'createProject', payload: { ...input(), name: '第二个项目' } });
  const secondId = f.state.projects[0].id;
  f.run({ type: 'assign', payload: { projectId: secondId, role: 'lead', memberId: 'm-lin', startDate: today(), endDate: addDays(today(), 3) } });
  const result = memberDay(f.state, 'm-lin', today());
  assert.equal(result.projectCount, 2);
  assert.equal(result.conflicting, true);
  assert.equal(conflicts(f.state, secondId, 'm-lin', today(), addDays(today(), 3)).length, 1);
  assert.match(f.state.logs[0].text, /重叠.*保留此次安排/);
});

test('最近空闲日期合并相邻、重叠区间，并允许安排前的空闲日', () => {
  const f = flow(); f.assign('manager', 'm-lin', today(), addDays(today(), 2));
  f.run({ type: 'createProject', payload: { ...input(), name: '相邻区间项目' } });
  f.run({ type: 'assign', payload: { projectId: f.state.projects[0].id, role: 'manager', memberId: 'm-lin', startDate: addDays(today(), 3), endDate: addDays(today(), 6) } });
  assert.equal(nextFreeDate(f.state, 'm-lin', today()), addDays(today(), 7));
  assert.equal(nextFreeDate(f.state, 'm-su', today()), today());
  assert.equal(nextFreeDate(f.state, 'm-lin', addDays(today(), -1)), addDays(today(), -1));
});

test('完成项目释放排班且保留历史，恢复进行中重新占用原排期', () => {
  const f = flow(); f.assign('manager');
  f.run({ type: 'setProjectStatus', payload: { projectId: f.projectId, status: 'done' } });
  assert.equal(bookings(f.state).length, 0);
  assert.equal(memberDay(f.state, 'm-lin', today()).free, true);
  assert.equal(f.state.projects[0].managerId, 'm-lin');
  assert.ok(f.state.projects[0].completedAt);
  assert.throws(() => f.assign('lead', 'm-chen'), /先恢复/);
  f.run({ type: 'setProjectStatus', payload: { projectId: f.projectId, status: 'active' } });
  assert.equal(bookings(f.state).length, 1);
  assert.equal(f.state.projects[0].completedAt, undefined);
});

test('停用成员保留已有安排，但不能新分配或调期，可取消和转人', () => {
  const f = flow(); f.assign('manager');
  f.run({ type: 'toggleMember', payload: { memberId: 'm-lin' } });
  assert.equal(bookings(f.state)[0].memberId, 'm-lin');
  assert.equal(memberDay(f.state, 'm-lin', today()).projectCount, 1);
  assert.throws(() => f.assign('manager', 'm-lin', addDays(today(), 1)), /已停用.*不能新增或调整/);
  f.run({ type: 'editProject', payload: { projectId: f.projectId, changes: { note: '已安排交接' } } });
  assert.equal(f.state.projects[0].managerId, 'm-lin');
  f.run({ type: 'unassign', payload: { projectId: f.projectId, role: 'manager' } });
  assert.equal(bookings(f.state).length, 0);
  f.assign('manager', 'm-zhou');
  assert.equal(f.state.projects[0].managerId, 'm-zhou');
});

test('成员与项目名称去重、改名保持稳定关联', () => {
  const f = flow(); f.assign('manager');
  assert.throws(() => f.run({ type: 'createProject', payload: { ...input(), name: ' 新排班项目 ' } }), /同名项目/);
  assert.throws(() => f.run({ type: 'addMember', payload: { name: ' 林知夏 ', specialty: '' } }), /同名成员/);
  f.run({ type: 'editMember', payload: { memberId: 'm-lin', name: '林知夏（设计负责人）', specialty: '项目统筹' } });
  assert.equal(f.state.projects[0].managerId, 'm-lin');
  assert.equal(f.state.members.find(member => member.id === 'm-lin')?.name, '林知夏（设计负责人）');
  f.run({ type: 'addMember', payload: { name: '新同事', specialty: '现场搭建' } });
  assert.equal(f.state.members.at(-1)?.active, true);
});

test('所有变化不可变且可 JSON 持久化；种子展示今日忙闲和未来排期', () => {
  const initial = createSeed();
  const before = JSON.stringify(initial);
  const result = applyCommand(initial, { type: 'setProjectStatus', payload: { projectId: 'p-atrium', status: 'done' } });
  assert.equal(JSON.stringify(initial), before);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  assert.equal(initial.members.length, 5);
  assert.equal(initial.projects.length, 6);
  for (const memberId of ['m-lin', 'm-zhou', 'm-chen']) assert.equal(memberDay(initial, memberId, today()).free, false);
  for (const memberId of ['m-wang', 'm-su']) assert.equal(memberDay(initial, memberId, today()).free, true);
  assert.ok(bookings(initial).some(booking => booking.memberId === 'm-wang' && booking.startDate > today()));
  assert.ok(initial.projects.some(project => !project.managerId && project.status !== 'done'));
  assert.ok(initial.projects.some(project => project.managerId && !project.leadId));
  assert.ok(initial.projects.some(project => project.status === 'done'));
});

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
function storageTest(run: (storage: MemoryStorage) => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  try { run(storage); }
  finally { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else Reflect.deleteProperty(globalThis, 'localStorage'); }
}

test('旧流程迁入为纯转换，保留项目和成员身份、经理组长，标记日期为建议', () => {
  const legacy = workflowSeed();
  const before = JSON.stringify(legacy);
  const state = migrateWorkflow(legacy);
  assert.equal(JSON.stringify(legacy), before);
  assert.equal(state.version, 2);
  assert.equal(state.migratedFromWorkflow, true);
  assert.deepEqual(state.members.map(member => member.id), legacy.members.map(member => member.id));
  assert.equal(state.projects.length, legacy.projects.length);
  for (const project of state.projects) {
    const old = legacy.projects.find(item => item.id === project.id)!;
    assert.equal(project.managerId, old.managerId);
    assert.equal(project.leadId, old.leadId);
    assert.ok(project.startDate <= project.endDate);
    assert.ok(!project.leadId || (project.leadStartDate >= project.startDate && project.leadEndDate <= project.endDate));
    assert.match(project.note, /排期为建议值/);
  }
  assert.equal(state.projects.find(project => project.id === 'p-completed')?.status, 'done');
});

test('首次迁入只创建新 key，不改不删旧 key，关闭提示后持久保留', () => storageTest(storage => {
  const raw = JSON.stringify(workflowSeed());
  storage.setItem('xu-jian-workbench-v1', raw);
  const loaded = loadSchedule();
  assert.equal(loaded.warning, undefined);
  assert.equal(loaded.state.migratedFromWorkflow, true);
  assert.equal(storage.getItem('xu-jian-workbench-v1'), raw);
  assert.ok(storage.getItem(SCHEDULE_STORAGE_KEY));
  const dismissed = applyCommand(loaded.state, { type: 'dismissMigrationNotice', payload: {} });
  saveSchedule(dismissed);
  assert.equal(loadSchedule().state.migratedFromWorkflow, false);
  assert.equal(storage.getItem('xu-jian-workbench-v1'), raw);
}));

test('损坏 v2 提示恢复示例而不静默覆盖；明确保存可建立新排班', () => storageTest(storage => {
  const broken = '{"version":2,"projects":[]}';
  storage.setItem(SCHEDULE_STORAGE_KEY, broken);
  const loaded = loadSchedule();
  assert.match(loaded.warning!, /原数据尚未被覆盖.*恢复示例数据/);
  assert.equal(storage.getItem(SCHEDULE_STORAGE_KEY), broken);
  saveSchedule(createSeed());
  assert.equal(loadSchedule().warning, undefined);
  assert.equal(loadSchedule().state.version, 2);
}));
