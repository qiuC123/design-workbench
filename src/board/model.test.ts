import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, execute, MANAGERS, nextFreeDate, overlapTasks, personDay, scheduledTasks, today, validDate, weekStart } from './model';
import { createSeed, SEED_PROJECT_NAMES } from './seed';
import { loadWorkbench, migrateSchedule, saveWorkbench, STORAGE_KEY, upgradeSeedProjectNames, upgradeTaskPeople, validateState } from './storage';
import { createSeed as oldScheduleSeed } from '../scheduling/seed';
import { createSeed as oldWorkflowSeed } from '../domain/seed';
import type { Command, ProjectInput, TaskInput, WorkbenchState } from './types';

const projectInput = (): ProjectInput => ({ name: '测试示例项目', client: '示例客户', contact: '示例联系人', location: '上海', startDate: addDays(today(), -10), endDate: addDays(today(), 20), managerId: 'member-one', status: 'active', note: '', color: '#467c72' });
const blank = (): WorkbenchState => ({ version: 3, projects: [], tasks: [], activities: [] });
function flow() {
  let state = execute(blank(), { type: 'createProject', payload: projectInput() });
  const projectId = state.projects[0].id;
  const run = (command: Command) => { state = execute(state, command); return state; };
  const input = (changes: Partial<TaskInput> = {}): TaskInput => ({ projectId, title: '任务示例', description: '测试任务', ownerIds: ['member-one'], contactIds: ['boss'], startDate: today(), endDate: addDays(today(), 2), status: 'todo', priority: 'normal', ...changes });
  const create = (changes: Partial<TaskInput> = {}) => { run({ type: 'createTask', payload: input(changes) }); return state.tasks[0].id; };
  return { get state() { return state; }, projectId, run, input, create };
}
function withStorage(initial: Record<string, string>, body: (store: Map<string, string>) => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const store = new Map(Object.entries(initial));
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  } });
  try { body(store); }
  finally { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else Reflect.deleteProperty(globalThis, 'localStorage'); }
}

test('固定五位项目经理，项目经理字段本身不占排班，待分配任务可以创建', () => {
  assert.deepEqual(MANAGERS.map(item => item.name), ['成员一', '成员二', '成员三', '成员四', '成员五']);
  assert.equal(new Set(MANAGERS.map(item => item.id)).size, 5);
  const f = flow();
  assert.equal(scheduledTasks(f.state).length, 0);
  f.create({ ownerIds: [] });
  assert.equal(scheduledTasks(f.state).length, 0);
  assert.equal(personDay(f.state, 'member-one', today()).free, true);
  assert.throws(() => f.create({ ownerIds: ['someone-else'] }), /五位项目经理/);
  assert.throws(() => f.create({ contactIds: [''] }), /对接人/);
});

test('周从周一开始，日期真实有效，首尾日期均计入任务排班', () => {
  assert.equal(weekStart('2026-10-08'), '2026-10-05');
  assert.equal(weekStart('2026-10-11'), '2026-10-05');
  assert.equal(weekStart('2026-10-12'), '2026-10-12');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  for (const invalid of ['', '2026-02-30', '2026-13-01', '0000-01-01']) assert.equal(validDate(invalid), false);
  const f = flow(); f.create();
  assert.equal(personDay(f.state, 'member-one', today()).tasks.length, 1);
  assert.equal(personDay(f.state, 'member-one', addDays(today(), 2)).tasks.length, 1);
  assert.equal(personDay(f.state, 'member-one', addDays(today(), 3)).free, true);
  assert.throws(() => overlapTasks(f.state, 'member-one', '', today()), /日期/);
});

test('任务按执行负责人计排班，对接人不重复占用；同项目两任务也显示重叠', () => {
  const f = flow();
  const first = f.create({ contactIds: ['member-two'], status: 'review' });
  assert.equal(personDay(f.state, 'member-two', today()).free, true);
  assert.equal(personDay(f.state, 'member-one', today()).free, false);
  f.create({ title: '同项目另一任务' });
  assert.equal(personDay(f.state, 'member-one', today()).tasks.length, 2);
  assert.equal(personDay(f.state, 'member-one', today()).overlapping, true);
  assert.equal(overlapTasks(f.state, 'member-one', today(), today(), first).length, 1);
  assert.match(f.state.activities[0].text, /保留重叠安排/);
});

test('任务日期必须有效且结束不早于开始，基本日期错误不写入', () => {
  const f = flow(); f.create();
  const original = structuredClone(f.state);
  assert.throws(() => f.create({ startDate: '2026-02-30' }), /日期/);
  assert.throws(() => f.create({ startDate: addDays(today(), 3), endDate: today() }), /结束日期/);
  assert.deepEqual(f.state, original);
});

test('并行和超出项目计划仅提醒：新建修改、项目缩期、刷新和完成均按老板安排', () => {
  const f = flow(); const first = f.create();
  const second = f.create({ title: '同时执行的任务', startDate: addDays(today(), -12), endDate: addDays(today(), 21), status: 'doing' });
  assert.match(f.state.activities[0].text, /保留重叠安排.*超出项目计划/);
  f.run({ type: 'editTask', payload: { id: first, changes: f.input({ endDate: addDays(today(), 28), status: 'doing' }) } });
  assert.equal(personDay(f.state, 'member-one', today()).tasks.length, 2);
  assert.equal(f.state.projects[0].endDate, projectInput().endDate);
  const originalTasks = structuredClone(f.state.tasks);
  f.run({ type: 'editProject', payload: { id: f.projectId, changes: { ...projectInput(), startDate: today(), endDate: addDays(today(), 1) } } });
  assert.deepEqual(f.state.tasks, originalTasks);
  assert.match(f.state.activities[0].text, /2 项任务超出项目计划.*保留原任务日期/);
  withStorage({}, () => {
    saveWorkbench(f.state);
    const restored = loadWorkbench();
    assert.equal(restored.warning, undefined);
    assert.deepEqual(restored.state, f.state);
    assert.equal(personDay(restored.state, 'member-one', addDays(today(), 28)).tasks[0].id, first);
    assert.equal(personDay(restored.state, 'member-one', addDays(today(), -12)).tasks[0].id, second);
  });
  f.run({ type: 'setTaskStatus', payload: { id: first, status: 'done' } });
  assert.equal(f.state.tasks.find(t => t.id === first)!.status, 'done');
  assert.equal(personDay(f.state, 'member-one', today()).tasks[0].id, second);
});

