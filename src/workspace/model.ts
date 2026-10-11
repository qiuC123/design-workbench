import type { Activity, Command, Company, Contact, Manager, Project, ProjectInput, ProjectStatus, WorkbenchState } from './types';
import { createRecordId as id } from './id';

export const MANAGERS: Manager[] = [
  { id: 'member-one', name: '成员一', color: '#467c72' },
  { id: 'member-two', name: '成员二', color: '#6886b8' },
  { id: 'member-three', name: '成员三', color: '#bd9254' },
  { id: 'member-four', name: '成员四', color: '#9879b1' },
  { id: 'member-five', name: '成员五', color: '#bc7d70' },
];
export const PROJECT_LABELS: Record<ProjectStatus, string> = { todo: '待办', doing: '进行中', review: '待核验', done: '已完成' };

export function today(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
}
export function validDate(value: string): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
function requireDate(value: string): void { if (!validDate(value)) throw new Error('请选择有效的日期'); }
export function addDays(date: string, days: number): string {
  requireDate(date);
  if (!Number.isInteger(days)) throw new Error('日期偏移须为整数天数');
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  const result = value.toISOString().slice(0, 10);
  requireDate(result);
  return result;
}
export function weekStart(date: string): string {
  requireDate(date);
  return addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));
}
function range(start: string, end: string): void {
  requireDate(start); requireDate(end);
  if (start > end) throw new Error('结束日期不能早于开始日期');
}
const timestamp = () => new Date().toISOString();
const nameKey = (value: string) => value.trim().toLowerCase();
const required = (value: string, label: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`请填写${label}`);
  return value.trim();
};
function companyNameKey(name: string): string {
  const key = nameKey(name);
  return ['示例丁', '示例设计公司', '示例丁（示例设计公司）', '示例丁(示例设计公司)'].includes(key) ? '示例设计公司' : key;
}
export function findCompanyByName(state: WorkbenchState, name: string): Company | undefined {
  if (typeof name !== 'string' || !name.trim()) return undefined;
  return state.companies.find(company => companyNameKey(company.name) === companyNameKey(name));
}
export function normalizeOwnerIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(ownerId => typeof ownerId !== 'string' || !MANAGERS.some(manager => manager.id === ownerId))) throw new Error('负责人须从五位项目经理中选择');
  return [...new Set(value as string[])];
}
function normalizeContactIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(contactId => typeof contactId !== 'string' || !contactId.trim())) throw new Error('请选择有效的客户对接人');
  return [...new Set(value as string[])];
}
function companyOf(state: WorkbenchState, companyId: string): Company {
  const company = state.companies.find(company => company.id === companyId);
  if (!company) throw new Error('公司不存在，请重新选择所属公司');
  return company;
}
function projectOf(state: WorkbenchState, projectId: string): Project {
  const project = state.projects.find(project => project.id === projectId);
  if (!project) throw new Error('项目不存在');
  return project;
}
function contactOf(state: WorkbenchState, contactId: string): Contact {
  const contact = state.contacts.find(contact => contact.id === contactId);
  if (!contact) throw new Error('客户对接人不存在');
  return contact;
}
const ownerNames = (ownerIds: string[]) => ownerIds.length ? ownerIds.map(ownerId => MANAGERS.find(manager => manager.id === ownerId)!.name).join('、') : '待分配';
const contactNames = (state: WorkbenchState, contactIds: string[]) => contactIds.length ? contactIds.map(contactId => contactOf(state, contactId).name).join('、') : '待添加';
function log(state: WorkbenchState, text: string, references: Pick<Activity, 'projectId' | 'companyId'> = {}): void {
  state.activities.unshift({ id: id('activity'), text, at: timestamp(), ...references });
}
function validateStatus(status: ProjectStatus): void {
  if (!Object.hasOwn(PROJECT_LABELS, status)) throw new Error('项目状态无效');
}
function validateProject(state: WorkbenchState, input: ProjectInput, previous?: Project): void {
  required(input.title, '项目名称');
  range(input.startDate, input.endDate);
  validateStatus(input.status);
  normalizeOwnerIds(input.ownerIds);
  normalizeContactIds(input.contactIds);
  if (!input.ownerIds.length && input.status !== 'todo') throw new Error('请先分配负责人，再推进项目状态');
  if (typeof input.description !== 'string' || !['normal', 'high'].includes(input.priority)) throw new Error('项目资料格式无效');
  if (input.companyId) companyOf(state, input.companyId);
  else if (input.contactIds.length) throw new Error('请先确认所属公司，再添加客户对接人');
  for (const contactId of input.contactIds) {
    const contact = contactOf(state, contactId);
    if (contact.companyId !== input.companyId) throw new Error(`对接人「${contact.name}」不属于所选公司，请重新选择`);
    if (!contact.active && !previous?.contactIds.includes(contactId)) throw new Error(`对接人「${contact.name}」已停用，不能新增关联，请先启用或选择其他人`);
  }
}
function markStatus(project: Project, status: ProjectStatus): void {
  validateStatus(status);
  if (!project.ownerIds.length && status !== 'todo') throw new Error('请先分配负责人，再推进项目状态');
  project.status = status;
  project.updatedAt = timestamp();
  if (status === 'done') project.completedAt ||= project.updatedAt;
  else delete project.completedAt;
}
function createCompany(state: WorkbenchState, name: string, note = ''): Company {
  const time = timestamp();
  const company: Company = { id: id('company'), name: name.trim(), note, createdAt: time, updatedAt: time };
  state.companies.unshift(company);
  log(state, `新建公司「${company.name}」`, { companyId: company.id });
  return company;
}
function createContact(state: WorkbenchState, companyId: string, name: string, note = '', active = true): Contact {
  const time = timestamp();
  const contact: Contact = { id: id('contact'), companyId, name: name.trim(), note, active, createdAt: time, updatedAt: time };
  state.contacts.unshift(contact);
  log(state, `新增客户对接人「${contact.name}」${active ? '' : '（已停用）'}`, { companyId });
  return contact;
}

