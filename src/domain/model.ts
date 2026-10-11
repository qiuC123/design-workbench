import type { Artifact, ArtifactKind, Command, Project, ProjectInput, Stage, State, TaskStatus } from './types';

export const STAGES: Stage[] = ['intake', 'design', 'sample', 'prebuild', 'acceptance', 'onsite', 'done'];
export const STAGE_LABELS: Record<Stage, string> = { intake: '项目接入', design: '设计出图', sample: '打样', prebuild: '工厂预搭建', acceptance: '客户验收', onsite: '现场落地', done: '已完成' };
export const TASK_LABELS: Record<TaskStatus, string> = { todo: '待启动', doing: '进行中', review: '待验收', done: '已完成' };
export const ARTIFACT_LABELS: Record<ArtifactKind, string> = { drawing: 'CAD 图纸', sample: '样品资料', prebuild: '预搭建记录', acceptance: '客户验收', onsite: '落地记录' };

export function today(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
}

export function isOverdue(date: string, completed = false): boolean {
  return Boolean(!completed && date && date < today());
}

export function memberName(state: State, memberId: string): string {
  return state.members.find(member => member.id === memberId)?.name || '未分配';
}

export function selectMyWork(state: State, memberId: string) {
  return {
    tasks: state.tasks.filter(task => task.ownerId === memberId || task.collaboratorIds.includes(memberId)),
    handoffs: state.handoffs.filter(handoff => handoff.toId === memberId && handoff.status === 'pending'),
    confirmations: state.artifacts.filter(artifact => artifact.confirmerId === memberId && artifact.status === 'pending'),
  };
}

const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const now = () => new Date().toISOString();

function required(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`请填写${label}`);
  return value.trim();
}

function dateValue(value: string, label: string): string {
  if (!value) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label}格式应为 YYYY-MM-DD`);
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${label}无效`);
  return value;
}

function safeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^\/demo\/[A-Za-z0-9_./-]+$/.test(trimmed) && !trimmed.includes('..')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password) return trimmed;
  } catch { /* The message below covers invalid URLs. */ }
  throw new Error('资料链接仅支持 http(s) 地址或 /demo/ 示例文件');
}

function projectOf(state: State, projectId: string): Project {
  const project = state.projects.find(item => item.id === projectId);
  if (!project) throw new Error('项目不存在');
  return project;
}

function activeMember(state: State, memberId: string, label = '成员', optional = false): void {
  if (!memberId && optional) return;
  const member = state.members.find(item => item.id === memberId);
  if (!member) throw new Error(`请选择有效的${label}`);
  if (!member.active) throw new Error(`${member.name}已停用，不能用于新的分配`);
}

function sameActor(state: State, expectedId: string, action: string): void {
  if (!expectedId) throw new Error(`请先设置${action}的确认人`);
  if (state.currentMemberId !== expectedId) throw new Error(`请切换为${memberName(state, expectedId)}后${action}`);
}

function activity(state: State, projectId: string, text: string, actorId = state.currentMemberId): void {
  state.activities.unshift({ id: id('activity'), projectId, text, actorId, at: now() });
}

function updateHandler(project: Project): void {
  if (project.stage === 'intake') project.handlerId = project.managerId;
  else if (project.stage === 'design') project.handlerId = project.drafterId || project.managerId;
  else if (project.stage === 'done') project.handlerId = project.managerId;
  else project.handlerId = project.leadId || project.managerId;
}

function validateProject(state: State, input: ProjectInput, previous?: Project): void {
  required(input.name, '项目名称');
  if (input.contactId && !state.contacts.some(contact => contact.id === input.contactId)) throw new Error('对接人不存在，请从统一名单选择');
  for (const key of ['managerId', 'drafterId', 'leadId', 'drawingConfirmerId', 'sampleConfirmerId', 'clientConfirmerId'] as const) {
    if (!previous || previous[key] !== input[key]) activeMember(state, input[key], '角色成员', true);
  }
  dateValue(input.dueDate, '下一关键日期');
  dateValue(input.plannedDate, '计划落地日期');
}

function unresolvedIssues(state: State, projectId: string): boolean {
  return state.issues.some(issue => issue.projectId === projectId && issue.status !== 'closed');
}

function clearManagedBlock(state: State, project: Project): void {
  if (unresolvedIssues(state, project.id)) return;
  if (/^(待整改|图纸未通过|样品未通过|预搭建未通过|客户验收未通过|现场落地未通过|交接退回)/.test(project.blockedReason)) project.blockedReason = '';
}

