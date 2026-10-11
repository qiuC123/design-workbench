import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, execute, findCompanyByName, MANAGERS, nextFreeDate, normalizeOwnerIds, overlapProjects, personDay, scheduledProjects, today, validDate, weekStart } from './model';
import { createSeed, DEFAULT_COMPANIES } from './seed';
import type { Command, Project, ProjectInput, WorkbenchState } from './types';

const blank = (): WorkbenchState => ({ version: 4, companies: [], contacts: [], projects: [], activities: [] });
const input = (changes: Partial<Omit<ProjectInput, 'companyId'>> = {}): Omit<ProjectInput, 'companyId'> => ({ title: '测试项目', description: '项目说明', ownerIds: ['member-one'], contactIds: [], startDate: today(), endDate: addDays(today(), 2), status: 'todo', priority: 'normal', ...changes });
function flow(initial = blank()) {
  let state = initial;
  const run = (command: Command) => { state = execute(state, command); return state; };
  const create = (changes: Partial<Omit<ProjectInput, 'companyId'>> = {}, companyName = 'DemoA', newContactNames?: string[]) => {
    run({ type: 'saveProject', payload: { companyName, project: input(changes), newContactNames } });
    return state.projects[0].id;
  };
  const edit = (id: string, changes: Partial<Omit<ProjectInput, 'companyId'>> = {}, companyName?: string, newContactNames?: string[]) => {
    const previous = state.projects.find(project => project.id === id)!;
    const { companyId: _companyId, ...project } = previous;
    return run({ type: 'saveProject', payload: { id, companyName: companyName === undefined ? state.companies.find(company => company.id === previous.companyId)?.name || '' : companyName, project: { ...project, ...changes }, newContactNames } });
  };
  return { get state() { return state; }, run, create, edit };
}

test('四家公司与四张明确示例项目卡，无虚构客户联系人或上层项目日期', () => {
  const state = createSeed();
  assert.equal(state.version, 4);
  assert.deepEqual(state.companies.map(({ id, name }) => ({ id, name })), DEFAULT_COMPANIES);
  assert.deepEqual(state.contacts, []);
  assert.equal(state.projects.length, 4);
  assert.ok(state.projects.every(project => project.title.includes('示例') && project.contactIds.length === 0));
  assert.deepEqual([...new Set(state.projects.map(project => project.status))].sort(), ['doing', 'done', 'review', 'todo']);
  assert.ok(state.companies.every(company => !Object.hasOwn(company, 'status') && !Object.hasOwn(company, 'startDate') && !Object.hasOwn(company, 'ownerIds')));
  assert.equal(Object.hasOwn(state, 'tasks'), false);
  assert.deepEqual(MANAGERS.map(manager => manager.name), ['成员一', '成员二', '成员三', '成员四', '成员五']);
});

test('公司名称按首尾空格与大小写复用，示例丁简称全名指向同一公司，改名不换身份', () => {
  const f = flow(createSeed());
  for (const name of ['示例丁', '示例设计公司', '示例丁（示例设计公司）', '示例丁(示例设计公司)']) assert.equal(findCompanyByName(f.state, name)!.id, 'company-demod');
  f.create({}, ' demoa ');
  assert.equal(f.state.companies.length, 4);
  assert.equal(f.state.projects[0].companyId, 'company-demoa');
  f.create({}, '示例设计公司');
  assert.equal(f.state.companies.length, 4);
  assert.equal(f.state.projects[0].companyId, 'company-demod');
  f.run({ type: 'saveCompany', payload: { id: 'company-demoa', changes: { name: 'DemoA 新名称', note: '新备注' } } });
  assert.ok(f.state.projects.some(project => project.companyId === 'company-demoa'));
  assert.equal(findCompanyByName(f.state, 'DemoA 新名称')!.id, 'company-demoa');
  assert.equal(findCompanyByName(f.state, 'DemoA'), undefined);
  const original = structuredClone(f.state);
  assert.throws(() => f.run({ type: 'saveCompany', payload: { changes: { name: ' 示例丁 ', note: '' } } }), /同名公司/);
  assert.deepEqual(f.state, original);
});

