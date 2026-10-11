import type { Command, Manager, Project, ProjectInput, ProjectStatus, Task, TaskInput, TaskStatus, WorkbenchState } from './types';

export const MANAGERS: Manager[] = [
  { id: 'member-one', name: '成员一', color: '#467c72' },
  { id: 'member-two', name: '成员二', color: '#6886b8' },
  { id: 'member-three', name: '成员三', color: '#bd9254' },
  { id: 'member-four', name: '成员四', color: '#9879b1' },
  { id: 'member-five', name: '成员五', color: '#bc7d70' },
];
export const TASK_LABELS: Record<TaskStatus, string> = { todo: '待办', doing: '进行中', review: '待核验', done: '已完成' };
export const PROJECT_LABELS: Record<ProjectStatus, string> = { planned: '待开始', active: '进行中', done: '已完成' };

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
export function scheduledTasks(state: WorkbenchState): Task[] {
  const activeProjects = new Set(state.projects.filter(project => project.status !== 'done').map(project => project.id));
  return state.tasks.filter(task => task.status !== 'done' && task.ownerIds.some(ownerId => MANAGERS.some(manager => manager.id === ownerId)) && activeProjects.has(task.projectId));
}
export function personDay(state: WorkbenchState, ownerId: string, date: string): { tasks: Task[]; free: boolean; overlapping: boolean } {
  requireDate(date);
  const tasks = scheduledTasks(state).filter(task => task.ownerIds.includes(ownerId) && task.startDate <= date && task.endDate >= date);
  return { tasks, free: tasks.length === 0, overlapping: tasks.length > 1 };
}
export function overlapTasks(state: WorkbenchState, ownerId: string, start: string, end: string, excludeTaskId?: string): Task[] {
  range(start, end);
  return scheduledTasks(state).filter(task => task.ownerIds.includes(ownerId) && task.id !== excludeTaskId && task.startDate <= end && task.endDate >= start);
}
export function nextFreeDate(state: WorkbenchState, ownerId: string, from: string): string {
  requireDate(from);
  let cursor = from;
  const tasks = scheduledTasks(state).filter(task => task.ownerIds.includes(ownerId) && task.endDate >= from).sort((a, b) => a.startDate.localeCompare(b.startDate));
  for (const task of tasks) {
    if (task.endDate < cursor) continue;
    if (task.startDate > cursor) break;
    cursor = addDays(task.endDate, 1);
  }
  return cursor;
}

