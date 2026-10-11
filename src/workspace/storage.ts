import { MANAGERS, validDate } from './model';
import { createSeed, DEFAULT_COMPANIES } from './seed';
import { IS_TRIAL } from './runtime';
import { migrateSchedule, upgradeTaskPeople } from '../board/storage';
import { migrateWorkflow } from '../scheduling/storage';
import type { Activity, Company, Project, WorkbenchState } from './types';
import type { Project as OldGroup } from '../board/types';

export const STORAGE_KEY = IS_TRIAL ? 'xu-jian-dingtalk-trial-v4' : 'xu-jian-projects-v4';
const TASK_KEY = 'xu-jian-tasks-v3';
const SCHEDULE_KEY = 'xu-jian-schedule-v2';
const WORKFLOW_KEY = 'xu-jian-workbench-v1';
type Entry = Record<string, unknown>;
function record(value: unknown): Entry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('保存的数据格式无效');
  return value as Entry;
}
const string = (value: unknown) => typeof value === 'string' ? value : '';
function strings(entry: Entry, fields: string[]): void {
  if (fields.some(field => typeof entry[field] !== 'string')) throw new Error('保存的数据缺少必要字段');
}
function uniqueId(entry: Entry, ids: Set<string>, label: string): void {
  if (!string(entry.id).trim() || ids.has(string(entry.id))) throw new Error(`${label}身份重复或无效`);
  ids.add(string(entry.id));
}
function stringIds(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !id) || new Set(value).size !== value.length) throw new Error(`${label}资料重复或无效`);
  return value as string[];
}
function timestamp(value: unknown): boolean {
  return typeof value === 'string' && Boolean(value.trim()) && Number.isFinite(Date.parse(value));
}
function times(entry: Entry): void {
  if (!timestamp(entry.createdAt) || !timestamp(entry.updatedAt)) throw new Error('资料记录时间无效');
}

/** Validate the complete snapshot before any write; no partial repairs or silent drops. */
export function validateState(value: unknown): WorkbenchState {
  const state = record(value);
  if (state.version !== 4 || !Array.isArray(state.companies) || !Array.isArray(state.contacts) || !Array.isArray(state.projects) || !Array.isArray(state.activities)) throw new Error('公司与项目数据版本或列表无效');
  const companyIds = new Set<string>();
  for (const value of state.companies) {
    const company = record(value);
    strings(company, ['id', 'name', 'note', 'createdAt', 'updatedAt']);
    uniqueId(company, companyIds, '公司'); times(company);
    if (!string(company.name).trim()) throw new Error('公司名称不能为空');
  }
  const contactIds = new Set<string>();
  const contactCompanies = new Map<string, string>();
  for (const value of state.contacts) {
    const contact = record(value);
    strings(contact, ['id', 'companyId', 'name', 'note', 'createdAt', 'updatedAt']);
    uniqueId(contact, contactIds, '对接人'); times(contact);
    if (!string(contact.name).trim() || !companyIds.has(string(contact.companyId)) || typeof contact.active !== 'boolean') throw new Error('客户对接人资料无效');
    contactCompanies.set(string(contact.id), string(contact.companyId));
  }
  const projectIds = new Set<string>();
  for (const value of state.projects) {
    const project = record(value);
    strings(project, ['id', 'companyId', 'title', 'description', 'startDate', 'endDate', 'status', 'priority', 'createdAt', 'updatedAt']);
    uniqueId(project, projectIds, '项目'); times(project);
    if (!string(project.title).trim() || (project.companyId !== '' && !companyIds.has(string(project.companyId)))) throw new Error('项目名称或所属公司无效');
    if (!['todo', 'doing', 'review', 'done'].includes(string(project.status)) || !['normal', 'high'].includes(string(project.priority))) throw new Error('项目状态无效');
    if (!validDate(string(project.startDate)) || !validDate(string(project.endDate)) || string(project.startDate) > string(project.endDate)) throw new Error('项目排期无效');
    const owners = stringIds(project.ownerIds, '负责人');
    if (owners.some(id => !MANAGERS.some(manager => manager.id === id))) throw new Error('负责人须属于固定的五位内部成员');
    // Preserve historical completion even when an old imported identity was unmatched.
    if (!owners.length && project.status !== 'todo' && project.status !== 'done') throw new Error('未分配项目不能推进');
    const contacts = stringIds(project.contactIds, '对接人');
    if (contacts.some(id => !contactIds.has(id) || contactCompanies.get(id) !== project.companyId)) throw new Error('对接人必须属于项目的客户公司');
    if (project.companyId === '' && contacts.length) throw new Error('公司待确认时不能关联对接人');
    if (project.status === 'done' && !timestamp(project.completedAt)) throw new Error('已完成项目缺少有效完成时间');
    if (project.completedAt !== undefined && (project.status !== 'done' || !timestamp(project.completedAt))) throw new Error('项目完成时间与状态不一致');
    if (project.legacyNote !== undefined && typeof project.legacyNote !== 'string') throw new Error('项目历史说明无效');
  }
  const activityIds = new Set<string>();
  for (const value of state.activities) {
    const activity = record(value);
    strings(activity, ['id', 'text', 'at']); uniqueId(activity, activityIds, '操作记录');
    if (!timestamp(activity.at) || !string(activity.text).trim()) throw new Error('操作记录时间或内容无效');
    // Deleting a project keeps its audit history, so a historical project ID may
    // outlive the card itself. Validate its shape rather than requiring a live card.
    if (activity.projectId !== undefined && (typeof activity.projectId !== 'string' || !activity.projectId.trim())) throw new Error('操作记录关联的项目无效');
    if (activity.companyId !== undefined && (typeof activity.companyId !== 'string' || !companyIds.has(activity.companyId))) throw new Error('操作记录关联的公司无效');
  }
  if (state.migrationNotice !== undefined && typeof state.migrationNotice !== 'string') throw new Error('迁入说明无效');
  return state as unknown as WorkbenchState;
}

