import type { AssignmentRole, Booking, MemberDay, ProjectInput, ProjectStatus, ScheduleCommand, ScheduleProject, ScheduleState } from './types';

export const ROLE_LABELS: Record<AssignmentRole, string> = { manager: '项目经理', lead: '项目组长' };
export const STATUS_LABELS: Record<ProjectStatus, string> = { planned: '待开始', active: '进行中', done: '已完成' };

export function today(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
}

function validDate(date: string, label = '日期'): string {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000-')) throw new Error(`${label}须为有效的 YYYY-MM-DD 日期`);
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) throw new Error(`${label}无效，请选择真实的日历日期`);
  return date;
}

export function addDays(date: string, n: number): string {
  validDate(date);
  if (!Number.isInteger(n)) throw new Error('日期偏移须为整数天数');
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + n);
  const result = value.toISOString().slice(0, 10);
  return validDate(result);
}

export function weekStart(date: string): string {
  validDate(date);
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDays(date, -((day + 6) % 7));
}

export function bookings(state: ScheduleState): Booking[] {
  return state.projects.filter(project => project.status !== 'done').flatMap(project => (['manager', 'lead'] as const).flatMap(role => {
    const memberId = role === 'manager' ? project.managerId : project.leadId;
    const startDate = role === 'manager' ? project.managerStartDate : project.leadStartDate;
    const endDate = role === 'manager' ? project.managerEndDate : project.leadEndDate;
    return memberId && startDate && endDate ? [{ projectId: project.id, memberId, role, startDate, endDate, status: project.status }] : [];
  }));
}

export function memberDay(state: ScheduleState, memberId: string, date: string): MemberDay {
  validDate(date);
  const arranged = bookings(state).filter(booking => booking.memberId === memberId && booking.startDate <= date && booking.endDate >= date);
  const projectCount = new Set(arranged.map(booking => booking.projectId)).size;
  return { memberId, projectCount, bookings: arranged, free: projectCount === 0, conflicting: projectCount > 1 };
}

export function conflicts(state: ScheduleState, projectId: string, memberId: string, start: string, end: string): Booking[] {
  validRange(start, end, '分配');
  return bookings(state).filter(booking => booking.projectId !== projectId && booking.memberId === memberId && booking.startDate <= end && booking.endDate >= start);
}

export function nextFreeDate(state: ScheduleState, memberId: string, from: string): string {
  validDate(from);
  let cursor = from;
  const arranged = bookings(state).filter(booking => booking.memberId === memberId && booking.endDate >= from).sort((a, b) => a.startDate.localeCompare(b.startDate));
  for (const booking of arranged) {
    if (booking.endDate < cursor) continue;
    if (booking.startDate > cursor) break;
    cursor = addDays(booking.endDate, 1);
  }
  return cursor;
}

const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const normalize = (text: string) => text.trim().toLowerCase();

function required(text: string, label: string): string {
  if (typeof text !== 'string' || !text.trim()) throw new Error(`请填写${label}`);
  return text.trim();
}

function validRange(start: string, end: string, label: string): void {
  validDate(start, `${label}开始日期`);
  validDate(end, `${label}结束日期`);
  if (start > end) throw new Error(`${label}结束日期不能早于开始日期`);
}

function validStatus(status: ProjectStatus): void {
  if (!Object.hasOwn(STATUS_LABELS, status)) throw new Error('项目状态无效');
}

function projectOf(state: ScheduleState, projectId: string): ScheduleProject {
  const project = state.projects.find(item => item.id === projectId);
  if (!project) throw new Error('项目不存在');
  return project;
}

function memberOf(state: ScheduleState, memberId: string) {
  const member = state.members.find(item => item.id === memberId);
  if (!member) throw new Error('成员不存在，请从团队名单选择');
  return member;
}

function log(state: ScheduleState, projectId: string, text: string): void {
  state.logs.unshift({ id: id('log'), projectId, text, at: now() });
}

function validateProjectInput(input: ProjectInput): void {
  required(input.name, '项目名称');
  validRange(input.startDate, input.endDate, '项目计划');
  validStatus(input.status);
}

function setStatus(project: ScheduleProject, status: ProjectStatus): void {
  project.status = status;
  if (status === 'done') project.completedAt ||= now();
  else delete project.completedAt;
}

