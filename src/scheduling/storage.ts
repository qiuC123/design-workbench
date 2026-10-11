import { addDays, today } from './model';
import { createSeed } from './seed';
import type { ScheduleProject, ScheduleState, TeamMember } from './types';

export const SCHEDULE_STORAGE_KEY = 'xu-jian-schedule-v2';
const WORKFLOW_STORAGE_KEY = 'xu-jian-workbench-v1';
type LegacyRecord = Record<string, unknown>;

function record(value: unknown): LegacyRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('保存的数据格式无效');
  return value as LegacyRecord;
}

function text(value: unknown, fallback = ''): string { return typeof value === 'string' ? value : fallback; }
function validDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try { return addDays(value, 0) === value; } catch { return false; }
}
function migrationDate(value: unknown): string | undefined {
  const date = text(value).slice(0, 10);
  return validDate(date) ? date : undefined;
}

function validateState(value: unknown): ScheduleState {
  const state = record(value);
  if (state.version !== 2 || !Array.isArray(state.members) || !Array.isArray(state.projects) || !Array.isArray(state.logs)) throw new Error('排班数据版本或列表无效');
  const memberIds = new Set<string>();
  for (const entry of state.members) {
    const member = record(entry);
    if (!text(member.id) || memberIds.has(text(member.id)) || !text(member.name).trim() || typeof member.active !== 'boolean' || typeof member.specialty !== 'string' || typeof member.color !== 'string') throw new Error('成员资料不完整');
    memberIds.add(text(member.id));
  }
  const projectIds = new Set<string>();
  for (const entry of state.projects) {
    const project = record(entry);
    if (!text(project.id) || projectIds.has(text(project.id)) || !text(project.name).trim() || !['planned', 'active', 'done'].includes(text(project.status))) throw new Error('项目资料不完整');
    if (!validDate(project.startDate) || !validDate(project.endDate) || project.startDate > project.endDate) throw new Error('项目计划日期无效');
    for (const key of ['client', 'contact', 'location', 'note', 'createdAt', 'updatedAt']) if (typeof project[key] !== 'string') throw new Error('项目信息不完整');
    for (const role of ['manager', 'lead'] as const) {
      const memberId = project[`${role}Id`];
      const start = project[`${role}StartDate`];
      const end = project[`${role}EndDate`];
      if (typeof memberId !== 'string' || typeof start !== 'string' || typeof end !== 'string') throw new Error('角色排期不完整');
      if (memberId && (!memberIds.has(memberId) || !validDate(start) || !validDate(end) || start > end || start < project.startDate || end > project.endDate)) throw new Error('角色排期无效或超出项目计划');
      if (!memberId && (start || end)) throw new Error('未分配角色不能保留孤立排期');
    }
    projectIds.add(text(project.id));
  }
  for (const entry of state.logs) {
    const item = record(entry);
    if (!text(item.id) || typeof item.projectId !== 'string' || typeof item.text !== 'string' || typeof item.at !== 'string') throw new Error('排班记录无效');
  }
  if (state.migratedFromWorkflow !== undefined && typeof state.migratedFromWorkflow !== 'boolean') throw new Error('迁入标记无效');
  return state as unknown as ScheduleState;
}

