import { MANAGERS, normalizeContactIds, normalizeOwnerIds, PROJECT_LABELS, TASK_LABELS, validDate } from './model';
import { createSeed, SEED_PROJECT_NAMES } from './seed';
import { migrateWorkflow } from '../scheduling/storage';
import type { Project, Task, WorkbenchState } from './types';

export const STORAGE_KEY = 'xu-jian-tasks-v3';
const SCHEDULE_KEY = 'xu-jian-schedule-v2';
const WORKFLOW_KEY = 'xu-jian-workbench-v1';
type Entry = Record<string, unknown>;
function record(value: unknown): Entry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('保存的数据格式无效');
  return value as Entry;
}
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const hasManager = (value: unknown) => value === '' || MANAGERS.some(manager => manager.id === value);
function strings(entry: Entry, fields: string[]): void {
  if (fields.some(field => typeof entry[field] !== 'string')) throw new Error('保存的数据缺少必要字段');
}
function dateRange(entry: Entry): void {
  if (!validDate(text(entry.startDate)) || !validDate(text(entry.endDate)) || text(entry.startDate) > text(entry.endDate)) throw new Error('保存的数据日期无效');
}

export function validateState(value: unknown): WorkbenchState {
  const state = record(value);
  if (state.version !== 3 || !Array.isArray(state.projects) || !Array.isArray(state.tasks) || !Array.isArray(state.activities)) throw new Error('任务数据版本或列表无效');
  const projectIds = new Set<string>();
  for (const entry of state.projects) {
    const project = record(entry);
    strings(project, ['id', 'name', 'client', 'contact', 'location', 'startDate', 'endDate', 'managerId', 'status', 'note', 'color', 'createdAt', 'updatedAt']);
    if (!text(project.id) || projectIds.has(text(project.id)) || !text(project.name).trim() || !Object.hasOwn(PROJECT_LABELS, text(project.status)) || !hasManager(project.managerId)) throw new Error('项目资料无效');
    dateRange(project);
    if (project.status === 'done' && !text(project.completedAt)) throw new Error('已完成项目缺少完成时间');
    projectIds.add(text(project.id));
  }
  const taskIds = new Set<string>();
  for (const entry of state.tasks) {
    const task = record(entry);
    strings(task, ['id', 'projectId', 'title', 'description', 'startDate', 'endDate', 'status', 'priority', 'createdAt', 'updatedAt']);
    if (!text(task.id) || taskIds.has(text(task.id)) || !text(task.title).trim() || !projectIds.has(text(task.projectId))) throw new Error('任务资料无效');
    const ownerIds = normalizeOwnerIds(task.ownerIds);
    if (ownerIds.length !== (task.ownerIds as string[]).length) throw new Error('保存的任务负责人重复');
    const contactIds = normalizeContactIds(task.contactIds);
    if (contactIds.length !== (task.contactIds as string[]).length) throw new Error('保存的任务对接人重复');
    if (!Object.hasOwn(TASK_LABELS, text(task.status)) || !['normal', 'high'].includes(text(task.priority))) throw new Error('任务状态无效');
    dateRange(task);
    const project = (state.projects as Project[]).find(item => item.id === task.projectId)!;
    // Task dates may extend beyond the reference project plan.
    if (project.status === 'done' && task.status !== 'done') throw new Error('已完成项目包含未完成任务');
    // Imported completed work can retain an unmatched historical owner even if
    // its project is reopened. New commands still require an owner to complete.
    if (!ownerIds.length && task.status !== 'todo' && task.status !== 'done') throw new Error('未分配任务不能推进');
    if (task.status === 'done' && !text(task.completedAt)) throw new Error('已完成任务缺少完成时间');
    taskIds.add(text(task.id));
  }
  const activityIds = new Set<string>();
  for (const entry of state.activities) {
    const activity = record(entry);
    strings(activity, ['id', 'projectId', 'text', 'at']);
    if (!text(activity.id) || activityIds.has(text(activity.id)) || !projectIds.has(text(activity.projectId)) || (activity.taskId !== undefined && typeof activity.taskId !== 'string')) throw new Error('操作记录无效');
    activityIds.add(text(activity.id));
  }
  if (state.migrationNotice !== undefined && typeof state.migrationNotice !== 'string') throw new Error('迁入说明无效');
  if (state.seedProjectNamesRevision !== undefined && state.seedProjectNamesRevision !== 1) throw new Error('示例项目名称版本无效');
  return state as unknown as WorkbenchState;
}