test('未分配任务不能通过创建、编辑、推进绕过负责人要求', () => {
  const f = flow(); const taskId = f.create({ ownerIds: [] });
  for (const status of ['doing', 'review', 'done'] as const) {
    assert.throws(() => f.create({ ownerIds: [], status }), /先分配负责人/);
    assert.throws(() => f.run({ type: 'setTaskStatus', payload: { id: taskId, status } }), /先分配负责人/);
    assert.throws(() => f.run({ type: 'editTask', payload: { id: taskId, changes: f.input({ ownerIds: [], status }) } }), /先分配负责人/);
  }
  assert.equal(f.state.tasks.length, 1);
  assert.equal(f.state.tasks[0].status, 'todo');
});

test('待办到执行再到核验，退回必须有意见，通过释放排班且不会自动完成项目', () => {
  const f = flow(); const taskId = f.create({ contactIds: ['member-two'] });
  assert.throws(() => f.run({ type: 'reviewTask', payload: { id: taskId, approved: true, note: '' } }), /待核验/);
  f.run({ type: 'setTaskStatus', payload: { id: taskId, status: 'doing' } });
  f.run({ type: 'setTaskStatus', payload: { id: taskId, status: 'review' } });
  assert.throws(() => f.run({ type: 'reviewTask', payload: { id: taskId, approved: false, note: '  ' } }), /退回修改意见/);
  f.run({ type: 'reviewTask', payload: { id: taskId, approved: false, note: '入口尺寸需要复核' } });
  assert.equal(f.state.tasks[0].status, 'doing');
  assert.match(f.state.activities[0].text, /老板记录.*退回修改.*成员一.*入口尺寸需要复核/);
  f.run({ type: 'setTaskStatus', payload: { id: taskId, status: 'review' } });
  f.run({ type: 'reviewTask', payload: { id: taskId, approved: true, note: '尺寸已确认' } });
  assert.equal(f.state.tasks[0].status, 'done');
  assert.ok(f.state.tasks[0].completedAt);
  assert.equal(personDay(f.state, 'member-one', today()).free, true);
  assert.equal(f.state.projects[0].status, 'active');
  assert.ok(f.state.activities.some(item => item.text.includes('入口尺寸需要复核')));
  assert.match(f.state.activities[0].text, /老板记录.*核验通过.*尺寸已确认/);
});

test('直接完成由老板记录核验，对接人不自动代表核验人，重新开始清除实际完成时间并恢复排班', () => {
  const f = flow(); const taskId = f.create({ contactIds: ['member-five'] });
  f.run({ type: 'setTaskStatus', payload: { id: taskId, status: 'done' } });
  assert.ok(f.state.tasks[0].completedAt);
  assert.match(f.state.activities[0].text, /老板记录.*核验通过/);
  f.run({ type: 'setTaskStatus', payload: { id: taskId, status: 'doing' } });
  assert.equal(f.state.tasks[0].completedAt, undefined);
  assert.equal(scheduledTasks(f.state).length, 1);
});

test('改派、调期与删除即时更新两人的排班，删除后仍保留记录', () => {
  const f = flow(); const taskId = f.create();
  f.run({ type: 'editTask', payload: { id: taskId, changes: f.input({ ownerIds: ['member-four'], startDate: addDays(today(), 2), endDate: addDays(today(), 5) }) } });
  assert.equal(personDay(f.state, 'member-one', today()).free, true);
  assert.equal(personDay(f.state, 'member-four', today()).free, true);
  assert.equal(personDay(f.state, 'member-four', addDays(today(), 3)).tasks[0].id, taskId);
  f.run({ type: 'deleteTask', payload: { id: taskId } });
  assert.equal(f.state.tasks.length, 0);
  assert.equal(personDay(f.state, 'member-four', addDays(today(), 3)).free, true);
  assert.match(f.state.activities[0].text, /删除任务.*排班已释放/);
  assert.doesNotThrow(() => validateState(f.state));
});

test('项目完成须无未完成任务；完成后禁止新增或修改任务，恢复项目后可再处理', () => {
  const f = flow(); const taskId = f.create();
  assert.throws(() => f.run({ type: 'setProjectStatus', payload: { id: f.projectId, status: 'done' } }), /未完成任务/);
  assert.throws(() => f.run({ type: 'editProject', payload: { id: f.projectId, changes: { ...projectInput(), status: 'done' } } }), /未完成任务/);
  f.run({ type: 'setTaskStatus', payload: { id: taskId, status: 'done' } });
  f.run({ type: 'setProjectStatus', payload: { id: f.projectId, status: 'done' } });
  assert.ok(f.state.projects[0].completedAt);
  assert.throws(() => f.create(), /项目已完成/);
  assert.throws(() => f.run({ type: 'setTaskStatus', payload: { id: taskId, status: 'doing' } }), /项目已完成/);
  assert.throws(() => f.run({ type: 'editTask', payload: { id: taskId, changes: f.input({ status: 'done' }) } }), /项目已完成/);
  assert.throws(() => f.run({ type: 'deleteTask', payload: { id: taskId } }), /项目已完成/);
  f.run({ type: 'setProjectStatus', payload: { id: f.projectId, status: 'active' } });
  f.run({ type: 'setTaskStatus', payload: { id: taskId, status: 'doing' } });
  assert.equal(f.state.projects[0].completedAt, undefined);
  assert.equal(scheduledTasks(f.state).length, 1);
});