export function scheduledProjects(state: WorkbenchState): Project[] {
  return state.projects.filter(project => project.status !== 'done' && project.ownerIds.length > 0);
}
export function personDay(state: WorkbenchState, ownerId: string, date: string): { projects: Project[]; free: boolean; overlapping: boolean } {
  requireDate(date);
  const projects = scheduledProjects(state).filter(project => project.ownerIds.includes(ownerId) && project.startDate <= date && project.endDate >= date);
  return { projects, free: projects.length === 0, overlapping: projects.length > 1 };
}
export function overlapProjects(state: WorkbenchState, ownerId: string, start: string, end: string, excludeProjectId?: string): Project[] {
  range(start, end);
  return scheduledProjects(state).filter(project => project.ownerIds.includes(ownerId) && project.id !== excludeProjectId && project.startDate <= end && project.endDate >= start);
}
export function nextFreeDate(state: WorkbenchState, ownerId: string, from: string): string {
  requireDate(from);
  let cursor = from;
  const projects = scheduledProjects(state).filter(project => project.ownerIds.includes(ownerId) && project.endDate >= from).sort((a, b) => a.startDate.localeCompare(b.startDate));
  for (const project of projects) {
    if (project.endDate < cursor) continue;
    if (project.startDate > cursor) break;
    cursor = addDays(project.endDate, 1);
  }
  return cursor;
}
function overlapNote(state: WorkbenchState, project: Project): string {
  const count = project.status === 'done' ? 0 : new Set(project.ownerIds.flatMap(ownerId => overlapProjects(state, ownerId, project.startDate, project.endDate, project.id).map(item => item.id))).size;
  return count ? `；同期另有 ${count} 个项目，已保留并行安排` : '';
}