test('保存项目原子创建公司与联系人，同公司名称去重复用，不同公司同名联系人隔离', () => {
  const f = flow();
  f.create({ status: 'doing' }, '  新客户公司  ', [' 客户甲 ', '客户乙', '客户甲']);
  assert.equal(f.state.companies.length, 1);
  assert.equal(f.state.companies[0].name, '新客户公司');
  assert.equal(f.state.contacts.length, 2);
  assert.equal(f.state.projects[0].contactIds.length, 2);
  const firstContacts = [...f.state.projects[0].contactIds];
  f.create({ title: '第二项目' }, '新客户公司', ['客户甲']);
  assert.equal(f.state.contacts.length, 2);
  assert.ok(firstContacts.includes(f.state.projects[0].contactIds[0]));
  f.create({}, '其他客户公司', ['客户甲']);
  assert.equal(f.state.companies.length, 2);
  assert.equal(f.state.contacts.length, 3);
  const other = f.state.contacts.find(contact => contact.id === f.state.projects[0].contactIds[0])!;
  assert.equal(other.companyId, f.state.projects[0].companyId);
  assert.equal(firstContacts.includes(other.id), false);
  const firstCompany = findCompanyByName(f.state, '新客户公司')!;
  assert.throws(() => f.run({ type: 'saveContact', payload: { changes: { companyId: firstCompany.id, name: ' 客户甲 ', note: '', active: true } } }), /同名对接人/);
  f.create({}, '新客户公司', ['Client A']);
  f.create({}, '新客户公司', [' client a ']);
  assert.equal(f.state.contacts.filter(contact => contact.name.toLowerCase() === 'client a').length, 1);
});

test('切换公司必须重新选择该公司客户联系人，拒绝时不创建空公司或丢失原信息', () => {
  const f = flow();
  const projectId = f.create({ ownerIds: ['member-one', 'member-two'], status: 'doing' }, '原公司', ['客户甲']);
  f.state.projects[0].legacyNote = '迁入原说明';
  const original = structuredClone(f.state);
  assert.throws(() => f.edit(projectId, {}, '新公司', ['新客户']), /不属于所选公司/);
  assert.deepEqual(f.state, original);
  assert.equal(findCompanyByName(f.state, '新公司'), undefined);
  f.edit(projectId, { contactIds: [] }, '新公司', ['新客户']);
  const moved = f.state.projects[0];
  assert.notEqual(moved.companyId, original.projects[0].companyId);
  for (const field of ['id', 'title', 'description', 'ownerIds', 'startDate', 'endDate', 'status', 'priority', 'createdAt', 'legacyNote'] as const) assert.deepEqual(moved[field], original.projects[0][field]);
  assert.equal(f.state.contacts.find(contact => contact.id === moved.contactIds[0])!.name, '新客户');
  for (const activity of original.activities) assert.deepEqual(f.state.activities.find(item => item.id === activity.id), activity);
  assert.ok(f.state.activities.some(activity => activity.projectId === projectId && activity.companyId === original.projects[0].companyId && activity.text.includes('移至公司「新公司」')));
});

test('客户联系人改名及停用保持项目关联，停用不能新增绑定，恢复后可再用', () => {
  const f = flow();
  const projectId = f.create({}, 'DemoA', ['客户甲']);
  const contact = structuredClone(f.state.contacts[0]);
  f.run({ type: 'saveContact', payload: { id: contact.id, changes: { companyId: contact.companyId, name: '客户甲新名称', note: '负责需求沟通', active: false } } });
  assert.deepEqual(f.state.projects[0].contactIds, [contact.id]);
  f.edit(projectId, { title: '历史项目可继续编辑' });
  assert.match(f.state.activities[0].text, /客户对接人：客户甲新名称/);
  const original = structuredClone(f.state);
  assert.throws(() => f.create({ contactIds: [contact.id] }), /已停用/);
  assert.throws(() => f.create({}, 'DemoA', [' 客户甲新名称 ']), /已停用/);
  assert.deepEqual(f.state, original);
  f.edit(projectId, { contactIds: [] });
  assert.throws(() => f.edit(projectId, { contactIds: [contact.id] }), /已停用/);
  f.run({ type: 'saveContact', payload: { id: contact.id, changes: { companyId: contact.companyId, name: '客户甲新名称', note: '', active: true } } });
  f.edit(projectId, { contactIds: [contact.id] });
  assert.deepEqual(f.state.projects[0].contactIds, [contact.id]);
  f.run({ type: 'saveCompany', payload: { changes: { name: '其他公司', note: '' } } });
  assert.throws(() => f.run({ type: 'saveContact', payload: { id: contact.id, changes: { companyId: f.state.companies[0].id, name: contact.name, note: '', active: true } } }), /不能更换所属公司/);
});