test('最近空闲日期合并相邻任务，忽略已完成任务，识别任务之间的空档', () => {
  const f = flow(); f.create();
  f.create({ title: '第二项任务', startDate: addDays(today(), 3), endDate: addDays(today(), 4) });
  f.create({ title: '已完成任务', startDate: addDays(today(), 5), endDate: addDays(today(), 7), status: 'done' });
  f.create({ title: '未来任务', startDate: addDays(today(), 7), endDate: addDays(today(), 9) });
  assert.equal(nextFreeDate(f.state, 'member-one', today()), addDays(today(), 5));
  assert.equal(nextFreeDate(f.state, 'member-two', today()), today());
  assert.equal(nextFreeDate(f.state, 'member-one', addDays(today(), -1)), addDays(today(), -1));
});

test('命令不可变，失败不改原状态，任务可跨项目移动并留双边记录', () => {
  const f = flow(); const taskId = f.create();
  const snapshot = structuredClone(f.state);
  const next = execute(f.state, { type: 'setTaskStatus', payload: { id: taskId, status: 'doing' } });
  assert.deepEqual(f.state, snapshot);
  assert.notEqual(next.tasks[0], f.state.tasks[0]);
  assert.throws(() => execute(f.state, { type: 'editTask', payload: { id: taskId, changes: f.input({ title: '' }) } }), /任务名称/);
  assert.deepEqual(f.state, snapshot);
  f.run({ type: 'createProject', payload: { ...projectInput(), name: '第二个示例项目' } });
  const targetId = f.state.projects[0].id;
  f.run({ type: 'editTask', payload: { id: taskId, changes: f.input({ projectId: targetId }) } });
  assert.equal(f.state.tasks[0].projectId, targetId);
  assert.ok(f.state.activities.some(item => item.projectId === f.projectId && item.text.includes('移至项目')));
  assert.equal(f.state.activities[0].projectId, targetId);
});

test('示例数据使用用户指定姓名、动态日期、四种状态，今天有三人忙两人空闲', () => {
  const state = validateState(createSeed());
  assert.deepEqual(state.projects.map(project => project.name), ['示例乙香氛', '新品展示', '城市车展', 'DemoA']);
  assert.equal(state.projects.every(project => project.note.includes('示例')), true);
  assert.deepEqual([...new Set(state.tasks.map(task => task.status))].sort(), ['doing', 'done', 'review', 'todo']);
  assert.equal(MANAGERS.filter(manager => personDay(state, manager.id, today()).free).length, 2);
  assert.equal(state.tasks.some(task => !task.ownerIds.length), true);
  assert.equal(JSON.stringify(state).includes('leadId'), false);
});

test('旧排班仅按同名经理映射身份，未知姓名待分配并保留原日期，旧数据不变', () => {
  const old = oldScheduleSeed();
  old.members[0].name = '成员二';
  const original = JSON.stringify(old);
  const migrated = migrateSchedule(old);
  assert.equal(JSON.stringify(old), original);
  assert.equal(migrated.projects.length, old.projects.length);
  assert.equal(migrated.tasks.length, old.projects.filter(project => project.managerId).length);
  for (const project of old.projects.filter(item => item.managerId)) {
    const task = migrated.tasks.find(item => item.projectId === project.id)!;
    const oldName = old.members.find(member => member.id === project.managerId)!.name;
    assert.deepEqual(task.ownerIds, oldName === '成员二' ? ['member-two'] : []);
    assert.equal(task.startDate, project.managerStartDate);
    assert.equal(task.endDate, project.managerEndDate);
    assert.ok(task.description.includes(oldName));
    if (project.status !== 'done' && !task.ownerIds.length) assert.equal(task.status, 'todo');
  }
  assert.equal(JSON.stringify(migrated).includes('leadId'), false);
  assert.equal(migrated.activities.some(item => item.text.includes('组长')), false);
  assert.ok(migrated.migrationNotice);
});

test('首次读取迁移仅新建v3，原v2逐字保留，刷新优先读取已编辑v3', () => {
  const original = JSON.stringify(oldScheduleSeed());
  withStorage({ 'xu-jian-schedule-v2': original }, store => {
    const first = loadWorkbench();
    assert.equal(first.warning, undefined);
    assert.equal(store.get('xu-jian-schedule-v2'), original);
    assert.ok(store.has(STORAGE_KEY));
    const changed = execute(first.state, { type: 'dismissMigration', payload: {} });
    saveWorkbench(changed);
    assert.deepEqual(loadWorkbench().state, changed);
    assert.equal(loadWorkbench().state.migrationNotice, undefined);
  });
});

test('未知姓名的历史已完成任务允许项目恢复后保存刷新，且始终不占排班', () => {
  const old = oldScheduleSeed();
  const historicalProject = old.projects.find(project => project.status === 'done' && project.managerId)!;
  const migrated = migrateSchedule(old);
  const task = migrated.tasks.find(item => item.projectId === historicalProject.id)!;
  assert.equal(task.status, 'done');
  assert.deepEqual(task.ownerIds, []);
  const restored = execute(migrated, { type: 'setProjectStatus', payload: { id: historicalProject.id, status: 'active' } });
  withStorage({}, () => {
    saveWorkbench(restored);
    const loaded = loadWorkbench();
    assert.equal(loaded.warning, undefined);
    assert.deepEqual(loaded.state, restored);
    assert.equal(loaded.state.projects.find(project => project.id === historicalProject.id)!.status, 'active');
    assert.equal(scheduledTasks(loaded.state).some(item => item.id === task.id), false);
    assert.throws(() => execute(loaded.state, { type: 'setTaskStatus', payload: { id: task.id, status: 'doing' } }), /先分配负责人/);
    assert.throws(() => execute(loaded.state, { type: 'setTaskStatus', payload: { id: task.id, status: 'done' } }), /先分配负责人/);
    const deleted = execute(loaded.state, { type: 'deleteTask', payload: { id: task.id } });
    assert.equal(deleted.tasks.some(item => item.id === task.id), false);
  });
});