/** Pure, conservative migration. Workflow documents and tasks remain in the untouched v1 key. */
export function migrateWorkflow(raw: unknown): ScheduleState {
  const legacy = record(typeof raw === 'string' ? JSON.parse(raw) : raw);
  if (legacy.schemaVersion !== 1 || !Array.isArray(legacy.members) || !Array.isArray(legacy.projects)) throw new Error('旧版数据格式不兼容，无法迁入');
  const date = today();
  const now = new Date().toISOString();
  const palette = ['#647f71', '#a57859', '#637fa3', '#9878a6', '#b99347'];
  const members: TeamMember[] = legacy.members.map((entry, index) => {
    const member = record(entry);
    if (!text(member.id) || !text(member.name).trim()) throw new Error('旧版成员缺少稳定身份或姓名');
    return { id: text(member.id), name: text(member.name).trim(), specialty: text(member.role), color: text(member.color, palette[index % palette.length]), active: member.active !== false };
  });
  const memberIds = new Set(members.map(member => member.id));
  const contacts = Array.isArray(legacy.contacts) ? legacy.contacts.map(record) : [];
  const projects: ScheduleProject[] = legacy.projects.map(entry => {
    const old = record(entry);
    if (!text(old.id) || !text(old.name).trim()) throw new Error('旧版项目缺少稳定身份或名称');
    const stage = text(old.stage);
    const status = stage === 'done' ? 'done' : stage === 'intake' ? 'planned' : 'active';
    let startDate = status === 'planned' ? addDays(date, 1) : date;
    let endDate = migrationDate(old.plannedDate) || migrationDate(old.dueDate) || addDays(startDate, 14);
    if (status === 'done') {
      endDate = migrationDate(old.completedAt) || migrationDate(old.plannedDate) || addDays(date, -1);
      if (endDate > date) endDate = addDays(date, -1);
      startDate = migrationDate(old.createdAt) || addDays(endDate, -14);
      if (startDate > endDate) startDate = addDays(endDate, -14);
    } else if (endDate < startDate) endDate = addDays(startDate, 14);
    const managerId = memberIds.has(text(old.managerId)) ? text(old.managerId) : '';
    const leadId = memberIds.has(text(old.leadId)) ? text(old.leadId) : '';
    const leadSuggestion = stage === 'design' || stage === 'intake' ? migrationDate(old.dueDate) || addDays(startDate, 3) : startDate;
    const leadStartDate = leadSuggestion < startDate ? startDate : leadSuggestion > endDate ? endDate : leadSuggestion;
    const contact = contacts.find(item => item.id === old.contactId);
    return {
      id: text(old.id), name: text(old.name).trim(), client: text(old.client), contact: contact ? [text(contact.name), text(contact.company)].filter(Boolean).join(' · ') : text(old.contact),
      location: text(old.location), startDate, endDate, status,
      note: [text(old.description), text(old.blockedReason) ? `原项目备注：${text(old.blockedReason)}` : '', '从旧流程版迁入，排期为建议值，请按实际开工时间核对。'].filter(Boolean).join('\n'),
      managerId, managerStartDate: managerId ? startDate : '', managerEndDate: managerId ? endDate : '',
      leadId, leadStartDate: leadId ? leadStartDate : '', leadEndDate: leadId ? endDate : '',
      createdAt: text(old.createdAt, now), updatedAt: now,
      ...(status === 'done' ? { completedAt: text(old.completedAt, `${endDate}T12:00:00+08:00`) } : {}),
    };
  });
  const state: ScheduleState = {
    version: 2, members, projects, migratedFromWorkflow: true,
    logs: projects.map((project, index) => ({ id: `migration-${index}-${project.id}`, projectId: project.id, at: now, text: `从旧流程版迁入「${project.name}」及已有经理、组长；建议计划 ${project.startDate} 至 ${project.endDate}，请核对实际排期。旧资料完整保留。` })),
  };
  return validateState(state);
}

export function loadSchedule(): { state: ScheduleState; warning?: string } {
  try {
    const raw = localStorage.getItem(SCHEDULE_STORAGE_KEY);
    if (raw !== null) {
      try { return { state: validateState(JSON.parse(raw)) }; }
      catch { return { state: createSeed(), warning: '已保存的排班数据无法读取，当前展示示例，原数据尚未被覆盖。请用“恢复示例数据”重新保存。' }; }
    }
    const workflow = localStorage.getItem(WORKFLOW_STORAGE_KEY);
    if (workflow !== null) {
      let state: ScheduleState;
      try {
        state = migrateWorkflow(workflow);
      } catch { return { state: createSeed(), warning: '旧版数据未能迁入，原数据完整保留，当前展示示例。请检查旧数据，或用“恢复示例数据”建立新排班。' }; }
      try {
        // v2 is absent, so saving the migration never replaces existing schedule data.
        localStorage.setItem(SCHEDULE_STORAGE_KEY, JSON.stringify(state));
        return { state };
      } catch { return { state, warning: '旧项目已迁入当前页面，但浏览器暂无法保存新排班，原数据仍保留。请检查本地存储设置。' }; }
    }
    return { state: createSeed() };
  } catch {
    return { state: createSeed(), warning: '浏览器无法读取本地保存，当前展示示例。请检查浏览器存储设置后再恢复或保存。' };
  }
}

export function saveSchedule(state: ScheduleState): void {
  validateState(state);
  try { localStorage.setItem(SCHEDULE_STORAGE_KEY, JSON.stringify(state)); }
  catch { throw new Error('浏览器无法保存排班，此次修改没有保存，请检查本地存储设置。'); }
}