/** Upgrade earlier v3 people fields without changing source data or existing history. */
export function upgradeTaskPeople(value: unknown): { state: WorkbenchState; changed: boolean } {
  const source = record(value);
  if (source.version !== 3 || !Array.isArray(source.tasks)) throw new Error('任务数据版本或列表无效');
  let changed = false;
  const tasks = source.tasks.map(value => {
    const previous = record(value);
    const task = { ...previous };
    if (!Object.hasOwn(previous, 'ownerIds')) {
      strings(previous, ['ownerId']);
      task.ownerIds = previous.ownerId ? [previous.ownerId] : [];
      changed = true;
    }
    const owners = normalizeOwnerIds(task.ownerIds);
    if (owners.length !== (task.ownerIds as string[]).length) changed = true;
    task.ownerIds = owners;
    if (!Object.hasOwn(previous, 'contactIds')) {
      const legacyField = Object.hasOwn(previous, 'contactId') ? 'contactId' : 'reviewerId';
      strings(previous, [legacyField]);
      task.contactIds = [previous[legacyField]];
      changed = true;
    }
    const contacts = normalizeContactIds(task.contactIds);
    if (contacts.length !== (task.contactIds as string[]).length) changed = true;
    task.contactIds = contacts;
    for (const field of ['ownerId', 'contactId', 'reviewerId']) {
      if (Object.hasOwn(task, field)) {
        delete task[field];
        changed = true;
      }
    }
    return task;
  });
  return { state: validateState(changed ? { ...source, tasks } : source), changed };
}

/** Rename untouched v3 examples once; identities, assignments and history stay intact. */
export function upgradeSeedProjectNames(state: WorkbenchState): WorkbenchState {
  if (state.seedProjectNamesRevision === 1 || !state.projects.some(project => SEED_PROJECT_NAMES.some(item => item.id === project.id))) return state;
  const next = structuredClone(state);
  for (const item of SEED_PROJECT_NAMES) {
    const project = next.projects.find(project => project.id === item.id && project.name === item.previous);
    const conflict = next.projects.some(project => project.id !== item.id && project.name.trim().toLowerCase() === item.current.toLowerCase());
    if (project && !conflict) project.name = item.current;
  }
  next.seedProjectNamesRevision = 1;
  return next;
}