const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const timestamp = () => new Date().toISOString();
const nameOf = (managerId: string) => managerId === 'boss' ? '老板' : MANAGERS.find(manager => manager.id === managerId)?.name || '待分配';
const ownerNames = (ownerIds: string[]) => ownerIds.length ? ownerIds.map(nameOf).join('、') : '待分配';
const contactNames = (contactIds: string[]) => contactIds.length ? contactIds.map(nameOf).join('、') : '待添加';
const required = (value: string, label: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`请填写${label}`);
  return value.trim();
};
const knownManager = (managerId: string) => managerId === '' || MANAGERS.some(manager => manager.id === managerId);
export function normalizeOwnerIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(ownerId => typeof ownerId !== 'string' || !ownerId || !knownManager(ownerId))) throw new Error('负责人须从五位项目经理中选择');
  return [...new Set(value as string[])];
}
export function normalizeContactIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(contactId => typeof contactId !== 'string' || !contactId || (contactId !== 'boss' && !knownManager(contactId)))) throw new Error('对接人须从老板或五位项目经理中选择');
  return [...new Set(value as string[])];
}
function projectOf(state: WorkbenchState, projectId: string): Project {
  const project = state.projects.find(item => item.id === projectId);
  if (!project) throw new Error('项目不存在');
  return project;
}
function taskOf(state: WorkbenchState, taskId: string): Task {
  const task = state.tasks.find(item => item.id === taskId);
  if (!task) throw new Error('任务不存在');
  return task;
}
function openProject(project: Project): void {
  if (project.status === 'done') throw new Error('项目已完成，请先恢复为进行中再安排或修改任务');
}
function validateProject(input: ProjectInput): void {
  required(input.name, '项目名称'); range(input.startDate, input.endDate);
  if (!Object.hasOwn(PROJECT_LABELS, input.status)) throw new Error('项目状态无效');
  if (!knownManager(input.managerId)) throw new Error('请从五位项目经理中选择');
  for (const field of ['client', 'contact', 'location', 'note', 'color'] as const) if (typeof input[field] !== 'string') throw new Error('项目信息格式无效');
}
function validateTask(state: WorkbenchState, input: TaskInput): void {
  required(input.title, '任务名称'); range(input.startDate, input.endDate);
  if (!Object.hasOwn(TASK_LABELS, input.status)) throw new Error('任务状态无效');
  normalizeOwnerIds(input.ownerIds);
  normalizeContactIds(input.contactIds);
  if (!['normal', 'high'].includes(input.priority) || typeof input.description !== 'string') throw new Error('任务资料格式无效');
  if (!input.ownerIds.length && input.status !== 'todo') throw new Error('请先分配负责人，再推进任务状态');
  const project = projectOf(state, input.projectId);
  openProject(project);
  // Project dates are a planning reference; the boss decides task scheduling.
}
function log(state: WorkbenchState, projectId: string, text: string, taskId?: string): void {
  state.activities.unshift({ id: id('activity'), projectId, ...(taskId ? { taskId } : {}), text, at: timestamp() });
}
function markTaskStatus(task: Task, status: TaskStatus): void {
  task.status = status;
  task.updatedAt = timestamp();
  if (status === 'done') task.completedAt ||= task.updatedAt;
  else delete task.completedAt;
}
function markProjectStatus(state: WorkbenchState, project: Project, status: ProjectStatus): void {
  if (!Object.hasOwn(PROJECT_LABELS, status)) throw new Error('项目状态无效');
  if (status === 'done' && state.tasks.some(task => task.projectId === project.id && task.status !== 'done')) throw new Error('还有未完成任务，请先完成或删除这些任务再完成项目');
  project.status = status;
  project.updatedAt = timestamp();
  if (status === 'done') project.completedAt ||= project.updatedAt;
  else delete project.completedAt;
}
function conflictNote(state: WorkbenchState, task: Task): string {
  const project = projectOf(state, task.projectId);
  const outside = task.startDate < project.startDate || task.endDate > project.endDate;
  const count = task.status !== 'done' ? new Set(task.ownerIds.flatMap(ownerId => overlapTasks(state, ownerId, task.startDate, task.endDate, task.id).map(item => item.id))).size : 0;
  return `${count ? `；同期另有 ${count} 项任务，已保留重叠安排` : ''}${outside ? '；任务日期超出项目计划，已按老板安排保存' : ''}`;
}
function statusNote(task: Task): string {
  return task.status === 'done' ? '老板记录：核验通过，任务已完成' : `状态改为${TASK_LABELS[task.status]}`;
}