/** Cards are projects. Companies carry no schedule or project lifecycle. */
export function execute(state: WorkbenchState, command: Command): WorkbenchState {
  const next = structuredClone(state);
  switch (command.type) {
    case 'saveProject': {
      const payload = command.payload;
      const previous = payload.id === undefined ? undefined : projectOf(next, payload.id);
      if (typeof payload.companyName !== 'string') throw new Error('公司名称格式无效');
      const companyName = payload.companyName.trim();
      if (payload.newContactNames !== undefined && (!Array.isArray(payload.newContactNames) || payload.newContactNames.some(name => typeof name !== 'string'))) throw new Error('新增对接人姓名格式无效');
      const newContactNames = (payload.newContactNames || []).map(name => required(name, '对接人姓名'));
      const selectedContacts = normalizeContactIds(payload.project.contactIds);
      if (!companyName && (selectedContacts.length || newContactNames.length)) throw new Error('请先确认所属公司，再添加客户对接人');
      const company = companyName ? findCompanyByName(next, companyName) || createCompany(next, companyName) : undefined;
      const contactIds = [...selectedContacts];
      for (const name of newContactNames) {
        const contact = next.contacts.find(contact => contact.companyId === company!.id && nameKey(contact.name) === nameKey(name)) || createContact(next, company!.id, name);
        contactIds.push(contact.id);
      }
      const input: ProjectInput = {
        companyId: company?.id || '', title: required(payload.project.title, '项目名称'), description: payload.project.description,
        ownerIds: normalizeOwnerIds(payload.project.ownerIds), contactIds: [...new Set(contactIds)],
        startDate: payload.project.startDate, endDate: payload.project.endDate, status: payload.project.status, priority: payload.project.priority,
      };
      validateProject(next, input, previous);
      const oldCompanyId = previous?.companyId;
      const oldOwners = previous?.ownerIds;
      const oldStatus = previous?.status;
      const time = timestamp();
      const project: Project = previous || { ...input, id: id('project'), createdAt: time, updatedAt: time };
      Object.assign(project, input);
      markStatus(project, input.status);
      if (!previous) next.projects.unshift(project);
      if (oldCompanyId && oldCompanyId !== project.companyId) log(next, `项目「${project.title}」移至${company ? `公司「${company.name}」` : '待确认公司'}`, { projectId: project.id, companyId: oldCompanyId });
      const changedOwners = oldOwners && oldOwners.join(',') !== project.ownerIds.join(',') ? `负责人由${ownerNames(oldOwners)}改为${ownerNames(project.ownerIds)}` : `负责人：${ownerNames(project.ownerIds)}`;
      log(next, `${previous ? '更新' : '新建'}项目「${project.title}」；${changedOwners}；客户对接人：${contactNames(next, project.contactIds)}；计划 ${project.startDate} 至 ${project.endDate}${overlapNote(next, project)}${oldStatus !== project.status && project.status === 'done' ? '；老板记录：核验通过，项目已完成' : ''}`, { projectId: project.id, ...(project.companyId ? { companyId: project.companyId } : {}) });
      break;
    }
    case 'saveCompany': {
      const { id: companyId, changes } = command.payload;
      const name = required(changes.name, '公司名称');
      if (typeof changes.note !== 'string') throw new Error('公司说明格式无效');
      const duplicate = findCompanyByName(next, name);
      if (duplicate && duplicate.id !== companyId) throw new Error('同名公司已存在，请使用已有公司');
      if (companyId === undefined) createCompany(next, name, changes.note);
      else {
        const company = companyOf(next, companyId);
        Object.assign(company, { name, note: changes.note, updatedAt: timestamp() });
        log(next, `更新公司「${company.name}」`, { companyId: company.id });
      }
      break;
    }
    case 'saveContact': {
      const { id: contactId, changes } = command.payload;
      companyOf(next, changes.companyId);
      const name = required(changes.name, '对接人姓名');
      if (typeof changes.note !== 'string' || typeof changes.active !== 'boolean') throw new Error('客户对接人资料格式无效');
      if (next.contacts.some(contact => contact.id !== contactId && contact.companyId === changes.companyId && nameKey(contact.name) === nameKey(name))) throw new Error('该公司已有同名对接人，请使用已有联系人');
      if (contactId === undefined) createContact(next, changes.companyId, name, changes.note, changes.active);
      else {
        const contact = contactOf(next, contactId);
        if (contact.companyId !== changes.companyId && next.projects.some(project => project.contactIds.includes(contact.id))) throw new Error('该对接人已关联项目，不能更换所属公司；请在目标公司另建联系人');
        Object.assign(contact, { companyId: changes.companyId, name, note: changes.note, active: changes.active, updatedAt: timestamp() });
        log(next, `更新客户对接人「${contact.name}」；${contact.active ? '可用于新项目' : '已停用，保留历史项目关联'}`, { companyId: contact.companyId });
      }
      break;
    }
    case 'setProjectStatus': {
      const project = projectOf(next, command.payload.id);
      markStatus(project, command.payload.status);
      log(next, `项目「${project.title}」${project.status === 'done' ? '老板记录：核验通过，项目已完成' : `状态改为${PROJECT_LABELS[project.status]}`}`, { projectId: project.id, ...(project.companyId ? { companyId: project.companyId } : {}) });
      break;
    }
    case 'reviewProject': {
      const project = projectOf(next, command.payload.id);
      if (project.status !== 'review') throw new Error('请先将项目设为待核验，再记录核验结果');
      const note = command.payload.approved ? command.payload.note.trim() : required(command.payload.note, '退回修改意见');
      markStatus(project, command.payload.approved ? 'done' : 'doing');
      log(next, `老板记录：项目「${project.title}」${command.payload.approved ? '核验通过，项目已完成' : `退回修改，由${ownerNames(project.ownerIds)}继续处理`}${note ? `；意见：${note}` : ''}`, { projectId: project.id, ...(project.companyId ? { companyId: project.companyId } : {}) });
      break;
    }
    case 'deleteProject': {
      const project = projectOf(next, command.payload.id);
      next.projects = next.projects.filter(item => item.id !== project.id);
      log(next, `删除项目「${project.title}」，对应排班已释放；原负责人：${ownerNames(project.ownerIds)}`, { projectId: project.id, ...(project.companyId ? { companyId: project.companyId } : {}) });
      break;
    }
    case 'dismissMigration': delete next.migrationNotice; break;
    default: throw new Error('不支持的操作');
  }
  return next;
}