test('仅有最初流程版时可只读迁入，v1原文保留且不创建中间v2', () => {
  const original = JSON.stringify(oldWorkflowSeed());
  withStorage({ 'xu-jian-workbench-v1': original }, store => {
    const result = loadWorkbench();
    assert.equal(result.warning, undefined);
    assert.equal(store.get('xu-jian-workbench-v1'), original);
    assert.equal(store.has('xu-jian-schedule-v2'), false);
    assert.ok(store.has(STORAGE_KEY));
    assert.ok(result.state.projects.length);
    assert.match(result.state.migrationNotice!, /日期是初始建议/);
  });
});

test('坏v3不回退覆盖，坏v2不生成v3；无效保存失败且原文保留', () => {
  withStorage({ [STORAGE_KEY]: '{broken', 'xu-jian-schedule-v2': JSON.stringify(oldScheduleSeed()) }, store => {
    const result = loadWorkbench();
    assert.ok(result.warning);
    assert.equal(store.get(STORAGE_KEY), '{broken');
    const invalid = createSeed(); invalid.tasks[0].endDate = '2026-02-30';
    assert.throws(() => saveWorkbench(invalid), /日期/);
    assert.equal(store.get(STORAGE_KEY), '{broken');
  });
  withStorage({ 'xu-jian-schedule-v2': '{broken' }, store => {
    assert.ok(loadWorkbench().warning);
    assert.equal(store.has(STORAGE_KEY), false);
    assert.equal(store.get('xu-jian-schedule-v2'), '{broken');
  });
});

test('保存并刷新共用同一任务数据，原有项目经理不会造成额外排班', () => {
  const f = flow(); const taskId = f.create({ ownerIds: ['member-five'], contactIds: ['member-four'] });
  withStorage({}, () => {
    saveWorkbench(f.state);
    const loaded = loadWorkbench().state;
    assert.deepEqual(loaded, f.state);
    assert.equal(personDay(loaded, 'member-one', today()).free, true);
    assert.equal(personDay(loaded, 'member-four', today()).free, true);
    assert.equal(personDay(loaded, 'member-five', today()).tasks[0].id, taskId);
  });
});

test('自由输入所属项目复用同名项目：去除首尾空格、忽略大小写，只创建一次', () => {
  const f = flow();
  const { projectId: _unused, ...task } = f.input({ ownerIds: ['member-five'], contactIds: ['member-two'], status: 'doing' });
  f.run({ type: 'saveTaskByProjectName', payload: { projectName: '  DemoA  ', task } });
  const created = f.state.projects.find(project => project.name === 'DemoA')!;
  assert.equal(created.managerId, 'member-five');
  assert.equal(created.startDate, task.startDate);
  assert.equal(created.endDate, task.endDate);
  assert.equal(created.status, 'active');
  for (const field of ['client', 'contact', 'location', 'note'] as const) assert.equal(created[field], '');
  f.run({ type: 'saveTaskByProjectName', payload: { projectName: ' dEMOA ', task: { ...task, title: '另一项工作' } } });
  assert.equal(f.state.projects.filter(project => project.name.toLowerCase() === 'demoa').length, 1);
  assert.equal(f.state.tasks.filter(task => task.projectId === created.id).length, 2);
  assert.equal(personDay(f.state, 'member-five', today()).tasks.length, 2);
  f.run({ type: 'saveTaskByProjectName', payload: { projectName: '暂未启动', task: { ...task, ownerIds: [], status: 'todo' } } });
  assert.equal(f.state.projects[0].status, 'planned');
  assert.equal(f.state.projects[0].managerId, '');
});

test('修改所属项目保留任务身份、人员、日期与历史，并在前后项目记录移动', () => {
  const f = flow();
  const taskId = f.create({ ownerIds: ['member-five'], contactIds: ['member-four'], status: 'review', endDate: addDays(today(), 30) });
  const originalTask = structuredClone(f.state.tasks[0]);
  const originalHistory = structuredClone(f.state.activities);
  const originalState = structuredClone(f.state);
  f.run({ type: 'createProject', payload: { ...projectInput(), name: '城市车展', managerId: 'member-two' } });
  const target = f.state.projects[0];
  const { projectId: _unused, ...task } = originalTask;
  f.run({ type: 'saveTaskByProjectName', payload: { id: taskId, projectName: ' 城市车展 ', task } });
  const moved = f.state.tasks[0];
  assert.equal(moved.projectId, target.id);
  assert.equal(f.state.projects.length, 2);
  for (const field of ['id', 'title', 'description', 'ownerIds', 'contactIds', 'startDate', 'endDate', 'status', 'priority', 'createdAt'] as const) assert.deepEqual(moved[field], originalTask[field]);
  for (const activity of originalHistory) assert.deepEqual(f.state.activities.find(item => item.id === activity.id), activity);
  assert.ok(f.state.activities.some(item => item.taskId === taskId && item.projectId === originalState.projects[0].id && item.text.includes('移至项目「城市车展」')));
  assert.equal(f.state.activities[0].projectId, target.id);
  assert.deepEqual(personDay(f.state, 'member-five', today()).tasks.map(task => task.id), [taskId]);
  assert.equal(personDay(f.state, 'member-two', today()).free, true);
  withStorage({}, () => {
    saveWorkbench(f.state);
    assert.deepEqual(loadWorkbench().state, f.state);
  });
});