/** One source of truth for the card board and personnel schedule. */
export function execute(state: WorkbenchState, command: Command): WorkbenchState {
  const next = structuredClone(state);
  switch (command.type) {
    case 'saveTaskByProjectName': {
      const { id: taskId, task } = command.payload;
      const input = { ...task, ownerIds: normalizeOwnerIds(task.ownerIds), contactIds: normalizeContactIds(task.contactIds) };
      const projectName = required(command.payload.projectName, '所属项目');
      const existing = next.projects.find(project => project.name.trim().toLowerCase() === projectName.toLowerCase());
      if (existing) openProject(existing);
      const resolved = existing ? next : execute(next, { type: 'createProject', payload: {
        name: projectName, client: '', contact: '', location: '', note: '',
        managerId: input.ownerIds[0] || '', startDate: input.startDate, endDate: input.endDate,
        status: input.status === 'todo' ? 'planned' : 'active',
        color: MANAGERS.find(manager => manager.id === input.ownerIds[0])?.color || MANAGERS[0].color,
      } });
      const projectId = existing?.id || resolved.projects[0].id;
      const changes: TaskInput = { ...input, projectId };
      // Both writes stay in a detached state until task validation also succeeds.
      return execute(resolved, taskId
        ? { type: 'editTask', payload: { id: taskId, changes } }
        : { type: 'createTask', payload: changes });
    }
    case 'createProject': {
      const input = command.payload;
      validateProject(input);
      if (next.projects.some(project => project.name.trim().toLowerCase() === input.name.trim().toLowerCase())) throw new Error('同名项目已存在，请选择已有项目或修改名称');
      const time = timestamp();
      const project: Project = { ...input, name: input.name.trim(), id: id('project'), createdAt: time, updatedAt: time, ...(input.status === 'done' ? { completedAt: time } : {}) };
      next.projects.unshift(project);
      log(next, project.id, `新建项目「${project.name}」；项目经理：${nameOf(project.managerId)}`);
      break;
    }
    case 'editProject': {
      const { id: projectId, changes } = command.payload;
      const project = projectOf(next, projectId);
      validateProject(changes);
      if (next.projects.some(item => item.id !== projectId && item.name.trim().toLowerCase() === changes.name.trim().toLowerCase())) throw new Error('同名项目已存在，请修改名称');
      markProjectStatus(next, project, changes.status);
      Object.assign(project, changes, { name: changes.name.trim() });
      const outsideCount = next.tasks.filter(task => task.projectId === projectId && (task.startDate < project.startDate || task.endDate > project.endDate)).length;
      log(next, projectId, `更新项目「${project.name}」；项目经理：${nameOf(project.managerId)}；${PROJECT_LABELS[project.status]}${outsideCount ? `；${outsideCount} 项任务超出项目计划，保留原任务日期` : ''}`);
      break;
    }
    case 'setProjectStatus': {
      const project = projectOf(next, command.payload.id);
      markProjectStatus(next, project, command.payload.status);
      log(next, project.id, `老板将项目「${project.name}」设为${PROJECT_LABELS[project.status]}`);
      break;
    }
    case 'createTask': {
      const input = { ...command.payload, ownerIds: normalizeOwnerIds(command.payload.ownerIds), contactIds: normalizeContactIds(command.payload.contactIds) };
      validateTask(next, input);
      const time = timestamp();
      const task: Task = { ...input, title: input.title.trim(), id: id('task'), createdAt: time, updatedAt: time, ...(input.status === 'done' ? { completedAt: time } : {}) };
      next.tasks.unshift(task);
      log(next, task.projectId, `新建任务「${task.title}」；负责人：${ownerNames(task.ownerIds)}；对接人：${contactNames(task.contactIds)}；计划 ${task.startDate} 至 ${task.endDate}${conflictNote(next, task)}${task.status === 'done' ? `；${statusNote(task)}` : ''}`, task.id);
      break;
    }
    case 'editTask': {
      const { id: taskId } = command.payload;
      const changes = { ...command.payload.changes, ownerIds: normalizeOwnerIds(command.payload.changes.ownerIds), contactIds: normalizeContactIds(command.payload.changes.contactIds) };
      const task = taskOf(next, taskId);
      openProject(projectOf(next, task.projectId));
      validateTask(next, changes);
      const previous = { ...task };
      Object.assign(task, changes, { title: changes.title.trim() });
      markTaskStatus(task, changes.status);
      const moves = previous.ownerIds.join(',') !== task.ownerIds.join(',') ? `；负责人由${ownerNames(previous.ownerIds)}改为${ownerNames(task.ownerIds)}` : `；负责人：${ownerNames(task.ownerIds)}`;
      if (previous.projectId !== task.projectId) log(next, previous.projectId, `任务「${task.title}」移至项目「${projectOf(next, task.projectId).name}」`, task.id);
      log(next, task.projectId, `更新任务「${task.title}」${moves}；对接人：${contactNames(task.contactIds)}；计划 ${task.startDate} 至 ${task.endDate}${previous.status !== task.status ? `；${statusNote(task)}` : ''}${conflictNote(next, task)}`, task.id);
      break;
    }
    case 'setTaskStatus': {
      const task = taskOf(next, command.payload.id);
      validateTask(next, { ...task, status: command.payload.status });
      markTaskStatus(task, command.payload.status);
      log(next, task.projectId, `「${task.title}」${statusNote(task)}`, task.id);
      break;
    }
    case 'reviewTask': {
      const task = taskOf(next, command.payload.id);
      openProject(projectOf(next, task.projectId));
      if (task.status !== 'review') throw new Error('请先将任务设为待核验，再记录验收结果');
      if (!task.ownerIds.length) throw new Error('请先分配负责人，再核验任务');
      const note = command.payload.approved ? command.payload.note.trim() : required(command.payload.note, '退回修改意见');
      markTaskStatus(task, command.payload.approved ? 'done' : 'doing');
      log(next, task.projectId, `老板记录：「${task.title}」${command.payload.approved ? '核验通过，任务已完成' : `退回修改，由${ownerNames(task.ownerIds)}继续处理`}${note ? `；意见：${note}` : ''}`, task.id);
      break;
    }
    case 'deleteTask': {
      const task = taskOf(next, command.payload.id);
      openProject(projectOf(next, task.projectId));
      next.tasks = next.tasks.filter(item => item.id !== task.id);
      log(next, task.projectId, `删除任务「${task.title}」，对应排班已释放；原负责人：${ownerNames(task.ownerIds)}`, task.id);
      break;
    }
    case 'dismissMigration': delete next.migrationNotice; break;
    default: throw new Error('不支持的操作');
  }
  return next;
}