/** Reads v2 without rewriting it. Exact names are the only automatic identity match. */
export function migrateSchedule(value: unknown): WorkbenchState {
  const old = record(typeof value === 'string' ? JSON.parse(value) : value);
  if (old.version !== 2 || !Array.isArray(old.members) || !Array.isArray(old.projects) || !Array.isArray(old.logs)) throw new Error('旧排班数据格式不兼容');
  const members = old.members.map(entry => {
    const member = record(entry);
    if (!text(member.id) || !text(member.name).trim()) throw new Error('旧成员资料无效');
    return { id: text(member.id), name: text(member.name).trim() };
  });
  const time = new Date().toISOString();
  const projects: Project[] = [];
  const tasks: Task[] = [];
  const activities: WorkbenchState['activities'] = [];
  for (const entry of old.projects) {
    const source = record(entry);
    strings(source, ['id', 'name', 'client', 'contact', 'location', 'note', 'startDate', 'endDate', 'managerId', 'managerStartDate', 'managerEndDate', 'status', 'createdAt', 'updatedAt']);
    if (!text(source.id) || !text(source.name).trim() || !Object.hasOwn(PROJECT_LABELS, text(source.status))) throw new Error('旧项目资料无效');
    dateRange(source);
    const originalManager = members.find(member => member.id === source.managerId);
    const manager = originalManager ? MANAGERS.find(item => item.name === originalManager.name) : undefined;
    const previousName = originalManager?.name || text(source.managerId);
    const hadAssignment = Boolean(source.managerId);
    if (hadAssignment && (!validDate(text(source.managerStartDate)) || !validDate(text(source.managerEndDate)) || text(source.managerStartDate) > text(source.managerEndDate) || text(source.managerStartDate) < text(source.startDate) || text(source.managerEndDate) > text(source.endDate))) throw new Error('旧经理排班日期无效');
    const isDone = source.status === 'done';
    const originalNote = hadAssignment ? `原经理安排：${previousName}，${text(source.managerStartDate)} 至 ${text(source.managerEndDate)}。${manager ? '已按姓名匹配固定项目经理。' : '姓名未匹配固定名单，请重新分配负责人。'}` : '';
    const project: Project = {
      id: text(source.id), name: text(source.name).trim(), client: text(source.client), contact: text(source.contact), location: text(source.location),
      startDate: text(source.startDate), endDate: text(source.endDate), managerId: manager?.id || '', status: text(source.status) as Project['status'],
      note: [text(source.note), originalNote].filter(Boolean).join('\n'), color: manager?.color || MANAGERS[projects.length % MANAGERS.length].color,
      createdAt: text(source.createdAt), updatedAt: time,
      ...(isDone ? { completedAt: text(source.completedAt) || `${text(source.endDate)}T12:00:00+08:00` } : {}),
    };
    projects.push(project);
    if (hadAssignment) {
      const task: Task = {
        id: `migrated-manager-${project.id}`, projectId: project.id, title: `${project.name} · 原经理安排`, description: `${originalNote}\n由原项目排期转为普通任务，可拆分为实际工作事项。${isDone ? '\n旧版已完成安排，保留原完成状态。' : ''}`,
        ownerIds: manager ? [manager.id] : [], contactIds: ['boss'], startDate: text(source.managerStartDate), endDate: text(source.managerEndDate),
        status: isDone ? 'done' : manager && source.status === 'active' ? 'doing' : 'todo', priority: 'normal', createdAt: text(source.createdAt), updatedAt: time,
        ...(isDone ? { completedAt: project.completedAt } : {}),
      };
      tasks.push(task);
    }
    activities.push({ id: `migrated-project-${project.id}`, projectId: project.id, at: time, text: `迁入项目「${project.name}」${hadAssignment ? `，原经理排期已转为任务；${manager ? `负责人：${manager.name}` : `原负责人${previousName}待重新分配`}` : ''}。旧版资料与历史记录仍保留在原存储中。` });
  }
  return validateState({ version: 3, projects, tasks, activities, migrationNotice: `已迁入旧项目及经理排期，任务负责人仅按姓名匹配五位项目经理；未匹配的安排请重新分配。旧版资料完整保留。${old.migratedFromWorkflow ? '旧流程日期是初始建议，请核对实际任务日期。' : ''}` });
}

export function loadWorkbench(): { state: WorkbenchState; warning?: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      let saved: WorkbenchState;
      let peopleChanged: boolean;
      try { ({ state: saved, changed: peopleChanged } = upgradeTaskPeople(JSON.parse(raw))); }
      catch { return { state: createSeed(), warning: '已保存的任务数据无法读取，当前仅展示示例，原数据尚未覆盖。请检查数据，或使用“恢复示例数据”后再操作。' }; }
      const upgraded = upgradeSeedProjectNames(saved);
      if (!peopleChanged && upgraded === saved) return { state: saved };
      try { saveWorkbench(upgraded); return { state: upgraded }; }
      catch { return { state: saved, warning: peopleChanged ? '多人负责人和对接人更新未能保存，原项目和任务完整保留，当前暂停写入，请检查本地存储后再操作。' : '项目名称更新未能保存，已保留原项目和任务，请检查本地存储后再操作。' }; }
    }
    const schedule = localStorage.getItem(SCHEDULE_KEY);
    const workflow = schedule === null ? localStorage.getItem(WORKFLOW_KEY) : null;
    if (schedule !== null || workflow !== null) {
      let state: WorkbenchState;
      try { state = migrateSchedule(schedule !== null ? schedule : migrateWorkflow(workflow!)); }
      catch { return { state: createSeed(), warning: '旧版数据未能迁入，原数据完整保留，当前仅展示示例。请检查旧数据，或使用“恢复示例数据”后再操作。' }; }
      try { saveWorkbench(state); return { state }; }
      catch { return { state, warning: '旧项目已读取，但浏览器无法保存新任务数据。原数据仍保留，请检查本地存储后再操作。' }; }
    }
    return { state: createSeed() };
  } catch {
    return { state: createSeed(), warning: '浏览器无法读取本地保存，当前仅展示示例。请检查本地存储后再操作。' };
  }
}
export function saveWorkbench(state: WorkbenchState): void {
  validateState(state);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { throw new Error('浏览器无法保存任务，此次修改没有保存，请检查本地存储设置'); }
}