function milestoneConfirmer(project: Project, kind: ArtifactKind): string {
  if (kind === 'drawing') return project.drawingConfirmerId;
  if (kind === 'sample') return project.sampleConfirmerId;
  if (kind === 'acceptance') return project.clientConfirmerId;
  if (kind === 'onsite') return project.managerId;
  return project.leadId;
}

function validateConfirmationStage(state: State, project: Project, kind: ArtifactKind, accepted: boolean): void {
  if (project.stage === 'done') throw new Error('项目已经完成，不能继续推进确认节点');
  if (kind === 'drawing') {
    if (project.stage === 'intake') throw new Error('请先分配项目经理和绘图员');
    return;
  }
  const requiredStage: Partial<Record<ArtifactKind, Stage>> = { sample: 'sample', prebuild: 'prebuild', acceptance: 'acceptance', onsite: 'onsite' };
  const earliest = requiredStage[kind]!;
  if (STAGES.indexOf(project.stage) < STAGES.indexOf(earliest)) throw new Error(`请先完成前序交接和确认，进入${STAGE_LABELS[earliest]}阶段`);
  if (kind === 'sample' && !project.executionDrawingId) throw new Error('请先由项目组长接收已确认的 CAD 版本');
  if (accepted && (kind === 'acceptance' || kind === 'onsite') && unresolvedIssues(state, project.id)) throw new Error('仍有未闭环的整改事项，请完成处理并再次确认后通过');
}

function applyConfirmation(state: State, project: Project, artifact: Artifact, accepted: boolean, note: string): void {
  validateConfirmationStage(state, project, artifact.kind, accepted);
  artifact.status = accepted ? 'confirmed' : 'rejected';
  artifact.confirmedAt = now();
  if (note.trim()) artifact.notes = [artifact.notes, `${accepted ? '确认通过' : '退回意见'}：${note.trim()}`].filter(Boolean).join('\n');
  if (!accepted) {
    const label = artifact.kind === 'drawing' ? '图纸' : artifact.kind === 'sample' ? '样品' : artifact.kind === 'prebuild' ? '预搭建' : artifact.kind === 'onsite' ? '现场落地' : '客户验收';
    project.blockedReason = `${label}未通过：${note.trim() || '请记录修改意见并安排整改'}`;
  } else {
    clearManagedBlock(state, project);
    if (artifact.kind === 'sample' && project.stage === 'sample') project.stage = 'prebuild';
    if (artifact.kind === 'prebuild' && project.stage === 'prebuild') project.stage = 'acceptance';
    if (artifact.kind === 'acceptance' && project.stage === 'acceptance') project.stage = 'onsite';
    if (artifact.kind === 'onsite' && project.stage === 'onsite') {
      project.stage = 'done';
      project.completedAt = now();
    }
    updateHandler(project);
  }
  const eventNote = note.trim() || artifact.notes.trim();
  activity(state, project.id, `${accepted ? '确认通过' : '退回修改'} ${ARTIFACT_LABELS[artifact.kind]}「${artifact.title}」${artifact.version ? ` ${artifact.version}` : ''}${eventNote ? `：${eventNote}` : ''}`);
}