test('输入新项目但任务无效时不留下空项目，已完成同名项目不重复新建', () => {
  const f = flow();
  const taskId = f.create();
  const { projectId: _unused, ...task } = f.input();
  const original = structuredClone(f.state);
  for (const payload of [
    { projectName: '新项目', task: { ...task, title: '' } },
    { projectName: '新项目', task: { ...task, ownerIds: [], status: 'doing' as const } },
    { projectName: '新项目', task: { ...task, startDate: '2026-02-30' } },
    { projectName: '新项目', id: 'missing-task', task },
    { projectName: '  ', id: taskId, task },
  ]) {
    assert.throws(() => f.run({ type: 'saveTaskByProjectName', payload }));
    assert.deepEqual(f.state, original);
  }
  f.run({ type: 'createProject', payload: { ...projectInput(), name: 'DemoA', status: 'done' } });
  const withCompleted = structuredClone(f.state);
  assert.throws(() => f.run({ type: 'saveTaskByProjectName', payload: { projectName: ' demoa ', task } }), /项目已完成/);
  assert.throws(() => f.run({ type: 'saveTaskByProjectName', payload: { id: taskId, projectName: 'DemoA', task } }), /项目已完成/);
  assert.deepEqual(f.state, withCompleted);
});

function previousSeedNames(): WorkbenchState {
  const state = createSeed();
  delete state.seedProjectNamesRevision;
  for (const item of SEED_PROJECT_NAMES) state.projects.find(project => project.id === item.id)!.name = item.previous;
  return state;
}

test('旧示例项目名仅在 ID 与原名同时匹配且无重名时更新一次', () => {
  const state = previousSeedNames();
  state.projects[1].name = '老板已经编辑的项目';
  state.projects.push({ ...state.projects[0], id: 'user-created', name: ' demoa ' });
  state.projects.push({ ...state.projects[0], id: 'same-name-different-id' });
  const original = structuredClone(state);
  const upgraded = upgradeSeedProjectNames(state);
  assert.deepEqual(state, original);
  assert.equal(upgraded.projects.find(project => project.id === 'example-museum')!.name, '示例乙香氛');
  assert.equal(upgraded.projects.find(project => project.id === 'example-launch')!.name, '老板已经编辑的项目');
  assert.equal(upgraded.projects.find(project => project.id === 'example-window')!.name, '城市车展');
  assert.equal(upgraded.projects.find(project => project.id === 'example-concept')!.name, '艺术空间概念提案 · 示例');
  assert.equal(upgraded.projects.find(project => project.id === 'same-name-different-id')!.name, '城市记忆展厅 · 示例');
  assert.deepEqual(upgraded.tasks, state.tasks);
  assert.deepEqual(upgraded.activities, state.activities);
  assert.equal(upgraded.seedProjectNamesRevision, 1);
  upgraded.projects.find(project => project.id === 'example-museum')!.name = '城市记忆展厅 · 示例';
  assert.equal(upgradeSeedProjectNames(upgraded), upgraded);
  assert.equal(upgraded.projects.find(project => project.id === 'example-museum')!.name, '城市记忆展厅 · 示例');
});

test('旧示例项目名升级保存后刷新不重做，用户新增任务与旧存储原文保留', () => {
  const previous = previousSeedNames();
  previous.tasks.push({ ...previous.tasks[0], id: 'user-task', title: '用户创建的进行中任务', ownerIds: ['member-five'], endDate: addDays(today(), 40) });
  const originalTasks = structuredClone(previous.tasks);
  const oldSchedule = JSON.stringify(oldScheduleSeed());
  withStorage({ [STORAGE_KEY]: JSON.stringify(previous), 'xu-jian-schedule-v2': oldSchedule }, store => {
    const loaded = loadWorkbench();
    assert.equal(loaded.warning, undefined);
    assert.deepEqual(loaded.state.projects.map(project => project.name), ['示例乙香氛', '新品展示', '城市车展', 'DemoA']);
    assert.deepEqual(loaded.state.tasks, originalTasks);
    assert.equal(loaded.state.tasks.length, 9);
    assert.deepEqual(loaded.state.activities, previous.activities);
    assert.equal(store.get('xu-jian-schedule-v2'), oldSchedule);
    const saved = store.get(STORAGE_KEY);
    assert.equal(JSON.parse(saved!).seedProjectNamesRevision, 1);
    assert.deepEqual(loadWorkbench().state, loaded.state);
    assert.equal(store.get(STORAGE_KEY), saved);
  });
});

test('示例项目名升级写入失败时返回原有效数据，不回退示例、不覆盖原文', () => {
  const previous = previousSeedNames();
  previous.tasks.push({ ...previous.tasks[0], id: 'user-task', title: '用户创建的任务' });
  const raw = JSON.stringify(previous);
  withStorage({ [STORAGE_KEY]: raw }, store => {
    localStorage.setItem = () => { throw new Error('quota exceeded'); };
    const loaded = loadWorkbench();
    assert.match(loaded.warning!, /更新未能保存.*原项目和任务/);
    assert.deepEqual(loaded.state, previous);
    assert.equal(loaded.state.tasks.length, 9);
    assert.equal(store.get(STORAGE_KEY), raw);
  });
});

test('多人共同负责只计一项任务，各人按共享日期排班，对接人不占排班', () => {
  const f = flow();
  const taskId = f.create({ ownerIds: ['member-one', 'member-two'], contactIds: ['member-four'], status: 'doing' });
  assert.equal(f.state.tasks.length, 1);
  assert.equal(scheduledTasks(f.state).length, 1);
  for (const owner of ['member-one', 'member-two']) {
    assert.deepEqual(personDay(f.state, owner, today()).tasks.map(task => task.id), [taskId]);
    assert.equal(nextFreeDate(f.state, owner, today()), addDays(today(), 3));
  }
  assert.equal(personDay(f.state, 'member-four', today()).free, true);
  f.create({ title: '另一项共同任务', ownerIds: ['member-one', 'member-two'], endDate: addDays(today(), 4) });
  assert.equal(scheduledTasks(f.state).length, 2);
  assert.match(f.state.activities[0].text, /同期另有 1 项任务/);
  for (const owner of ['member-one', 'member-two']) {
    assert.equal(personDay(f.state, owner, today()).overlapping, true);
    assert.equal(overlapTasks(f.state, owner, today(), addDays(today(), 1), taskId).length, 1);
    assert.equal(nextFreeDate(f.state, owner, today()), addDays(today(), 5));
  }
});