function companyMatch(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '').replaceAll('（', '(').replaceAll('）', ')');
  if (normalized === 'demoa') return 'company-demoa';
  if (normalized.startsWith('示例乙')) return 'company-demob';
  if (normalized === '示例丙') return 'company-democ';
  if (['示例丁', '示例设计公司', '示例丁(示例设计公司)'].includes(normalized)) return 'company-demod';
  return '';
}
function companyFor(group: OldGroup): string {
  const candidates = [...new Set([companyMatch(group.name), companyMatch(group.client)].filter(Boolean))];
  return candidates.length === 1 ? candidates[0] : '';
}
function groupNote(group: OldGroup): string {
  const manager = MANAGERS.find(item => item.id === group.managerId)?.name;
  return [
    `原所属分类：${group.name}`,
    group.client && `原客户记录：${group.client}`,
    group.contact && `原客户联络记录：${group.contact}（待核实，未加入客户通讯录）`,
    group.location && `原地点：${group.location}`,
    manager && `原分类统筹人：${manager}`,
    `原分类参考日期：${group.startDate} 至 ${group.endDate}（仅留作历史，当前排班采用项目自身日期）`,
    `原分类状态：${group.status}`,
    group.note && `原分类备注：${group.note}`,
  ].filter(Boolean).join('\n');
}