test('无效项目保存不会留下新公司或客户联系人，不修改输入状态', () => {
  const f = flow(); f.create();
  const original = structuredClone(f.state);
  for (const changes of [
    { title: '' }, { startDate: '2026-02-30' }, { startDate: addDays(today(), 4), endDate: today() },
    { ownerIds: [], status: 'doing' as const }, { ownerIds: ['boss'] }, { contactIds: ['unknown'] },
  ]) {
    assert.throws(() => f.create(changes, '不应保存的公司', ['不应保存的客户']));
    assert.deepEqual(f.state, original);
  }
  assert.throws(() => f.create({}, '不应保存的公司', ['  ']), /对接人姓名/);
  assert.deepEqual(f.state, original);
  const successful = execute(f.state, { type: 'saveProject', payload: { companyName: 'DemoA', project: input({ ownerIds: ['member-two'] }) } });
  assert.deepEqual(f.state, original);
  assert.notEqual(successful.projects, f.state.projects);
});

test('待确认公司可保存项目但不能添加客户对接人，固定内部成员不冒充客户联系人', () => {
  const f = flow();
  const projectId = f.create({ status: 'doing' }, '   ');
  assert.equal(f.state.projects[0].companyId, '');
  assert.equal(f.state.companies.length, 0);
  assert.equal(personDay(f.state, 'member-one', today()).projects[0].id, projectId);
  assert.throws(() => f.create({}, '', ['客户甲']), /确认所属公司/);
  assert.throws(() => f.create({ contactIds: ['member-one'] }, ''), /确认所属公司/);
  assert.throws(() => f.create({ contactIds: ['member-one'] }), /对接人不存在/);
  assert.equal(f.state.companies.length, 0);
  f.edit(projectId, {}, '示例乙', ['客户甲']);
  assert.equal(f.state.companies.length, 1);
  assert.equal(f.state.projects[0].contactIds.length, 1);
});

test('多人共享唯一项目日期，负责人去重，客户联系人和公司不占排班，并行仅作提示', () => {
  const f = flow();
  const owners = ['member-one', 'member-two', 'member-one'];
  const first = f.create({ ownerIds: owners, status: 'doing' }, 'DemoA', ['客户甲']);
  assert.deepEqual(owners, ['member-one', 'member-two', 'member-one']);
  assert.deepEqual(f.state.projects[0].ownerIds, ['member-one', 'member-two']);
  assert.equal(scheduledProjects(f.state).length, 1);
  for (const ownerId of ['member-one', 'member-two']) {
    assert.equal(personDay(f.state, ownerId, today()).projects[0].id, first);
    assert.equal(personDay(f.state, ownerId, addDays(today(), 2)).free, false);
    assert.equal(nextFreeDate(f.state, ownerId, today()), addDays(today(), 3));
  }
  assert.equal(personDay(f.state, f.state.contacts[0].id, today()).free, true);
  assert.equal(personDay(f.state, 'member-four', today()).free, true);
  const second = f.create({ ownerIds: ['member-one', 'member-two'], status: 'review', endDate: addDays(today(), 6) }, '另一公司');
  assert.equal(scheduledProjects(f.state).length, 2);
  assert.match(f.state.activities[0].text, /同期另有 1 个项目.*保留并行安排/);
  for (const ownerId of ['member-one', 'member-two']) {
    assert.equal(personDay(f.state, ownerId, today()).overlapping, true);
    assert.deepEqual(overlapProjects(f.state, ownerId, today(), today(), first).map(project => project.id), [second]);
    assert.equal(nextFreeDate(f.state, ownerId, today()), addDays(today(), 7));
  }
  f.edit(first, { startDate: addDays(today(), -20), endDate: addDays(today(), 50) });
  assert.equal(personDay(f.state, 'member-one', addDays(today(), 50)).projects[0].id, first);
  assert.ok(f.state.companies.every(company => !Object.hasOwn(company, 'endDate')));
});

test('改派和移除共同负责人即时更新排班，完成一次释放全部负责人，重新开始恢复', () => {
  const f = flow();
  const projectId = f.create({ ownerIds: ['member-one', 'member-two'], status: 'doing' });
  f.edit(projectId, { ownerIds: ['member-two', 'member-five'] });
  assert.equal(personDay(f.state, 'member-one', today()).free, true);
  for (const ownerId of ['member-two', 'member-five']) assert.equal(personDay(f.state, ownerId, today()).projects[0].id, projectId);
  f.run({ type: 'setProjectStatus', payload: { id: projectId, status: 'done' } });
  assert.ok(f.state.projects[0].completedAt);
  assert.equal(scheduledProjects(f.state).length, 0);
  for (const ownerId of ['member-two', 'member-five']) assert.equal(personDay(f.state, ownerId, today()).free, true);
  f.run({ type: 'setProjectStatus', payload: { id: projectId, status: 'doing' } });
  assert.equal(f.state.projects[0].completedAt, undefined);
  assert.equal(scheduledProjects(f.state).length, 1);
  f.edit(projectId, { ownerIds: [], status: 'todo' });
  assert.equal(scheduledProjects(f.state).length, 0);
  for (const status of ['doing', 'review', 'done'] as const) {
    assert.throws(() => f.run({ type: 'setProjectStatus', payload: { id: projectId, status } }), /分配负责人/);
    assert.throws(() => f.edit(projectId, { status }), /分配负责人/);
  }
});