test('移除或改派共同负责人即时释放原人员，完成一次同时释放所有负责人排班', () => {
  const f = flow();
  const taskId = f.create({ ownerIds: ['member-one', 'member-two'], contactIds: ['member-four'], status: 'doing' });
  f.run({ type: 'editTask', payload: { id: taskId, changes: f.input({ ownerIds: ['member-two', 'member-five'], contactIds: ['member-four'], status: 'doing' }) } });
  assert.equal(personDay(f.state, 'member-one', today()).free, true);
  for (const owner of ['member-two', 'member-five']) assert.equal(personDay(f.state, owner, today()).tasks[0].id, taskId);
  f.run({ type: 'setTaskStatus', payload: { id: taskId, status: 'review' } });
  f.run({ type: 'reviewTask', payload: { id: taskId, approved: false, note: '补充尺寸' } });
  assert.match(f.state.activities[0].text, /老板记录.*退回修改，由成员二、成员五继续处理.*补充尺寸/);
  assert.equal(f.state.activities[0].text.includes('成员四'), false);
  f.run({ type: 'setTaskStatus', payload: { id: taskId, status: 'review' } });
  f.run({ type: 'reviewTask', payload: { id: taskId, approved: true, note: '已确认' } });
  assert.match(f.state.activities[0].text, /老板记录.*核验通过/);
  assert.equal(f.state.activities[0].text.includes('成员四'), false);
  assert.equal(scheduledTasks(f.state).length, 0);
  assert.equal(f.state.tasks.length, 1);
  for (const owner of ['member-two', 'member-five']) assert.equal(personDay(f.state, owner, today()).free, true);
  f.run({ type: 'setTaskStatus', payload: { id: taskId, status: 'doing' } });
  assert.equal(scheduledTasks(f.state).length, 1);
  for (const owner of ['member-two', 'member-five']) assert.equal(personDay(f.state, owner, today()).free, false);
});

test('负责人去重且不修改输入数组，非法身份与空负责人推进仍受校验', () => {
  const f = flow();
  const owners = ['member-one', 'member-two', 'member-one'];
  const taskId = f.create({ ownerIds: owners });
  assert.deepEqual(f.state.tasks[0].ownerIds, ['member-one', 'member-two']);
  assert.deepEqual(owners, ['member-one', 'member-two', 'member-one']);
  f.run({ type: 'editTask', payload: { id: taskId, changes: f.input({ ownerIds: ['member-two', 'member-two'] }) } });
  assert.deepEqual(f.state.tasks[0].ownerIds, ['member-two']);
  const before = structuredClone(f.state);
  for (const invalid of [undefined, 'member-one', [null], [''], ['boss'], ['not-a-manager']]) {
    assert.throws(() => f.create({ ownerIds: invalid as unknown as string[] }), /五位项目经理/);
    assert.deepEqual(f.state, before);
  }
  const { projectId: _unused, ...task } = f.input({ ownerIds: ['member-two', 'member-one', 'member-two'] });
  f.run({ type: 'saveTaskByProjectName', payload: { projectName: '多人新项目', task } });
  assert.deepEqual(f.state.tasks[0].ownerIds, ['member-two', 'member-one']);
  assert.equal(f.state.projects[0].managerId, 'member-two');
  assert.equal(f.state.projects[0].color, MANAGERS.find(manager => manager.id === 'member-two')!.color);
  withStorage({}, () => {
    saveWorkbench(f.state);
    assert.deepEqual(loadWorkbench().state, f.state);
  });
});

function singleOwnerV3() {
  const current = createSeed();
  return {
    ...current,
    tasks: current.tasks.map(({ ownerIds, contactIds, ...task }) => ({ ...task, ownerId: ownerIds[0] || '', reviewerId: contactIds[0] || 'boss' })),
  };
}

test('旧v3单负责人及验收人升级后保留任务身份排期与历史，刷新持久化新字段', () => {
  const legacy = singleOwnerV3();
  legacy.tasks.push({ ...legacy.tasks[0], id: 'user-multi-upgrade', title: '用户创建任务', ownerId: 'member-five', reviewerId: 'member-four', endDate: addDays(today(), 40) });
  legacy.activities.push({ id: 'old-review-history', projectId: legacy.tasks[0].projectId, taskId: legacy.tasks[0].id, text: '老板代记：由成员二核验通过（历史原文）', at: legacy.tasks[0].createdAt });
  const original = JSON.stringify(legacy);
  const converted = upgradeTaskPeople(legacy);
  assert.equal(converted.changed, true);
  assert.equal(JSON.stringify(legacy), original);
  assert.deepEqual(converted.state.projects, legacy.projects);
  assert.deepEqual(converted.state.activities, legacy.activities);
  for (const old of legacy.tasks) {
    const current = converted.state.tasks.find(task => task.id === old.id)!;
    const { ownerId, reviewerId, ...details } = old;
    assert.deepEqual(current, { ...details, ownerIds: ownerId ? [ownerId] : [], contactIds: [reviewerId] });
    assert.equal(Object.hasOwn(current, 'ownerId'), false);
    assert.equal(Object.hasOwn(current, 'reviewerId'), false);
  }
  assert.equal(upgradeTaskPeople(converted.state).changed, false);
  withStorage({ [STORAGE_KEY]: original }, store => {
    const loaded = loadWorkbench();
    assert.equal(loaded.warning, undefined);
    assert.deepEqual(loaded.state, converted.state);
    assert.equal(loaded.state.tasks.length, 9);
    assert.equal(personDay(loaded.state, 'member-five', today()).tasks[0].id, 'user-multi-upgrade');
    assert.equal(personDay(loaded.state, 'member-four', today()).free, true);
    assert.equal(store.get(STORAGE_KEY), JSON.stringify(converted.state));
    assert.deepEqual(loadWorkbench().state, converted.state);
  });
});

