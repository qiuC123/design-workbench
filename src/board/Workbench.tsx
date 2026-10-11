import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2, ChevronRight, CircleHelp, Clock3, FolderKanban, LayoutGrid, Layers3, Pencil, Plus, RotateCcw, Search, Trash2, Users, X } from 'lucide-react';
import type { Command, Project, ProjectInput, ProjectStatus, Task, TaskInput, TaskStatus, WorkbenchState } from './types';
import { MANAGERS, TASK_LABELS, PROJECT_LABELS, today, addDays, weekStart, validDate, execute, scheduledTasks, personDay, overlapTasks, nextFreeDate } from './model';
import { loadWorkbench, saveWorkbench, STORAGE_KEY } from './storage';
import { createSeed } from './seed';
import './board.css';

const statuses: TaskStatus[] = ['todo', 'doing', 'review', 'done'];
const fmt = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
const timeFmt = (at: string) => new Date(at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const nameOf = (id: string) => id === 'boss' ? '老板' : MANAGERS.find(m => m.id === id)?.name || '待分配';
const ownerNames = (ids: string[]) => ids.length ? ids.map(nameOf).join('、') : '待分配';
const contactNames = (ids: string[]) => ids.length ? ids.map(nameOf).join('、') : '待添加';
const distance = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000);
type View = 'board' | 'schedule' | 'projects';
function currentRoute(): { view: View; projectId?: string; date?: string; taskId?: string } {
  const [path, query] = (location.hash.slice(1) || '/board').split('?');
  const parts = path.split('/'), params = new URLSearchParams(query);
  const selectedDate = params.get('date') || '';
  const selection = { date: validDate(selectedDate) ? selectedDate : undefined, taskId: params.get('task') || undefined };
  if (parts[1] === 'project') return { ...selection, projectId: parts[2], view: parts[3] === 'schedule' ? 'schedule' : 'board' };
  return { ...selection, view: parts[1] === 'schedule' ? 'schedule' : parts[1] === 'projects' ? 'projects' : 'board' };
}
type Modal = { kind: 'task'; taskId?: string; projectId?: string; ownerId?: string; date?: string; status?: TaskStatus } | { kind: 'project'; projectId?: string } | { kind: 'help' | 'reset' };
type Run = (command: Command, feedback?: string, onError?: (message: string) => void) => WorkbenchState | undefined;
function Avatar({ id }: { id: string }) { return <span aria-hidden="true" className="tw-avatar" style={{ background: MANAGERS.find(m => m.id === id)?.color || '#73847b' }}>{id === 'boss' ? '主' : id ? nameOf(id).slice(-2) : '?'}</span>; }
function Field({ label, children, full = false }: { label: string; children: ReactNode; full?: boolean }) { return <label className={`tw-field ${full ? 'tw-span-2' : ''}`}><span>{label}</span>{children}</label>; }
function PeoplePicker({ kind, value, onChange, disabled }: { kind: 'owner' | 'contact'; value: string[]; onChange: (ids: string[]) => void; disabled: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const label = kind === 'owner' ? '负责人' : '对接人';
  const options = kind === 'owner' ? MANAGERS : [{ id: 'boss', name: '老板' }, ...MANAGERS];
  return <fieldset aria-label={label} className="tw-owner-picker tw-span-2" disabled={disabled}>
    <legend>{label} <small>{kind === 'owner' ? '可多选 · 同步到每个人的排班' : '可多选 · 负责沟通，不单独占排班'}</small></legend>
    <div className="tw-owner-selection">{value.map(id => <span className="tw-owner-chip" key={id}><Avatar id={id} />{nameOf(id)}<button type="button" aria-label={`移除${label} ${nameOf(id)}`} onClick={() => onChange(value.filter(item => item !== id))}><X size={13} /></button></span>)}
      {!value.length && <span className="tw-owner-placeholder">{kind === 'owner' ? '待分配' : '待添加'}</span>}
      <button type="button" className="tw-owner-add" aria-expanded={expanded} aria-controls={`task-${kind}-options`} onClick={() => setExpanded(!expanded)}><Plus size={14} />{expanded ? '收起选择' : `添加${label}`}</button>
    </div>
    {expanded && <div className="tw-owner-options" id={`task-${kind}-options`}>{options.map(m => <label key={m.id} className={value.includes(m.id) ? 'selected' : ''}><input type="checkbox" name={`${kind}Ids`} value={m.id} checked={value.includes(m.id)} onChange={e => onChange(e.target.checked ? [...value, m.id] : value.filter(id => id !== m.id))} /><Avatar id={m.id} /><span>{m.name}</span></label>)}</div>}
  </fieldset>;
}
function Dialog({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement; const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab') {
        const all = [...(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]') || [])].filter(el => el.getClientRects().length);
        const first = all[0], last = all[all.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  return <div className="tw-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={ref} className={`tw-modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header className="tw-modal-head"><div><span className="tw-eyebrow">序间 · 工作安排</span><h2>{title}</h2></div><button className="tw-icon-button" aria-label="关闭窗口" onClick={onClose}><X size={20} /></button></header>{children}</div></div>;
}

function TaskEditor({ state, modal, run, onClose }: { state: WorkbenchState; modal: Extract<Modal, { kind: 'task' }>; run: Run; onClose: () => void }) {
  const task = state.tasks.find(t => t.id === modal.taskId);
  const initialProject = state.projects.find(p => p.id === (task?.projectId || modal.projectId)) || state.projects.find(p => p.status !== 'done');
  const start = modal.date || (initialProject ? (today() < initialProject.startDate ? initialProject.startDate : today() > initialProject.endDate ? initialProject.endDate : today()) : today());
  const [projectName, setProjectName] = useState(initialProject?.name || '');
  const [draft, setDraft] = useState<Omit<TaskInput, 'projectId'>>({
    title: task?.title || '', description: task?.description || '', ownerIds: task?.ownerIds ?? [modal.ownerId ?? initialProject?.managerId ?? ''].filter(Boolean),
    contactIds: task?.contactIds ?? ['boss'], startDate: task?.startDate || start, endDate: task?.endDate || start,
    status: task?.status || (modal.status === 'done' ? 'todo' : modal.status || 'todo'), priority: task?.priority || 'normal',
  });
  const [error, setError] = useState(''); const [note, setNote] = useState(''); const [deleting, setDeleting] = useState(false);
  const project = state.projects.find(p => p.name.trim().toLowerCase() === projectName.trim().toLowerCase());
  const locked = !!task && initialProject?.status === 'done';
  const rangeValid = validDate(draft.startDate) && validDate(draft.endDate) && draft.startDate <= draft.endDate;
  const overlaps = rangeValid ? draft.ownerIds.map(ownerId => ({ ownerId, tasks: overlapTasks(state, ownerId, draft.startDate, draft.endDate, task?.id) })).filter(item => item.tasks.length) : [];
  const outsidePlan = rangeValid && project && (draft.startDate < project.startDate || draft.endDate > project.endDate);
  const set = <K extends keyof Omit<TaskInput, 'projectId'>>(key: K, value: TaskInput[K]) => { setDraft(d => ({ ...d, [key]: value })); setError(''); };
  const perform = (command: Command, feedback: string) => { const next = run(command, feedback, setError); if (next) onClose(); };
  const submit = (event: FormEvent) => { event.preventDefault(); perform({ type: 'saveTaskByProjectName', payload: { id: task?.id, projectName, task: draft } }, task ? '任务及所属项目已更新，看板与排班已同步' : '任务已创建，并同步到排班表'); };
  const review = (approved: boolean) => {
    if (!task) return;
    if (!approved && !note.trim()) { setError('退回修改时，请填写核验意见。'); return; }
    perform({ type: 'reviewTask', payload: { id: task.id, approved, note } }, approved ? '核验通过，任务已完成并释放排班' : '已退回进行中，核验意见已记录');
  };
  return <Dialog title={task ? '任务详情' : '新建任务'} wide onClose={onClose}>
    <div className="tw-modal-body"><div className="tw-task-editor"><form id="task-form" className="tw-form" onSubmit={submit}>
      <div className="tw-form-grid">
        <Field label="任务名称" full><input name="title" required maxLength={100} placeholder="例如：完成展厅平面布局初稿" value={draft.title} onChange={e => set('title', e.target.value)} disabled={locked} /></Field>
        <Field label="所属项目" full><input name="projectName" required maxLength={100} value={projectName} disabled={locked} placeholder="直接输入项目名称，例如：示例乙香氛" onChange={e => { setProjectName(e.target.value); setError(''); }} /></Field>
        <p className="tw-note tw-span-2">{project ? '使用已有项目。修改此处只更换本任务的归属；统一改名可在“项目信息”中编辑。' : projectName.trim() ? `保存时会新建“${projectName.trim()}”项目，并关联这项任务。` : '直接输入名称；同名项目自动复用，新名称随任务一起创建。'}</p>
        <PeoplePicker kind="owner" value={draft.ownerIds} disabled={locked} onChange={ids => set('ownerIds', ids)} />
        <PeoplePicker kind="contact" value={draft.contactIds} disabled={locked} onChange={ids => set('contactIds', ids)} />
        <Field label="计划开始"><input name="startDate" type="date" required disabled={locked} value={draft.startDate} onChange={e => set('startDate', e.target.value)} /></Field>
        <Field label="计划结束"><input name="endDate" type="date" required disabled={locked} value={draft.endDate} onChange={e => set('endDate', e.target.value)} /></Field>
        <Field label="任务状态"><select name="status" value={draft.status} disabled={locked} onChange={e => set('status', e.target.value as TaskStatus)}>{statuses.filter(s => s !== 'done' || task?.status === 'done').map(s => <option key={s} value={s}>{TASK_LABELS[s]}</option>)}</select></Field>
        <Field label="优先级"><select name="priority" value={draft.priority} disabled={locked} onChange={e => set('priority', e.target.value as TaskInput['priority'])}><option value="normal">常规安排</option><option value="high">优先处理</option></select></Field>
        <Field label="任务说明" full><textarea name="description" rows={4} placeholder="说明工作内容、交付要求和沟通结果…" value={draft.description} disabled={locked} onChange={e => set('description', e.target.value)} /></Field>
      </div>
      {project && <p className="tw-note">项目参考日期：{project.startDate} 至 {project.endDate}。人员排班以本任务的起止日期为准。</p>}
      {outsidePlan && <div className="tw-conflict tw-plan-warning"><strong>任务日期超出项目计划</strong>{draft.startDate < project.startDate && <p>任务从 {draft.startDate} 开始，早于项目计划的 {project.startDate}。</p>}{draft.endDate > project.endDate && <p>任务安排到 {draft.endDate}，晚于项目计划结束的 {project.endDate}。</p>}<p>仅作参考提醒，可以直接保存，排班仍按任务日期显示。两组日期各自保留；如需修改整个项目计划，可到“项目信息”调整。</p></div>}
      {!rangeValid ? <div className="tw-conflict">请填写有效的起止日期，结束日期不能早于开始日期。</div> : overlaps.length > 0 ? <div className="tw-conflict tw-overlap-warning">{overlaps.map(item => <div key={item.ownerId}><strong>{nameOf(item.ownerId)}在这段时间另有 {item.tasks.length} 项任务</strong><p>{item.tasks.map(t => t.title).join('、')}</p></div>)}<small>可以保留并行安排。此提示不影响保存，是否能完成由老板判断。</small></div> : draft.ownerIds.length > 0 && <p className="tw-note"><Check size={13} /> 所选负责人这段时间没有其他未完成任务排班。</p>}
      {error && <p role="alert" className="tw-error">{error}</p>}
    </form><aside className="tw-task-aside">
      <div><h3>安排给谁</h3>{(draft.ownerIds.length ? draft.ownerIds : ['']).map(id => <div className="tw-person-name" key={`owner-${id}`}><Avatar id={id} /><strong>{nameOf(id)}</strong><span>负责执行</span></div>)}{draft.contactIds.map(id => <div className="tw-person-name" key={`contact-${id}`}><Avatar id={id} /><strong>{nameOf(id)}</strong><span>负责对接</span></div>)}{!draft.contactIds.length && <p className="tw-note">对接人待添加</p>}<p className="tw-note">未完成任务按相同日期计入每位负责人的排班，共用一份进度。老板根据沟通结果记录核验。</p></div>
      {task?.status === 'review' && !locked && <div className="tw-review-box"><h3>核验这项任务</h3><p>由老板记录核验结果；对接人负责沟通。</p><label className="tw-field"><span>核验意见</span><textarea name="note" rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="通过时可补充说明；退回时请写清修改内容" /></label><div className="tw-actions"><button type="button" className="tw-button primary small" onClick={() => review(true)}><Check size={14} />核验通过</button><button type="button" className="tw-button small" onClick={() => review(false)}>退回修改</button></div><small>这里记录已保存任务的核验结果；修改任务信息请先保存。</small></div>}
      {task?.completedAt && <div className="tw-note"><CheckCircle2 size={15} /> 实际完成：{timeFmt(task.completedAt)}</div>}
      {locked && <div className="tw-note">项目已完成。需继续安排时，先在项目信息中恢复为进行中。</div>}
      {task && <div><h3>任务记录</h3><ol className="tw-activity">{state.activities.filter(a => a.taskId === task.id).slice(0, 15).map(a => <li key={a.id}><time>{timeFmt(a.at)}</time><p>{a.text}</p></li>)}</ol></div>}
      {!task && <div className="tw-note">创建后，任务会出现在对应状态的卡片列中，也会出现在负责人的排班表上。</div>}
    </aside></div></div>
    <footer className="tw-modal-footer">{task && !locked && <button type="button" className="tw-button ghost danger" onClick={() => setDeleting(!deleting)}><Trash2 size={15} />删除任务</button>}{deleting ? <div className="tw-confirm"><span>删除后释放这项任务的排班。</span><button className="tw-button danger" onClick={() => perform({ type: 'deleteTask', payload: { id: task!.id } }, '任务已删除，排班已同步')}>确认删除</button></div> : <div className="tw-actions"><button className="tw-button" onClick={onClose}>关闭</button><button className="tw-button primary" form="task-form" type="submit" disabled={locked}>{task ? '保存修改' : '创建任务'}</button></div>}</footer>
  </Dialog>;
}

function ProjectEditor({ state, projectId, run, onClose, onCreated }: { state: WorkbenchState; projectId?: string; run: Run; onClose: () => void; onCreated: (id: string) => void }) {
  const project = state.projects.find(p => p.id === projectId); const [error, setError] = useState('');
  const [planStart, setPlanStart] = useState(project?.startDate || today());
  const [planEnd, setPlanEnd] = useState(project?.endDate || addDays(today(), 14));
  const outsideTasks = validDate(planStart) && validDate(planEnd) && planStart <= planEnd ? state.tasks.filter(t => t.projectId === projectId && (t.startDate < planStart || t.endDate > planEnd)) : [];
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const fd = new FormData(e.currentTarget); const get = (key: string) => String(fd.get(key) || '').trim();
    const payload: ProjectInput = { name: get('name'), client: get('client'), contact: get('contact'), location: get('location'), startDate: get('startDate'), endDate: get('endDate'), managerId: get('managerId'), status: get('status') as ProjectStatus, color: project?.color || '#5d8476', note: get('note') };
    const next = run(project ? { type: 'editProject', payload: { id: project.id, changes: payload } } : { type: 'createProject', payload }, project ? '项目信息已保存' : '项目已创建，可以开始分配任务', setError);
    if (!next) return; onClose(); if (!project) onCreated(next.projects.find(p => !state.projects.some(old => old.id === p.id))!.id);
  }
  return <Dialog title={project ? '编辑项目' : '新建项目'} onClose={onClose}><div className="tw-modal-body"><form id="project-form" className="tw-form-grid" onSubmit={submit}>
    <Field label="项目名称" full><input name="name" required maxLength={100} defaultValue={project?.name} placeholder="例如：星河品牌展厅" /></Field>
    <Field label="客户"><input name="client" defaultValue={project?.client} placeholder="客户或公司名称" /></Field><Field label="对接人"><input name="contact" defaultValue={project?.contact} placeholder="客户联系人" /></Field>
    <Field label="项目经理"><select name="managerId" defaultValue={project?.managerId || ''}><option value="">稍后确定</option>{MANAGERS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
    <Field label="项目状态"><select name="status" defaultValue={project?.status || 'planned'}>{Object.entries(PROJECT_LABELS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field>
    <Field label="计划开始"><input name="startDate" type="date" required value={planStart} onChange={e => { setPlanStart(e.target.value); setError(''); }} /></Field><Field label="计划结束"><input name="endDate" type="date" required value={planEnd} onChange={e => { setPlanEnd(e.target.value); setError(''); }} /></Field>
    <Field label="地点" full><input name="location" defaultValue={project?.location} placeholder="项目落地地点" /></Field><Field label="项目备注" full><textarea name="note" defaultValue={project?.note} placeholder="沟通结论、计划说明…" /></Field>
    <p className="tw-note tw-span-2">项目经理负责统筹。具体人员排班以任务的负责人和日期为准；项目计划仅供参考，可直接调整。</p>{outsideTasks.length > 0 && <div className="tw-conflict tw-plan-warning tw-span-2"><strong>{outsideTasks.length} 项任务超出当前项目计划</strong><p>仅作提醒，可以直接保存；现有任务日期保持原安排。</p></div>}{error && <p className="tw-error tw-span-2" role="alert">{error}</p>}
  </form></div><footer className="tw-modal-footer"><div className="tw-actions"><button className="tw-button" onClick={onClose}>取消</button><button form="project-form" type="submit" className="tw-button primary">{project ? '保存项目' : '创建项目'}</button></div></footer></Dialog>;
}

export default function Workbench() {
  const [initial] = useState(loadWorkbench); const [state, setState] = useState(initial.state); const stateRef = useRef(state);
  const [warning, setWarning] = useState(initial.warning || ''); const warningRef = useRef(warning);
  const [route, setRoute] = useState(currentRoute); const [date, setDate] = useState(() => currentRoute().date || today()); const [search, setSearch] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('all'); const [freeOnly, setFreeOnly] = useState(false); const [mobileStatus, setMobileStatus] = useState<TaskStatus>('todo');
  const [modal, setModal] = useState<Modal | null>(null); const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const notify = (text: string, error = false) => setToast({ text, error });
  function run(command: Command, feedback?: string, onError?: (message: string) => void) {
    try { if (warningRef.current) throw new Error(warningRef.current); const next = execute(stateRef.current, command); saveWorkbench(next); stateRef.current = next; setState(next); if (feedback) notify(feedback); return next; }
    catch (e) { const message = e instanceof Error ? e.message : '操作未能保存'; if (onError) { setToast(null); onError(message); } else notify(message, true); return undefined; }
  }
  function navigate(path: string) { location.hash = path; const next = currentRoute(); setRoute(next); if (next.date) setDate(next.date); setSearch(''); setFreeOnly(false); if (!next.taskId) window.scrollTo({ top: 0, behavior: 'instant' }); }
  useEffect(() => {
    const hash = () => { const next = currentRoute(); setRoute(next); if (next.view === 'schedule') setDate(next.date || today()); if (next.taskId) setOwnerFilter('all'); setSearch(''); setFreeOnly(false); };
    const sync = (e: StorageEvent) => { if (e.key === STORAGE_KEY || e.key === null) { const loaded = loadWorkbench(); stateRef.current = loaded.state; setState(loaded.state); setWarning(loaded.warning || ''); warningRef.current = loaded.warning || ''; setModal(null); notify(loaded.warning || '已同步另一个页面的任务修改', !!loaded.warning); } };
    window.addEventListener('hashchange', hash); window.addEventListener('storage', sync);
    return () => { window.removeEventListener('hashchange', hash); window.removeEventListener('storage', sync); };
  }, []);
  useEffect(() => {
    if (route.view !== 'schedule' || !route.taskId) return;
    const frame = requestAnimationFrame(() => {
      const target = [...document.querySelectorAll<HTMLElement>('[data-task-id]')].find(el => el.dataset.taskId === route.taskId && el.getClientRects().length);
      target?.scrollIntoView({ block: 'center', behavior: 'instant' });
    });
    return () => cancelAnimationFrame(frame);
  }, [route, date]);
  useEffect(() => { if (!toast) return; const timeout = setTimeout(() => setToast(null), toast.error ? 10000 : 4500); return () => clearTimeout(timeout); }, [toast]);
  useEffect(() => { if (route.view === 'schedule' && ownerFilter === 'unassigned') setOwnerFilter('all'); }, [route.view, ownerFilter]);
  const selectedProject = state.projects.find(p => p.id === route.projectId);
  const missingProject = !!route.projectId && !selectedProject;
  const projectTasks = state.tasks.filter(t => !route.projectId || t.projectId === route.projectId);
  const projectOf = (task: Task) => state.projects.find(p => p.id === task.projectId)!;
  const filtered = projectTasks.filter(t => (ownerFilter === 'all' || t.ownerIds.includes(ownerFilter) || ownerFilter === 'unassigned' && !t.ownerIds.length) && `${t.title} ${t.description} ${projectOf(t)?.name} ${ownerNames(t.ownerIds)}`.toLowerCase().includes(search.toLowerCase()));
  const week = weekStart(date); const dates = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const liveTasks = scheduledTasks(state);
  const visibleLive = liveTasks.filter(t => (!route.projectId || t.projectId === route.projectId) && (ownerFilter === 'all' || t.ownerIds.includes(ownerFilter)) && `${t.title} ${projectOf(t)?.name} ${ownerNames(t.ownerIds)}`.toLowerCase().includes(search.toLowerCase()));
  const daySnapshots = MANAGERS.map(m => personDay(state, m.id, date));
  const freeCount = daySnapshots.filter(s => s.free).length;
  const overdue = projectTasks.filter(t => t.status !== 'done' && t.endDate < today());
  const prefix = route.projectId ? `/project/${route.projectId}` : '';
  const schedulePath = (day: string, taskId?: string) => `${prefix}/schedule?${new URLSearchParams({ date: day, ...(taskId ? { task: taskId } : {}) })}`;
  const viewPath = (view: 'board' | 'schedule') => view === 'schedule' ? `#${schedulePath(date)}` : `#${prefix}/board`;
  function changeDate(day: string) { setDate(day); history.replaceState(null, '', `#${schedulePath(day)}`); setRoute(currentRoute()); }
  function showSchedule(task: Task) { setOwnerFilter('all'); navigate(schedulePath(task.startDate, task.id)); }
  function NextAssignment({ ownerId, after }: { ownerId: string; after: string }) {
    const next = visibleLive.filter(t => t.ownerIds.includes(ownerId) && t.startDate > after).sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
    return next ? <button className="tw-next-assignment" onClick={() => showSchedule(next)} aria-label={`查看下一项排班 ${next.title}`}><CalendarDays size={13} /><span>下一项 {fmt(next.startDate)} · {next.title}</span><ArrowRight size={13} /></button> : null;
  }
  const openTask = (taskId?: string, ownerId?: string, taskDate?: string, status?: TaskStatus) => {
    setModal({ kind: 'task', taskId, ownerId, date: taskDate, status, projectId: selectedProject?.id });
  };
  const advance = (task: Task) => { if (task.status === 'review') { openTask(task.id); return; } const status = task.status === 'todo' ? 'doing' : 'review'; run({ type: 'setTaskStatus', payload: { id: task.id, status } }, status === 'doing' ? '任务已开始，卡片和排班已同步' : `已提交待核验，由老板记录结果`); };
  function TaskCard({ task }: { task: Task }) {
    const project = projectOf(task), late = task.status !== 'done' && task.endDate < today();
    return <article className="tw-task-card" data-status={task.status} data-task-id={task.id} style={{ '--project-color': project?.color } as CSSProperties}>
      <button className="tw-card-open" onClick={() => openTask(task.id)} aria-label={`打开任务 ${task.title}`}>
        <span className="tw-card-project"><i style={{ background: project?.color }} />{project?.name}</span>
        <h3 className="tw-card-title">{task.title}</h3>{task.description && <p className="tw-card-description">{task.description}</p>}
        <div className="tw-card-badges">{task.priority === 'high' && <span className="tw-pill high">优先处理</span>}{late && <span className="tw-pill overdue">已逾期</span>}{!task.ownerIds.length && <span className="tw-pill review">待分配</span>}</div>
        <div className="tw-card-dates"><CalendarDays size={13} /><span>{fmt(task.startDate)} — {fmt(task.endDate)}</span>{task.status === 'done' && <CheckCircle2 size={14} />}</div>
        <div className="tw-card-footer"><span className="tw-card-owners">{(task.ownerIds.length ? task.ownerIds : ['']).map(id => <span className="tw-person-name" key={id}><Avatar id={id} /><strong>{nameOf(id)}</strong></span>)}</span><span className="tw-card-contact">对接 · {contactNames(task.contactIds)}</span></div>
      </button>
      {task.status !== 'done' && project?.status !== 'done' && <div className="tw-card-actions">{task.ownerIds.length > 0 && <button className="tw-card-progress" aria-label={`查看排班 ${task.title}`} onClick={() => showSchedule(task)}><CalendarDays size={13} />查看排班</button>}<button className="tw-card-progress" aria-label={`${task.status === 'todo' ? '开始任务' : task.status === 'doing' ? '提交核验' : '处理核验'} ${task.title}`} onClick={() => advance(task)}>{task.status === 'todo' ? '开始任务' : task.status === 'doing' ? '提交核验' : '处理核验'}<ArrowRight size={13} /></button></div>}
    </article>;
  }
  function DayAvailability({ id }: { id: string }) { const s = personDay(state, id, date); return <span className={`tw-availability ${s.free ? 'free' : 'busy'}`}>{s.free ? '当天空闲' : `${s.tasks.length} 项任务${s.overlapping ? ' · 并行' : ''}`}</span>; }
  const displayedManagers = MANAGERS.filter(m => (ownerFilter === 'all' || ownerFilter === m.id) && (!freeOnly || personDay(state, m.id, date).free));
  function Schedule() {
    return <><div className="tw-date-toolbar"><div className="tw-date-control"><button className="tw-icon-button" aria-label="上一周" onClick={() => changeDate(addDays(date, -7))}><ArrowLeft size={17} /></button><strong className="tw-week-title">{week.slice(0, 4)} 年 · {fmt(week)} — {fmt(dates[6])}</strong><button className="tw-icon-button" aria-label="下一周" onClick={() => changeDate(addDays(date, 7))}><ArrowRight size={17} /></button><button className="tw-button small" onClick={() => changeDate(today())}>本周</button></div><label className="tw-date-control">查看某一天<input aria-label="查看日期" type="date" value={date} onChange={e => { if (validDate(e.target.value)) changeDate(e.target.value); }} /></label></div>
      <div className="tw-legend"><span><i className="todo" />待办</span><span><i className="doing" />进行中</span><span><i className="review" />待核验</span><label><input type="checkbox" checked={freeOnly} onChange={e => setFreeOnly(e.target.checked)} />仅看当天空闲</label></div>
      <div className="tw-note">{selectedProject ? '排班条仅显示本项目；人员忙闲按所有项目计算，避免漏掉其他安排。' : '每条排班对应一项未完成任务。选定日期没有任务安排即显示空闲；项目数量不等同于实际工时。'} 已完成任务保留在看板，不再占用排班。</div>
      {projectTasks.some(t => !t.ownerIds.length && t.status !== 'done') && <div className="tw-notice"><p>有 {projectTasks.filter(t => !t.ownerIds.length && t.status !== 'done').length} 项任务待分配负责人，暂未计入人员排班。</p><button className="tw-button ghost small" onClick={() => { navigate(`${prefix}/board`); setOwnerFilter('unassigned'); }}>去分配任务<ArrowRight size={14} /></button></div>}
      <div className="tw-schedule tw-desktop-schedule"><div className="tw-schedule-head"><div><Users size={15} />项目经理 <small>5 人</small></div>{dates.map((d, i) => <button key={d} className={`tw-day ${d === date ? 'selected' : ''} ${d === today() ? 'today' : ''}`} onClick={() => changeDate(d)} aria-label={`查看${d}排班`}><span>周{'一二三四五六日'[i]}</span><strong>{fmt(d)}</strong>{d === today() && <small>今天</small>}</button>)}</div>
        {displayedManagers.map(m => { const tasks = visibleLive.filter(t => t.ownerIds.includes(m.id) && t.startDate <= dates[6] && t.endDate >= week).sort((a, b) => a.startDate.localeCompare(b.startDate)); return <div className="tw-person-row" key={m.id} data-member-id={m.id}><div className="tw-person-info"><div className="tw-person-name"><Avatar id={m.id} /><strong>{m.name}</strong></div><DayAvailability id={m.id} /><small className="tw-next-free">{personDay(state, m.id, date).free ? '可安排新任务' : `最早空闲 ${fmt(nextFreeDate(state, m.id, date))}`}</small><button className="tw-button ghost small" onClick={() => openTask(undefined, m.id, date)} disabled={selectedProject?.status === 'done'}><Plus size={13} />安排任务</button></div><div className="tw-person-track" style={{ '--lanes': Math.max(tasks.length, 1) } as CSSProperties}>
          <div className="tw-grid-lines">{dates.map(d => <span key={d} className={d === date ? 'selected' : ''} />)}</div>
          {tasks.map((task, i) => { const first = Math.max(0, distance(task.startDate, week)), last = Math.min(6, distance(task.endDate, week)); return <button key={task.id} className="tw-task-bar" data-focused={route.taskId === task.id} data-status={task.status} data-task-id={task.id} aria-label={`调整任务 ${task.title}`} onClick={() => openTask(task.id)} style={{ gridColumn: `${first + 1} / span ${last - first + 1}`, gridRow: i + 1 }}><strong>{task.title}</strong><small>{projectOf(task)?.name} · {TASK_LABELS[task.status]}</small></button>; })}
          {!tasks.length && <div className="tw-track-empty" style={{ gridColumn: '1 / -1', gridRow: 1 }}><span>{selectedProject ? '本周暂无本项目任务' : '本周暂无任务安排'}</span><NextAssignment ownerId={m.id} after={dates[6]} /></div>}
          {dates.map((d, i) => <button key={d} className="tw-add-day" style={{ gridColumn: i + 1, gridRow: Math.max(tasks.length, 1) + 1 }} aria-label={`给${m.name}安排${d}任务`} disabled={selectedProject?.status === 'done'} onClick={() => openTask(undefined, m.id, d)}><Plus size={13} /></button>)}
        </div></div>; })}
        {!displayedManagers.length && <div className="tw-empty">当前筛选下没有项目经理。试试切换“全部负责人”或取消空闲筛选。</div>}
      </div>
      <div className="tw-mobile-schedule"><div className="tw-mobile-days">{dates.map((d, i) => <button key={d} className={`tw-day ${d === date ? 'selected' : ''}`} onClick={() => changeDate(d)} aria-label={`手机查看${d}排班`}><span>周{'一二三四五六日'[i]}</span><strong>{fmt(d)}</strong></button>)}</div>{displayedManagers.map(m => { const tasks = visibleLive.filter(t => t.ownerIds.includes(m.id) && t.startDate <= date && t.endDate >= date); return <article key={m.id} className="tw-mobile-person" data-member-id={m.id}><div className="tw-mobile-person-head"><div className="tw-person-name"><Avatar id={m.id} /><strong>{m.name}</strong></div><DayAvailability id={m.id} /></div>{tasks.map(task => <button className="tw-mobile-task" data-focused={route.taskId === task.id} data-status={task.status} data-task-id={task.id} key={task.id} aria-label={`调整任务 ${task.title}`} onClick={() => openTask(task.id)}><span className={`tw-pill ${task.status}`}>{TASK_LABELS[task.status]}</span><strong>{task.title}</strong><small>{projectOf(task)?.name} · {fmt(task.startDate)} — {fmt(task.endDate)}</small><ChevronRight size={15} /></button>)}{!tasks.length && <div><p className="tw-note">{personDay(state, m.id, date).free ? '当天没有任务安排' : '当天还有未在当前筛选中显示的任务'}</p><NextAssignment ownerId={m.id} after={date} /></div>}<button className="tw-button small" disabled={selectedProject?.status === 'done'} onClick={() => openTask(undefined, m.id, date)}><Plus size={14} />安排任务</button></article>; })}{!displayedManagers.length && <div className="tw-empty">当前筛选下没有项目经理。</div>}</div>
    </>;
  }

  return <div className="tw-app"><aside className="tw-sidebar"><a className="tw-brand" href="#/board"><Layers3 className="tw-brand-icon" size={30} /><span><strong>序间</strong><small>DESIGN WORKSPACE</small></span></a><div className="tw-sidebar-label">老板工作空间</div><nav className="tw-nav" aria-label="主要导航">{([{ id: 'board', label: '任务看板', icon: LayoutGrid }, { id: 'schedule', label: '人员排班', icon: CalendarDays }, { id: 'projects', label: '全部项目', icon: FolderKanban }] as const).map(n => <a key={n.id} className={`tw-nav-item ${!route.projectId && route.view === n.id ? 'active' : ''}`} href={`#/${n.id}`}><n.icon size={19} /><span>{n.label}</span>{n.id === 'board' && <small>{state.tasks.filter(t => t.status !== 'done').length}</small>}</a>)}</nav><div className="tw-sidebar-projects"><div className="tw-sidebar-label">正在推进<button aria-label="侧栏新建项目" onClick={() => setModal({ kind: 'project' })}><Plus size={16} /></button></div>{state.projects.filter(p => p.status !== 'done').slice(0, 8).map(p => <a href={`#/project/${p.id}/board`} key={p.id} className={`tw-sidebar-project ${p.id === route.projectId ? 'active' : ''}`}><i style={{ background: p.color }} /><span>{p.name}</span></a>)}</div><div className="tw-sidebar-bottom"><p>看清任务，也看清每个人的安排。</p><button onClick={() => setModal({ kind: 'help' })}><CircleHelp size={15} />使用说明</button><button onClick={() => setModal({ kind: 'reset' })}><RotateCcw size={15} />恢复示例数据</button><small>本地演示 · 项目为虚构示例</small></div></aside>
    <div className="tw-main"><header className="tw-topbar"><div className="tw-breadcrumb"><span>工作空间</span><ChevronRight size={13} /><strong>{selectedProject?.name || (route.view === 'board' ? '任务看板' : route.view === 'schedule' ? '人员排班' : '全部项目')}</strong></div><div className="tw-actions"><div className="tw-mobile-tools"><button className="tw-icon-button" aria-label="使用说明" onClick={() => setModal({ kind: 'help' })}><CircleHelp size={17} /></button><button className="tw-icon-button" aria-label="恢复示例数据" onClick={() => setModal({ kind: 'reset' })}><RotateCcw size={17} /></button></div><span className="tw-boss"><span>主</span>老板视角</span></div></header><main className="tw-content">
      {warning && <div className="tw-error" role="alert">{warning} 为保护原数据，当前暂停写入。可查看内容或通过“恢复示例数据”重新开始。</div>}
      {state.migrationNotice && <div className="tw-notice"><p>{state.migrationNotice}</p><button className="tw-button ghost small" onClick={() => run({ type: 'dismissMigration', payload: {} })}>已了解</button></div>}
      {missingProject ? <div className="tw-empty"><h1>未找到这个项目</h1><a className="tw-button" href="#/projects">返回全部项目</a></div> : <>
      <div className="tw-heading"><div><div className="tw-eyebrow">{selectedProject ? 'PROJECT WORKSPACE' : 'MAKE ROOM FOR GOOD WORK'}</div><h1>{selectedProject?.name || (route.view === 'board' ? '每一项工作，有序推进。' : route.view === 'schedule' ? '看清安排，从容分配。' : '把项目安排清楚。')}</h1><p>{selectedProject ? `${selectedProject.client || '客户待补充'}${selectedProject.location ? ` · ${selectedProject.location}` : ''}` : route.view === 'board' ? '从待办到完成，用任务卡片连接项目与人员排班。' : route.view === 'schedule' ? '五位项目经理，一张周表。点击任务即可修改安排。' : '记录项目、明确统筹人，再把工作分配到任务。'}</p></div><div className="tw-actions">{selectedProject ? <button className="tw-button" onClick={() => setModal({ kind: 'project', projectId: selectedProject.id })}><Pencil size={15} />项目信息</button> : <button className="tw-button" onClick={() => setModal({ kind: 'project' })}><Plus size={15} />新建项目</button>}{route.view !== 'projects' && <button className="tw-button primary" disabled={selectedProject?.status === 'done'} onClick={() => openTask()}><Plus size={17} />新建任务</button>}</div></div>
      {selectedProject && <div className="tw-project-banner"><div className="tw-project-facts"><span className={`tw-pill ${selectedProject.status === 'done' ? 'done' : 'doing'}`}>{PROJECT_LABELS[selectedProject.status]}</span><span><Avatar id={selectedProject.managerId} />统筹 · {nameOf(selectedProject.managerId)}</span><span><CalendarDays size={14} />{fmt(selectedProject.startDate)} — {fmt(selectedProject.endDate)}</span>{selectedProject.contact && <span>对接人 · {selectedProject.contact}</span>}</div>{selectedProject.note && <p>{selectedProject.note}</p>}</div>}
      {route.view !== 'projects' && <>
        <div className="tw-stats"><div className="tw-stat"><span>{selectedProject ? '项目任务' : '全部任务'}</span><strong>{projectTasks.length}<small>项</small></strong><small>{projectTasks.filter(t => t.status === 'done').length} 项已完成</small></div><div className="tw-stat"><span>正在进行</span><strong>{projectTasks.filter(t => t.status === 'doing').length}<small>项</small></strong><small>{projectTasks.filter(t => !t.ownerIds.length && t.status !== 'done').length} 项待分配负责人</small></div><div className="tw-stat"><span>等待核验</span><strong>{projectTasks.filter(t => t.status === 'review').length}<small>项</small></strong><small>{overdue.length ? `${overdue.length} 项未完成任务已逾期` : '完成前，再确认一次交付'}</small></div><div className="tw-stat"><span>{fmt(date)} 当天空闲</span><strong>{freeCount}<small>/ 5 人</small></strong><small>按全部项目的任务排班计算</small></div></div>
        <div className="tw-toolbar"><div className="tw-view-switch"><a href={viewPath('board')} className={route.view === 'board' ? 'active' : ''}><LayoutGrid size={16} />任务看板</a><a href={viewPath('schedule')} className={route.view === 'schedule' ? 'active' : ''}><CalendarDays size={16} />人员排班</a></div><label className="tw-search"><Search size={16} /><input aria-label="搜索任务" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索任务、项目或姓名" /></label><select className="tw-filter" aria-label="筛选负责人" value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)}><option value="all">全部负责人</option>{MANAGERS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}{route.view === 'board' && <option value="unassigned">待分配</option>}</select></div>
        {route.view === 'board' ? <><div className="tw-mobile-status">{statuses.map(s => <button key={s} className={mobileStatus === s ? 'active' : ''} onClick={() => setMobileStatus(s)}>{TASK_LABELS[s]} <b>{filtered.filter(t => t.status === s).length}</b></button>)}</div><div className="tw-board">{statuses.map(status => <section key={status} className={`tw-column ${status === mobileStatus ? 'tw-column-active' : ''}`} data-status={status} aria-label={`${TASK_LABELS[status]}任务列`}><header className="tw-column-head"><h2><i />{TASK_LABELS[status]}</h2><b>{filtered.filter(t => t.status === status).length}</b>{status !== 'done' && <button className="tw-icon-button" aria-label={`添加${TASK_LABELS[status]}任务`} disabled={selectedProject?.status === 'done'} onClick={() => openTask(undefined, undefined, undefined, status)}><Plus size={16} /></button>}</header><div className="tw-column-body">{filtered.filter(t => t.status === status).map(task => <TaskCard key={task.id} task={task} />)}{!filtered.some(t => t.status === status) && <div className="tw-empty">{status === 'done' ? '核验通过的任务会留在这里' : `暂无${TASK_LABELS[status]}任务`}</div>}{status !== 'done' && <button className="tw-add-card" disabled={selectedProject?.status === 'done'} onClick={() => openTask(undefined, undefined, undefined, status)}><Plus size={15} />添加任务</button>}</div></section>)}</div></> : <Schedule />}
      </>}
      {route.view === 'projects' && <><div className="tw-toolbar"><label className="tw-search"><Search size={16} /><input aria-label="搜索项目" placeholder="搜索项目、客户或经理" value={search} onChange={e => setSearch(e.target.value)} /></label><span className="tw-note">{state.projects.length} 个项目 · {state.projects.filter(p => p.status !== 'done').length} 个待推进</span></div><div className="tw-project-grid">{state.projects.filter(p => `${p.name} ${p.client} ${nameOf(p.managerId)}`.toLowerCase().includes(search.toLowerCase())).map(project => { const tasks = state.tasks.filter(t => t.projectId === project.id), done = tasks.filter(t => t.status === 'done').length; return <article key={project.id} className="tw-project-card" style={{ '--project-color': project.color } as CSSProperties}><div className="tw-project-card-head"><span className={`tw-pill ${project.status === 'done' ? 'done' : project.status === 'active' ? 'doing' : 'todo'}`}>{PROJECT_LABELS[project.status]}</span><button className="tw-icon-button" aria-label={`编辑项目 ${project.name}`} onClick={() => setModal({ kind: 'project', projectId: project.id })}><Pencil size={16} /></button></div><a href={`#/project/${project.id}/board`}><h2>{project.name}</h2><p>{project.client || '客户待补充'}</p></a><div className="tw-project-meta"><span className="tw-person-name"><Avatar id={project.managerId} /><strong>{nameOf(project.managerId)}</strong><small>项目经理</small></span><span><CalendarDays size={14} />{fmt(project.startDate)} — {fmt(project.endDate)}</span></div><div className="tw-project-progress"><div><span style={{ width: `${tasks.length ? done / tasks.length * 100 : 0}%` }} /></div><small>{done} / {tasks.length} 项任务已核验完成</small></div><div className="tw-project-card-footer"><a href={`#/project/${project.id}/board`}><LayoutGrid size={14} />任务看板</a><a href={`#/project/${project.id}/schedule`}><CalendarDays size={14} />项目排班<ArrowRight size={14} /></a></div></article>; })}</div>{!state.projects.some(p => `${p.name} ${p.client} ${nameOf(p.managerId)}`.toLowerCase().includes(search.toLowerCase())) && <div className="tw-empty">没有找到项目，试试其他关键词或新建项目。</div>}</>}
      </>}
      <footer className="tw-page-footer"><span>序间 · 任务与排班共用一份记录</span><span>数据保存在当前浏览器</span></footer>
    </main></div>
    {modal?.kind === 'task' && <TaskEditor key={modal.taskId || `new-${modal.projectId}-${modal.ownerId}-${modal.date}-${modal.status}`} state={state} modal={modal} run={run} onClose={() => setModal(null)} />}
    {modal?.kind === 'project' && <ProjectEditor state={state} projectId={modal.projectId} run={run} onClose={() => setModal(null)} onCreated={id => navigate(`/project/${id}/board`)} />}
    {modal?.kind === 'help' && <Dialog title="怎样使用任务与排班" onClose={() => setModal(null)}><div className="tw-modal-body tw-help"><h3>1. 建项目，分任务</h3><p>人员固定为成员一、成员二、成员三、成员四、成员五。项目经理负责统筹，每张任务卡可以安排多位负责人，记录对接人和起止日期。</p><h3>2. 看板与排班同步</h3><p>待办 → 进行中 → 待核验 → 已完成。任务未完成时，在计划日期内计入每位负责人的排班，共用一份任务进度；对接人负责沟通，不另算排班。老板记录核验，通过后释放所有负责人的安排，退回后保留意见并重新处理。</p><h3>3. 每个人哪天有空</h3><p>人员排班按周查看，也能点选一天。任务卡片的“查看排班”可直接定位到该任务的开始日期；空白周或空白日会提示下一项安排。选中的日期刷新后保留。空闲表示当天没有已登记的未完成任务，不能代替真实工时判断。重叠任务允许保留，由老板统筹。项目内的忙闲仍参考所有项目。</p><h3>4. 保存与恢复</h3><p>由老板根据沟通结果维护，暂时没有员工登录。数据只保存在当前浏览器，刷新后保留，不会自动跨设备共享。“恢复示例数据”会替换本版记录，历史版本存储独立保留。示例项目与任务均为虚构。</p></div><footer className="tw-modal-footer"><button className="tw-button primary" onClick={() => setModal(null)}>知道了</button></footer></Dialog>}
    {modal?.kind === 'reset' && <Dialog title="恢复示例数据" onClose={() => setModal(null)}><div className="tw-modal-body"><p>当前任务与项目将替换为示例，人员保持这五位项目经理，日期按今天重新生成。此前版本的存储保留。</p></div><footer className="tw-modal-footer"><button className="tw-button" onClick={() => setModal(null)}>取消</button><button className="tw-button primary" onClick={() => { try { const next = createSeed(); saveWorkbench(next); stateRef.current = next; setState(next); setWarning(''); warningRef.current = ''; setDate(today()); setSearch(''); setOwnerFilter('all'); setFreeOnly(false); setModal(null); navigate('/board'); notify('已恢复示例任务，五人排班已更新'); } catch (e) { notify((e as Error).message, true); } }}>确认恢复</button></footer></Dialog>}
    {toast && <div role={toast.error ? 'alert' : 'status'} className={`tw-toast ${toast.error ? 'error' : ''}`}><span>{toast.text}</span><button aria-label="关闭提示" onClick={() => setToast(null)}><X size={15} /></button></div>}
  </div>;
}