/** The old browser keys are an immutable source archive; one task becomes one project. */
export function migrateV3(value: unknown): WorkbenchState {
  const source = typeof value === 'string' ? JSON.parse(value) : value;
  const { state: old } = upgradeTaskPeople(source);
  const at = new Date().toISOString();
  const companies: Company[] = DEFAULT_COMPANIES.map(company => ({ ...company, note: '', createdAt: at, updatedAt: at }));
  const groups = new Map(old.projects.map(group => [group.id, group]));
  const projects: Project[] = old.tasks.map(task => {
    const group = groups.get(task.projectId)!;
    const companyId = companyFor(group);
    const oldContacts = task.contactIds.map(id => id === 'boss' ? '老板' : MANAGERS.find(item => item.id === id)?.name || id);
    return {
      id: task.id, companyId, title: task.title, description: task.description,
      ownerIds: [...task.ownerIds], contactIds: [], startDate: task.startDate, endDate: task.endDate,
      status: task.status, priority: task.priority, createdAt: task.createdAt, updatedAt: task.updatedAt,
      ...(task.completedAt ? { completedAt: task.completedAt } : {}),
      legacyNote: [groupNote(group), oldContacts.length && `原内部对接记录：${oldContacts.join('、')}（内部成员，未转为客户对接人）`, !companyId && '所属公司待确认：未根据旧分类或客户记录推测客户公司。'].filter(Boolean).join('\n'),
    };
  });
  const projectIds = new Set(projects.map(project => project.id));
  const activities: Activity[] = old.activities.map(activity => {
    const group = groups.get(activity.projectId)!;
    const companyId = companyFor(group);
    return {
      id: activity.id, at: activity.at,
      ...(activity.taskId && projectIds.has(activity.taskId) ? { projectId: activity.taskId } : {}),
      ...(companyId ? { companyId } : {}),
      text: activity.taskId && projectIds.has(activity.taskId) ? activity.text : `[原分类：${group.name}] ${activity.text}`,
    };
  });
  const activityIds = new Set(activities.map(activity => activity.id));
  for (const group of old.projects) {
    // Also archive groups without tasks: migration must never manufacture a project card.
    const baseId = `v4-group-archive-${group.id}`;
    let archiveId = baseId;
    while (activityIds.has(archiveId)) archiveId += '-copy';
    activityIds.add(archiveId);
    const companyId = companyFor(group);
    activities.push({ id: archiveId, at, ...(companyId ? { companyId } : {}), text: `旧分类资料归档${old.tasks.some(task => task.projectId === group.id) ? '' : '（该分类没有任务，未创建项目卡）'}\n${groupNote(group)}` });
  }
  const unassigned = projects.filter(project => !project.companyId).length;
  return validateState({
    version: 4, companies, contacts: [], projects, activities,
    migrationNotice: `原有 ${projects.length} 张任务卡已转为项目，负责人、日期、状态和历史记录保留。${unassigned ? `${unassigned} 个项目的所属公司待确认；` : ''}原内部对接人保留在历史说明，请按客户公司添加真实对接人。旧分类信息已归档，旧版存储完整保留。${old.migrationNotice ? `\n此前迁入说明：${old.migrationNotice}` : ''}`,
  });
}

function emptyState(): WorkbenchState {
  return { version: 4, companies: [], contacts: [], projects: [], activities: [] };
}
export function loadWorkbench(): { state: WorkbenchState; warning?: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      try { return { state: validateState(JSON.parse(raw)) }; }
      catch { return { state: emptyState(), warning: '已保存的公司与项目数据无法读取，原数据未覆盖，当前暂停写入。请检查数据后再操作。' }; }
    }
    // A trial build never imports the browser's working project records.
    if (IS_TRIAL) return { state: createSeed() };
    const task = localStorage.getItem(TASK_KEY);
    const schedule = task === null ? localStorage.getItem(SCHEDULE_KEY) : null;
    const workflow = task === null && schedule === null ? localStorage.getItem(WORKFLOW_KEY) : null;
    if (task !== null || schedule !== null || workflow !== null) {
      let state: WorkbenchState;
      try {
        state = migrateV3(task !== null ? task : migrateSchedule(schedule !== null ? schedule : migrateWorkflow(workflow!)));
      } catch {
        return { state: emptyState(), warning: '旧版数据未能完整迁入，原数据完整保留，当前暂停写入。请检查旧数据后再操作。' };
      }
      try { saveWorkbench(state); return { state }; }
      catch { return { state, warning: '旧资料已完整读取，但新版本数据未能保存，原数据完整保留，当前暂停写入。请检查本地存储后再操作。' }; }
    }
    return { state: createSeed() };
  } catch {
    return { state: emptyState(), warning: '浏览器无法读取本地数据，当前暂停写入。请检查本地存储后再操作。' };
  }
}
export function saveWorkbench(state: WorkbenchState): void {
  validateState(state);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { throw new Error('浏览器无法保存项目，此次修改没有保存，请检查本地存储设置'); }
}