test('多人升级与项目名升级可一次保存，历史无负责人已完成任务仍可读取', () => {
  const legacy = singleOwnerV3();
  delete legacy.seedProjectNamesRevision;
  for (const item of SEED_PROJECT_NAMES) legacy.projects.find(project => project.id === item.id)!.name = item.previous;
  const done = legacy.tasks.find(task => task.status === 'done')!;
  done.ownerId = '';
  withStorage({ [STORAGE_KEY]: JSON.stringify(legacy) }, store => {
    let writes = 0;
    localStorage.setItem = (key, value) => { writes++; store.set(key, value); };
    const loaded = loadWorkbench();
    assert.equal(loaded.warning, undefined);
    assert.equal(writes, 1);
    assert.deepEqual(loaded.state.projects.map(project => project.name), SEED_PROJECT_NAMES.map(item => item.current));
    assert.deepEqual(loaded.state.tasks.find(task => task.id === done.id)!.ownerIds, []);
    assert.equal(scheduledTasks(loaded.state).some(task => task.id === done.id), false);
    loadWorkbench();
    assert.equal(writes, 1);
  });
  const duplicate = createSeed();
  duplicate.tasks[0].ownerIds = ['member-one', 'member-one', 'member-two'];
  const result = upgradeTaskPeople(duplicate);
  assert.equal(result.changed, true);
  assert.deepEqual(result.state.tasks[0].ownerIds, ['member-one', 'member-two']);
  assert.deepEqual(duplicate.tasks[0].ownerIds, ['member-one', 'member-one', 'member-two']);
});

test('多人升级写入失败保留原存储和完整任务，坏身份不能借迁移覆盖原数据', () => {
  const legacy = singleOwnerV3();
  legacy.tasks.push({ ...legacy.tasks[0], id: 'user-task-preserved', title: '必须保留的任务' });
  const raw = JSON.stringify(legacy);
  withStorage({ [STORAGE_KEY]: raw }, store => {
    localStorage.setItem = () => { throw new Error('quota exceeded'); };
    const loaded = loadWorkbench();
    assert.match(loaded.warning!, /多人负责人和对接人更新未能保存.*完整保留/);
    assert.equal(store.get(STORAGE_KEY), raw);
    assert.equal(loaded.state.tasks.length, 9);
    assert.ok(loaded.state.tasks.some(task => task.id === 'user-task-preserved'));
    assert.deepEqual(loaded.state, upgradeTaskPeople(legacy).state);
  });
  const invalidOld = singleOwnerV3();
  invalidOld.tasks[0].ownerId = 'unknown';
  const invalidCurrent = { ...singleOwnerV3(), tasks: [{ ...singleOwnerV3().tasks[0], ownerIds: null }] };
  for (const invalid of [invalidOld, invalidCurrent]) {
    const invalidRaw = JSON.stringify(invalid);
    assert.throws(() => upgradeTaskPeople(invalid), /五位项目经理/);
    withStorage({ [STORAGE_KEY]: invalidRaw }, store => {
      assert.match(loadWorkbench().warning!, /原数据尚未覆盖/);
      assert.equal(store.get(STORAGE_KEY), invalidRaw);
    });
  }
});

test('对接人可多人去重、移除或清空，不改变负责人排班，不影响任务推进', () => {
  const f = flow();
  const contacts = ['boss', 'member-two', 'member-four', 'member-two'];
  const taskId = f.create({ contactIds: contacts });
  assert.deepEqual(f.state.tasks[0].contactIds, ['boss', 'member-two', 'member-four']);
  assert.deepEqual(contacts, ['boss', 'member-two', 'member-four', 'member-two']);
  assert.match(f.state.activities[0].text, /对接人：老板、成员二、成员四/);
  const initialTask = structuredClone(f.state.tasks[0]);
  for (const contact of ['member-two', 'member-four']) {
    assert.equal(personDay(f.state, contact, today()).free, true);
    assert.equal(nextFreeDate(f.state, contact, today()), today());
    assert.deepEqual(overlapTasks(f.state, contact, today(), addDays(today(), 2)), []);
  }
  f.run({ type: 'editTask', payload: { id: taskId, changes: f.input({ contactIds: ['member-four'] }) } });
  assert.deepEqual(f.state.tasks[0].contactIds, ['member-four']);
  f.run({ type: 'editTask', payload: { id: taskId, changes: f.input({ contactIds: [] }) } });
  assert.deepEqual(f.state.tasks[0].contactIds, []);
  assert.match(f.state.activities[0].text, /对接人：待添加/);
  for (const field of ['id', 'ownerIds', 'startDate', 'endDate', 'createdAt'] as const) assert.deepEqual(f.state.tasks[0][field], initialTask[field]);
  assert.equal(scheduledTasks(f.state).length, 1);
  assert.equal(personDay(f.state, 'member-one', today()).tasks[0].id, taskId);
  f.run({ type: 'setTaskStatus', payload: { id: taskId, status: 'doing' } });
  f.run({ type: 'setTaskStatus', payload: { id: taskId, status: 'review' } });
  f.run({ type: 'reviewTask', payload: { id: taskId, approved: true, note: '' } });
  assert.match(f.state.activities[0].text, /老板记录.*核验通过/);
  assert.equal(f.state.tasks[0].status, 'done');
  assert.deepEqual(f.state.tasks[0].contactIds, []);
  withStorage({}, () => {
    saveWorkbench(f.state);
    assert.deepEqual(loadWorkbench().state, f.state);
  });
  const { projectId: _unused, ...task } = f.input({ contactIds: ['boss', 'boss', 'member-two'] });
  f.run({ type: 'saveTaskByProjectName', payload: { projectName: '多人对接项目', task } });
  assert.deepEqual(f.state.tasks[0].contactIds, ['boss', 'member-two']);
});