/** Pure transition boundary; UI and a future server can use the same commands. */
export function applyCommand(state: State, command: Command): State {
  const next = structuredClone(state);
  if (command.type !== 'switchMember' && command.type !== 'toggleMember') activeMember(next, next.currentMemberId, '当前演示成员');

  switch (command.type) {
    case 'createProject': {
      const input = command.payload;
      validateProject(next, input);
      if (next.projects.some(project => project.name.trim().toLowerCase() === input.name.trim().toLowerCase())) throw new Error('同名项目已存在，请搜索复用已有项目或修改项目名称');
      const project: Project = { ...input, name: input.name.trim(), id: id('project'), code: `DW-${today().slice(0, 4)}-${String(next.projects.length + 1).padStart(3, '0')}`, stage: input.managerId && input.drafterId ? 'design' : 'intake', handlerId: '', createdAt: now() };
      updateHandler(project);
      next.projects.unshift(project);
      activity(next, project.id, `创建项目「${project.name}」；经理：${memberName(next, project.managerId)}，绘图员：${memberName(next, project.drafterId)}`);
      break;
    }
    case 'editProject': {
      const project = projectOf(next, command.payload.projectId);
      const input = { ...project, ...command.payload.changes };
      validateProject(next, input, project);
      const oldDrawingConfirmer = project.drawingConfirmerId;
      const oldSampleConfirmer = project.sampleConfirmerId;
      Object.assign(project, command.payload.changes, { name: input.name.trim() });
      for (const artifact of next.artifacts.filter(item => item.projectId === project.id && item.status === 'pending')) {
        if (artifact.kind === 'drawing' && artifact.confirmerId === oldDrawingConfirmer && project.drawingConfirmerId !== oldDrawingConfirmer) artifact.confirmerId = project.drawingConfirmerId;
        if (artifact.kind === 'sample' && artifact.confirmerId === oldSampleConfirmer && project.sampleConfirmerId !== oldSampleConfirmer) artifact.confirmerId = project.sampleConfirmerId;
      }
      if (project.stage === 'intake' && project.managerId && project.drafterId) project.stage = 'design';
      updateHandler(project);
      activity(next, project.id, `更新项目信息和角色分工；经理：${memberName(next, project.managerId)}，绘图员：${memberName(next, project.drafterId)}，组长：${memberName(next, project.leadId)}`);
      break;
    }
    case 'addTask': {
      const input = command.payload;
      projectOf(next, input.projectId);
      activeMember(next, input.ownerId, '主负责人');
      input.collaboratorIds.forEach(memberId => activeMember(next, memberId, '协作人'));
      dateValue(input.dueDate, '任务截止日期');
      const task = { ...input, id: id('task'), title: required(input.title, '任务标题'), status: 'todo' as const, collaboratorIds: [...new Set(input.collaboratorIds)].filter(memberId => memberId !== input.ownerId) };
      next.tasks.unshift(task);
      activity(next, task.projectId, `新增任务「${task.title}」，负责人：${memberName(next, task.ownerId)}`);
      break;
    }
    case 'updateTask': {
      const input = command.payload;
      const task = next.tasks.find(item => item.id === input.taskId);
      if (!task) throw new Error('任务不存在');
      const previousStatus = task.status;
      if (input.ownerId !== undefined && input.ownerId !== task.ownerId) activeMember(next, input.ownerId, '主负责人');
      if (input.collaboratorIds !== undefined) input.collaboratorIds.filter(memberId => !task.collaboratorIds.includes(memberId)).forEach(memberId => activeMember(next, memberId, '协作人'));
      if (input.dueDate !== undefined) dateValue(input.dueDate, '任务截止日期');
      if (input.status && !Object.hasOwn(TASK_LABELS, input.status)) throw new Error('任务状态无效');
      const { taskId: _taskId, ...changes } = input;
      Object.assign(task, changes);
      task.collaboratorIds = [...new Set(task.collaboratorIds)].filter(memberId => memberId !== task.ownerId);
      if (task.status === 'done') task.completedAt ||= now();
      else delete task.completedAt;
      const issue = next.issues.find(item => item.id === task.issueId);
      if (issue) {
        issue.ownerId = task.ownerId;
        if (input.status !== undefined && (issue.status !== 'closed' || previousStatus !== task.status)) {
          issue.status = task.status === 'review' || task.status === 'done' ? 'awaiting' : task.status === 'doing' ? 'fixing' : 'open';
          delete issue.resolvedAt;
          projectOf(next, task.projectId).blockedReason = `待整改：${issue.title}`;
        }
      }
      activity(next, task.projectId, `更新任务「${task.title}」：${TASK_LABELS[task.status]}，负责人：${memberName(next, task.ownerId)}${task.blockedReason ? `；受阻：${task.blockedReason}` : ''}`);
      break;
    }
    case 'addArtifact': {
      const input = command.payload;
      const project = projectOf(next, input.projectId);
      if (project.stage === 'done') throw new Error('已完成项目不能新增待确认资料');
      if (!Object.hasOwn(ARTIFACT_LABELS, input.kind)) throw new Error('资料类型无效');
      activeMember(next, input.confirmerId, '确认人');
      if (!['drawing', 'sample'].includes(input.kind) && input.confirmerId !== milestoneConfirmer(project, input.kind)) throw new Error('此节点需由项目中指定的确认人确认');
      const version = required(input.version, '版本号');
      if (next.artifacts.some(artifact => artifact.projectId === project.id && artifact.kind === input.kind && artifact.version === version)) throw new Error('该类型已有相同版本号，请使用新版本并保留原记录');
      const artifact: Artifact = { ...input, id: id('artifact'), title: required(input.title, '资料标题'), version, url: safeUrl(input.url), status: 'pending', createdAt: now() };
      next.artifacts.unshift(artifact);
      activity(next, project.id, `新增${ARTIFACT_LABELS[input.kind]}「${artifact.title}」${version}，等待${memberName(next, input.confirmerId)}确认`);
      break;
    }
    case 'confirmArtifact': {
      const artifact = next.artifacts.find(item => item.id === command.payload.artifactId);
      if (!artifact) throw new Error('资料不存在');
      if (artifact.status === 'confirmed') throw new Error('该版本已确认，请新增版本记录后再提交确认');
      sameActor(next, artifact.confirmerId, '确认资料');
      if (!command.payload.accepted) required(command.payload.note, '修改意见');
      applyConfirmation(next, projectOf(next, artifact.projectId), artifact, command.payload.accepted, command.payload.note);
      break;
    }
    case 'createHandoff': {
      const input = command.payload;
      const project = projectOf(next, input.projectId);
      if (project.stage === 'done') throw new Error('已完成项目不能发起新的待接收交接');
      const artifact = next.artifacts.find(item => item.id === input.artifactId && item.projectId === project.id);
      if (!artifact || artifact.kind !== 'drawing' || artifact.status !== 'confirmed') throw new Error('请选择本项目已确认的 CAD 图纸版本');
      activeMember(next, input.toId, '接收人');
      if (input.toId !== project.leadId) throw new Error('CAD 图纸需交接给项目组长，请先调整项目组长');
      dateValue(input.dueDate, '交接目标日期');
      if (next.handoffs.some(handoff => handoff.projectId === project.id && handoff.artifactId === artifact.id && handoff.toId === input.toId && handoff.status === 'pending')) throw new Error('该版本已有待接收的交接，请先处理');
      next.handoffs.unshift({ ...input, id: id('handoff'), fromId: next.currentMemberId, status: 'pending', createdAt: now() });
      activity(next, project.id, `发起图纸交接 ${artifact.version} → ${memberName(next, input.toId)}${input.note ? `：${input.note}` : ''}`);
      break;
    }
    case 'acceptHandoff': {
      const input = command.payload;
      const handoff = next.handoffs.find(item => item.id === input.handoffId);
      if (!handoff) throw new Error('交接不存在');
      if (handoff.status !== 'pending') throw new Error('该交接已经处理');
      sameActor(next, handoff.toId, '处理交接');
      const project = projectOf(next, handoff.projectId);
      const artifact = next.artifacts.find(item => item.id === handoff.artifactId);
      if (!artifact || artifact.status !== 'confirmed') throw new Error('交接所用图纸尚未确认');
      if (!input.accepted) required(input.note, '退回意见');
      if (input.accepted && handoff.toId !== project.leadId) throw new Error('项目组长已变更，请重新发起交接给当前组长');
      handoff.status = input.accepted ? 'accepted' : 'returned';
      handoff.acceptedAt = now();
      if (input.note.trim()) handoff.note = [handoff.note, `${input.accepted ? '接收说明' : '退回意见'}：${input.note.trim()}`].filter(Boolean).join('\n');
      if (input.accepted) {
        project.executionDrawingId = artifact.id;
        if (project.stage === 'design') project.stage = 'sample';
        clearManagedBlock(next, project);
        updateHandler(project);
      } else project.blockedReason = `交接退回：${input.note.trim()}`;
      activity(next, project.id, `${input.accepted ? '接收' : '退回'}图纸交接 ${artifact.version}，执行依据${input.accepted ? '更新' : '保留'}${input.note.trim() ? `：${input.note.trim()}` : ''}`);
      break;
    }
    case 'skipSample': {
      const project = projectOf(next, command.payload.projectId);
      if (project.stage !== 'sample' || !project.executionDrawingId) throw new Error('只有接收图纸并进入打样阶段后，才可跳过打样');
      if (![project.managerId, project.leadId].includes(next.currentMemberId)) throw new Error('请切换为项目经理或项目组长后跳过打样');
      project.sampleSkippedReason = required(command.payload.reason, '跳过打样原因');
      for (const artifact of next.artifacts.filter(item => item.projectId === project.id && item.kind === 'sample' && item.status === 'pending')) {
        artifact.status = 'rejected';
        artifact.confirmedAt = now();
        artifact.notes = [artifact.notes, `未采用：项目已跳过打样。${project.sampleSkippedReason}`].filter(Boolean).join('\n');
      }
      project.stage = 'prebuild';
      updateHandler(project);
      activity(next, project.id, `跳过打样：${project.sampleSkippedReason}，进入工厂预搭建`);
      break;
    }
    case 'recordMilestone': {
      const input = command.payload;
      const project = projectOf(next, input.projectId);
      sameActor(next, milestoneConfirmer(project, input.kind), `登记${ARTIFACT_LABELS[input.kind]}`);
      if (!input.accepted) required(input.notes, '未通过原因');
      validateConfirmationStage(next, project, input.kind, input.accepted);
      const count = next.artifacts.filter(artifact => artifact.projectId === project.id && artifact.kind === input.kind).length;
      const artifact: Artifact = { id: id('artifact'), projectId: project.id, kind: input.kind, title: required(input.title, '记录标题'), version: `R${count + 1}`, url: safeUrl(input.url), notes: input.notes, status: 'pending', confirmerId: next.currentMemberId, createdAt: now() };
      next.artifacts.unshift(artifact);
      applyConfirmation(next, project, artifact, input.accepted, '');
      if (!input.accepted) project.blockedReason = `${ARTIFACT_LABELS[input.kind]}未通过：${input.notes.trim()}`;
      break;
    }
    case 'createIssue': {
      const input = command.payload;
      const project = projectOf(next, input.projectId);
      if (project.stage === 'done') throw new Error('已完成项目不能新增整改事项；当前原型未提供重开流程');
      const title = required(input.title, '问题内容');
      activeMember(next, input.ownerId, '整改负责人');
      dateValue(input.dueDate, '整改截止日期');
      const issueId = id('issue');
      const taskId = id('task');
      next.issues.unshift({ id: issueId, projectId: project.id, title, ownerId: input.ownerId, status: 'open', taskId, createdAt: now() });
      next.tasks.unshift({ id: taskId, projectId: project.id, title: `整改：${title}`, ownerId: input.ownerId, collaboratorIds: [], status: 'todo', dueDate: input.dueDate, blockedReason: '', issueId });
      project.blockedReason = `待整改：${title}`;
      activity(next, project.id, `登记整改「${title}」，负责人：${memberName(next, input.ownerId)}，已生成整改任务`);
      break;
    }
    case 'reconfirmIssue': {
      const input = command.payload;
      const issue = next.issues.find(item => item.id === input.issueId);
      if (!issue) throw new Error('整改事项不存在');
      if (issue.status !== 'awaiting') throw new Error('请先将整改任务更新为待验收或已完成，再次确认');
      const project = projectOf(next, issue.projectId);
      const confirmationKind: ArtifactKind = project.stage === 'design' ? 'drawing' : project.stage === 'sample' ? 'sample' : project.stage === 'onsite' ? 'onsite' : project.stage === 'prebuild' ? 'prebuild' : 'acceptance';
      sameActor(next, milestoneConfirmer(project, confirmationKind), '再次确认整改');
      if (!input.accepted) required(input.note, '再次退回意见');
      issue.status = input.accepted ? 'closed' : 'fixing';
      issue.confirmationNote = [issue.confirmationNote, `${input.accepted ? '再次确认通过' : '再次退回'}：${input.note.trim() || '处理结果符合要求'}`].filter(Boolean).join('\n');
      const task = next.tasks.find(item => item.id === issue.taskId);
      if (input.accepted) {
        issue.resolvedAt = now();
        if (task) { task.status = 'done'; task.completedAt = now(); }
        clearManagedBlock(next, project);
      } else {
        delete issue.resolvedAt;
        if (task) { task.status = 'doing'; delete task.completedAt; }
        project.blockedReason = `待整改：${issue.title}`;
      }
      activity(next, project.id, `${input.accepted ? '整改闭环' : '整改再次退回'}「${issue.title}」：${input.note.trim() || '处理结果符合要求'}`);
      break;
    }
    case 'toggleMember': {
      const member = next.members.find(item => item.id === command.payload.memberId);
      if (!member) throw new Error('成员不存在');
      if (member.active && next.members.filter(item => item.active).length === 1) throw new Error('至少保留一位启用成员用于体验');
      const actorId = next.currentMemberId;
      member.active = !member.active;
      const projects = next.projects.filter(project => [project.managerId, project.drafterId, project.leadId, project.drawingConfirmerId, project.sampleConfirmerId, project.clientConfirmerId].includes(member.id));
      projects.forEach(project => activity(next, project.id, `${member.active ? '启用' : '停用'}成员${member.name}${member.active ? '' : '；历史署名保留，未完成工作需安排交接'}`, actorId));
      if (!member.active && next.currentMemberId === member.id) next.currentMemberId = next.members.find(item => item.active)!.id;
      break;
    }
    case 'switchMember': {
      activeMember(next, command.payload.memberId, '演示成员');
      next.currentMemberId = command.payload.memberId;
      break;
    }
    case 'addContact': {
      const input = command.payload;
      const name = required(input.name, '对接人姓名');
      const company = input.company.trim();
      if (next.contacts.some(contact => contact.name === name && contact.company === company)) throw new Error('同名同公司的对接人已存在，请搜索复用');
      next.contacts.push({ ...input, id: id('contact'), name, company });
      break;
    }
    default: throw new Error('不支持的业务操作');
  }
  return next;
}