/** Boss-operated schedule commands. Conflicts are visible warnings, never approval gates. */
export function applyCommand(state: ScheduleState, command: ScheduleCommand): ScheduleState {
  const next = structuredClone(state);
  switch (command.type) {
    case 'createProject': {
      const input = command.payload;
      validateProjectInput(input);
      if (next.projects.some(project => normalize(project.name) === normalize(input.name))) throw new Error('同名项目已存在，请搜索复用或修改项目名称');
      const project: ScheduleProject = {
        ...input, id: id('project'), name: input.name.trim(), managerId: '', managerStartDate: '', managerEndDate: '',
        leadId: '', leadStartDate: '', leadEndDate: '', createdAt: now(), updatedAt: now(),
      };
      setStatus(project, input.status);
      next.projects.unshift(project);
      log(next, project.id, `新建项目「${project.name}」，计划 ${project.startDate} 至 ${project.endDate}；项目经理待分配，组长待定。`);
      break;
    }
    case 'editProject': {
      const project = projectOf(next, command.payload.projectId);
      const input = { ...project, ...command.payload.changes };
      validateProjectInput(input);
      if (next.projects.some(item => item.id !== project.id && normalize(item.name) === normalize(input.name))) throw new Error('同名项目已存在，请修改项目名称或复用已有项目');
      for (const role of ['manager', 'lead'] as const) {
        const memberId = role === 'manager' ? project.managerId : project.leadId;
        const start = role === 'manager' ? project.managerStartDate : project.leadStartDate;
        const end = role === 'manager' ? project.managerEndDate : project.leadEndDate;
        if (memberId && (start < input.startDate || end > input.endDate)) throw new Error(`${ROLE_LABELS[role]}排期（${start} 至 ${end}）超出新的项目计划日期，请先调整该角色排期或扩大项目日期。`);
      }
      const previousStatus = project.status;
      Object.assign(project, command.payload.changes, { name: input.name.trim(), updatedAt: now() });
      setStatus(project, input.status);
      log(next, project.id, `更新项目「${project.name}」：计划 ${project.startDate} 至 ${project.endDate}${previousStatus !== project.status ? `；状态改为${STATUS_LABELS[project.status]}${project.status === 'done' ? '，释放人员排班' : previousStatus === 'done' ? '，恢复已有角色排期' : ''}` : ''}。`);
      break;
    }
    case 'assign': {
      const input = command.payload;
      const project = projectOf(next, input.projectId);
      if (!Object.hasOwn(ROLE_LABELS, input.role)) throw new Error('分配职责无效');
      if (project.status === 'done') throw new Error('项目已完成，请先恢复为进行中或待开始，再安排人员');
      const member = memberOf(next, input.memberId);
      if (!member.active) throw new Error(`${member.name}已停用，只能取消原安排或转给其他成员，不能新增或调整其排期。`);
      validRange(input.startDate, input.endDate, '角色排期');
      if (input.startDate < project.startDate || input.endDate > project.endDate) throw new Error(`角色排期须在项目计划 ${project.startDate} 至 ${project.endDate} 以内，请调整排期或先扩大项目日期。`);
      const overlaps = conflicts(next, project.id, member.id, input.startDate, input.endDate);
      if (input.role === 'manager') { project.managerId = member.id; project.managerStartDate = input.startDate; project.managerEndDate = input.endDate; }
      else { project.leadId = member.id; project.leadStartDate = input.startDate; project.leadEndDate = input.endDate; }
      project.updatedAt = now();
      const overlapNames = [...new Set(overlaps.map(booking => projectOf(next, booking.projectId).name))];
      log(next, project.id, `安排${member.name}担任${ROLE_LABELS[input.role]}：${input.startDate} 至 ${input.endDate}${overlapNames.length ? `；与「${overlapNames.join('」「')}」排期重叠，已保留此次安排，请老板统筹。` : '。'}`);
      break;
    }
    case 'unassign': {
      const project = projectOf(next, command.payload.projectId);
      const role = command.payload.role;
      if (!Object.hasOwn(ROLE_LABELS, role)) throw new Error('分配职责无效');
      const previousMemberId = role === 'manager' ? project.managerId : project.leadId;
      if (!previousMemberId) throw new Error(`此项目尚未分配${ROLE_LABELS[role]}`);
      const member = memberOf(next, previousMemberId);
      if (role === 'manager') { project.managerId = ''; project.managerStartDate = ''; project.managerEndDate = ''; }
      else { project.leadId = ''; project.leadStartDate = ''; project.leadEndDate = ''; }
      project.updatedAt = now();
      log(next, project.id, `取消${member.name}的${ROLE_LABELS[role]}安排；${role === 'manager' ? '经理待分配' : '组长待定'}。`);
      break;
    }
    case 'setProjectStatus': {
      const project = projectOf(next, command.payload.projectId);
      validStatus(command.payload.status);
      const previousStatus = project.status;
      setStatus(project, command.payload.status);
      project.updatedAt = now();
      log(next, project.id, `项目状态由${STATUS_LABELS[previousStatus]}改为${STATUS_LABELS[project.status]}${project.status === 'done' ? '；人员排班已释放，历史人选和日期保留。' : previousStatus === 'done' ? '；已恢复历史角色排期，可继续调整。' : '。'}`);
      break;
    }
    case 'addMember': {
      const name = required(command.payload.name, '成员姓名');
      if (next.members.some(member => normalize(member.name) === normalize(name))) throw new Error('同名成员已存在，请复用已有成员或使用可区分的姓名');
      const palette = ['#647f71', '#a57859', '#637fa3', '#9878a6', '#b99347'];
      next.members.push({ id: id('member'), name, specialty: command.payload.specialty.trim(), color: palette[next.members.length % palette.length], active: true });
      log(next, '', `新增团队成员${name}${command.payload.specialty.trim() ? `，擅长${command.payload.specialty.trim()}` : ''}。`);
      break;
    }
    case 'editMember': {
      const input = command.payload;
      const member = memberOf(next, input.memberId);
      const name = required(input.name, '成员姓名');
      if (next.members.some(item => item.id !== member.id && normalize(item.name) === normalize(name))) throw new Error('同名成员已存在，请使用可区分的姓名');
      const oldName = member.name;
      member.name = name;
      member.specialty = input.specialty.trim();
      log(next, '', `更新成员资料：${oldName}${oldName !== name ? `更名为${name}` : ''}${member.specialty ? `，擅长${member.specialty}` : ''}；原项目关联保留。`);
      break;
    }
    case 'toggleMember': {
      const member = memberOf(next, command.payload.memberId);
      member.active = !member.active;
      log(next, '', `${member.active ? '启用' : '停用'}成员${member.name}${member.active ? '，可用于新的人员安排。' : '；已有项目和排期保留，请取消安排或转交，停用成员不计入可用人员统计。'}`);
      break;
    }
    case 'dismissMigrationNotice': {
      next.migratedFromWorkflow = false;
      log(next, '', '已确认迁入的项目与人员安排，请按实际情况继续调整排期。');
      break;
    }
    default: throw new Error('不支持的排班操作');
  }
  return next;
}