function singleContactV3() {
  const current = createSeed();
  current.tasks.push({ ...current.tasks[0], id: 'user-contact-upgrade', title: '用户多人负责的任务', ownerIds: ['member-one', 'member-five'], contactIds: ['member-two'], endDate: addDays(today(), 40) });
  return { ...current, tasks: current.tasks.map(({ contactIds, ...task }) => ({ ...task, contactId: contactIds[0] || 'boss' })) };
}

test('两种旧v3对接字段分别升级成数组，保存失败保留原文和全部任务', () => {
  for (const legacy of [singleContactV3(), singleOwnerV3()]) {
    const original = JSON.stringify(legacy);
    const converted = upgradeTaskPeople(legacy);
    assert.equal(converted.changed, true);
    assert.equal(JSON.stringify(legacy), original);
    assert.deepEqual(converted.state.projects, legacy.projects);
    assert.deepEqual(converted.state.activities, legacy.activities);
    for (const old of legacy.tasks) {
      const current = converted.state.tasks.find(task => task.id === old.id)!;
      assert.deepEqual(current.contactIds, ['contactId' in old ? old.contactId : old.reviewerId]);
      assert.equal(current.id, old.id);
      assert.equal(current.projectId, old.projectId);
      assert.equal(current.startDate, old.startDate);
      assert.equal(current.endDate, old.endDate);
      assert.equal(current.status, old.status);
      if ('ownerIds' in old) assert.deepEqual(current.ownerIds, old.ownerIds);
      assert.equal(Object.hasOwn(current, 'contactId'), false);
      assert.equal(Object.hasOwn(current, 'reviewerId'), false);
    }
    withStorage({ [STORAGE_KEY]: original }, store => {
      const first = loadWorkbench();
      assert.equal(first.warning, undefined);
      assert.deepEqual(first.state, converted.state);
      assert.equal(store.get(STORAGE_KEY), JSON.stringify(converted.state));
      assert.deepEqual(loadWorkbench().state, converted.state);
    });
    withStorage({ [STORAGE_KEY]: original }, store => {
      localStorage.setItem = () => { throw new Error('quota exceeded'); };
      const loaded = loadWorkbench();
      assert.match(loaded.warning!, /对接人更新未能保存.*完整保留/);
      assert.equal(store.get(STORAGE_KEY), original);
      assert.deepEqual(loaded.state, converted.state);
      assert.equal(loaded.state.tasks.length, legacy.tasks.length);
    });
  }
});

test('无效对接人命令不写入，坏新字段或旧字段不能借其他历史字段绕过校验', () => {
  const f = flow(); f.create();
  const original = structuredClone(f.state);
  for (const invalid of [undefined, null, 'boss', [''], [null], ['unknown']]) {
    assert.throws(() => f.create({ contactIds: invalid as unknown as string[] }), /对接人/);
    assert.deepEqual(f.state, original);
  }
  const currentTask = createSeed().tasks[0];
  const { contactIds: _unused, ...withoutContacts } = currentTask;
  const invalidTasks = [
    { ...withoutContacts },
    { ...withoutContacts, contactId: '', reviewerId: 'boss' },
    { ...withoutContacts, contactId: null, reviewerId: 'boss' },
    { ...withoutContacts, reviewerId: 'unknown' },
    { ...withoutContacts, contactIds: null, contactId: 'boss' },
    { ...withoutContacts, contactIds: ['unknown'], contactId: 'boss' },
  ];
  for (const task of invalidTasks) {
    const invalid = { ...createSeed(), tasks: [task] };
    assert.throws(() => upgradeTaskPeople(invalid));
    const raw = JSON.stringify(invalid);
    withStorage({ [STORAGE_KEY]: raw }, store => {
      assert.match(loadWorkbench().warning!, /原数据尚未覆盖/);
      assert.equal(store.get(STORAGE_KEY), raw);
    });
  }
});

test('已有对接数组去重后持久化，明确清空的数组不会被旧对接人重新填入', () => {
  const duplicate = createSeed();
  duplicate.tasks[0].contactIds = ['boss', 'member-two', 'boss'];
  const before = structuredClone(duplicate);
  withStorage({ [STORAGE_KEY]: JSON.stringify(duplicate) }, store => {
    const loaded = loadWorkbench();
    assert.equal(loaded.warning, undefined);
    assert.deepEqual(loaded.state.tasks[0].contactIds, ['boss', 'member-two']);
    assert.deepEqual(duplicate, before);
    assert.deepEqual(JSON.parse(store.get(STORAGE_KEY)!).tasks[0].contactIds, ['boss', 'member-two']);
    assert.equal(upgradeTaskPeople(loaded.state).changed, false);
  });
  const clear = createSeed();
  const mixed = { ...clear, tasks: [{ ...clear.tasks[0], contactIds: [], contactId: 'boss', reviewerId: 'member-two' }] };
  const loaded = upgradeTaskPeople(mixed);
  assert.equal(loaded.changed, true);
  assert.deepEqual(loaded.state.tasks[0].contactIds, []);
  assert.equal(Object.hasOwn(loaded.state.tasks[0], 'contactId'), false);
  assert.equal(Object.hasOwn(loaded.state.tasks[0], 'reviewerId'), false);
});