test('核验由老板记录，退回列全部负责人，客户仅沟通且公司没有完成锁', () => {
  const f = flow();
  const projectId = f.create({ ownerIds: ['member-one', 'member-two'], status: 'doing' }, 'DemoA', ['客户甲']);
  assert.throws(() => f.run({ type: 'reviewProject', payload: { id: projectId, approved: true, note: '' } }), /待核验/);
  f.run({ type: 'setProjectStatus', payload: { id: projectId, status: 'review' } });
  assert.throws(() => f.run({ type: 'reviewProject', payload: { id: projectId, approved: false, note: ' ' } }), /退回修改意见/);
  f.run({ type: 'reviewProject', payload: { id: projectId, approved: false, note: '补充尺寸' } });
  assert.equal(f.state.projects[0].status, 'doing');
  assert.match(f.state.activities[0].text, /老板记录.*退回修改，由成员一、成员二继续处理.*补充尺寸/);
  assert.equal(f.state.activities[0].text.includes('客户甲'), false);
  f.run({ type: 'setProjectStatus', payload: { id: projectId, status: 'review' } });
  f.run({ type: 'reviewProject', payload: { id: projectId, approved: true, note: '尺寸已确认' } });
  assert.equal(f.state.projects[0].status, 'done');
  assert.match(f.state.activities[0].text, /老板记录.*核验通过.*尺寸已确认/);
  assert.ok(f.state.activities.some(activity => activity.text.includes('补充尺寸')));
  f.create({ title: '同公司新增项目', status: 'doing' });
  assert.equal(f.state.projects.length, 2);
  assert.equal(f.state.companies.length, 1);
});

test('日期按真实日历校验且周一开周，最近空闲合并相邻项目并跳过完成项目', () => {
  assert.equal(weekStart('2026-10-08'), '2026-10-05');
  assert.equal(weekStart('2026-10-11'), '2026-10-05');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  for (const date of ['', '0000-01-01', '2026-02-30']) assert.equal(validDate(date), false);
  assert.throws(() => normalizeOwnerIds(['boss']), /五位项目经理/);
  const f = flow(); f.create();
  f.create({ startDate: addDays(today(), 3), endDate: addDays(today(), 4) });
  f.create({ startDate: addDays(today(), 5), endDate: addDays(today(), 6), status: 'done' });
  f.create({ startDate: addDays(today(), 7), endDate: addDays(today(), 9) });
  assert.equal(nextFreeDate(f.state, 'member-one', today()), addDays(today(), 5));
  assert.equal(nextFreeDate(f.state, 'member-one', addDays(today(), -1)), addDays(today(), -1));
});

test('删除项目只释放项目排班，公司客户资料与历史记录保留，可删除无负责人历史完成项目', () => {
  const f = flow();
  const projectId = f.create({ ownerIds: ['member-one', 'member-two'], status: 'doing' }, 'DemoA', ['客户甲']);
  const companies = structuredClone(f.state.companies);
  const contacts = structuredClone(f.state.contacts);
  const activities = structuredClone(f.state.activities);
  f.run({ type: 'deleteProject', payload: { id: projectId } });
  assert.equal(f.state.projects.length, 0);
  assert.equal(scheduledProjects(f.state).length, 0);
  assert.deepEqual(f.state.companies, companies);
  assert.deepEqual(f.state.contacts, contacts);
  for (const activity of activities) assert.deepEqual(f.state.activities.find(item => item.id === activity.id), activity);
  assert.equal(f.state.activities[0].projectId, projectId);
  assert.match(f.state.activities[0].text, /删除项目.*排班已释放/);
  const historical: Project = { ...input({ ownerIds: [], status: 'done' }), id: 'historical', companyId: '', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', completedAt: '2026-10-01T00:00:00Z' };
  const restored = { ...blank(), projects: [historical] };
  assert.equal(scheduledProjects(restored).length, 0);
  assert.throws(() => execute(restored, { type: 'setProjectStatus', payload: { id: historical.id, status: 'doing' } }), /分配负责人/);
  assert.equal(execute(restored, { type: 'deleteProject', payload: { id: historical.id } }).projects.length, 0);
});
