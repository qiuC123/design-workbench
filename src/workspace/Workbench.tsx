import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Building2, CalendarDays, Check, CheckCircle2, ChevronRight, CircleHelp, LayoutGrid, Layers3, Pencil, Plus, RotateCcw, Search, Trash2, Users, X } from 'lucide-react';
import type { Command, Company, Contact, Project, ProjectInput, ProjectStatus, WorkbenchState } from './types';
import { MANAGERS, PROJECT_LABELS, today, validDate, execute, scheduledProjects, personDay, overlapProjects, findCompanyByName } from './model';
import { loadWorkbench, saveWorkbench, STORAGE_KEY } from './storage';
import { createSeed } from './seed';
import { IS_TRIAL, IS_WEBSITE } from './runtime';
import type { WebsiteConnection } from '../website/connection';
import DataPanel from '../website/DataPanel';
import ScheduleTimeline from './ScheduleTimeline';
import { CompanyPicker } from './CompanyPicker';
import '../board/board.css';
import './workspace.css';

const statuses: ProjectStatus[] = ['todo', 'doing', 'review', 'done'];
const fmt = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
const timeFmt = (at: string) => new Date(at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const nameOf = (id: string) => MANAGERS.find(m => m.id === id)?.name || '待分配';
const norm = (name: string) => name.trim().toLowerCase();
type View = 'board' | 'schedule' | 'companies';
function currentRoute(): { view: View; companyId?: string; date?: string; focusId?: string } {
  const [path, query] = (location.hash.slice(1) || ((IS_TRIAL || IS_WEBSITE) && window.matchMedia('(max-width: 640px)').matches ? '/schedule' : '/board')).split('?');
  const parts = path.split('/'), params = new URLSearchParams(query), day = params.get('date') || '';
  const selection = { date: validDate(day) ? day : undefined, focusId: params.get('project') || params.get('task') || undefined };
  if (parts[1] === 'company') return { ...selection, companyId: parts[2], view: parts[3] === 'schedule' ? 'schedule' : 'board' };
  return { ...selection, view: parts[1] === 'companies' || parts[1] === 'projects' ? 'companies' : parts[1] === 'schedule' || parts[3] === 'schedule' ? 'schedule' : 'board' };
}
type Modal = ({ kind: 'project'; id?: string; companyId?: string; ownerId?: string; date?: string; status?: ProjectStatus } | { kind: 'company'; id?: string } | { kind: 'contacts'; companyId: string } | { kind: 'help' | 'reset' | 'data' }) & { revision?: number; instance?: number };
type Run = (command: Command, feedback?: string, onError?: (message: string) => void) => Promise<WorkbenchState | undefined>;
function Avatar({ id }: { id: string }) { return <span aria-hidden="true" className="tw-avatar" style={{ background: MANAGERS.find(m => m.id === id)?.color || '#73847b' }}>{id ? nameOf(id).slice(-2) : '?'}</span>; }
function Field({ label, children, full = false }: { label: string; children: ReactNode; full?: boolean }) { return <label className={`tw-field ${full ? 'tw-span-2' : ''}`}><span>{label}</span>{children}</label>; }
function Dialog({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null), closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; ref.current?.querySelector<HTMLElement>('button,input,select,textarea')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key !== 'Tab') return;
      const all = [...(ref.current?.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href]') || [])].filter(el => !el.matches(':disabled') && el.getClientRects().length);
      if (e.shiftKey && document.activeElement === all[0]) { e.preventDefault(); all.at(-1)?.focus(); }
      else if (!e.shiftKey && document.activeElement === all.at(-1)) { e.preventDefault(); all[0]?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  return <div className="tw-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={ref} className={`tw-modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header className="tw-modal-head"><div><span className="tw-eyebrow">序间 · 项目安排</span><h2>{title}</h2></div><button className="tw-icon-button" aria-label="关闭窗口" onClick={onClose}><X size={20} /></button></header>{children}</div></div>;
}
function Owners({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const [expanded, setExpanded] = useState(false);
  return <fieldset aria-label="负责人" className="tw-owner-picker tw-span-2"><legend>负责人 <small>本公司成员 · 可多选</small></legend><div className="tw-owner-selection">{value.map(id => <span className="tw-owner-chip" key={id}><Avatar id={id} />{nameOf(id)}<button type="button" aria-label={`移除负责人 ${nameOf(id)}`} onClick={() => onChange(value.filter(item => item !== id))}><X size={13} /></button></span>)}{!value.length && <span className="tw-owner-placeholder">待分配</span>}<button type="button" className="tw-owner-add" aria-expanded={expanded} aria-controls="project-owner-options" onClick={() => setExpanded(!expanded)}><Plus size={14} />{expanded ? '收起选择' : '添加负责人'}</button></div>{expanded && <div className="tw-owner-options" id="project-owner-options">{MANAGERS.map(m => <label key={m.id} className={value.includes(m.id) ? 'selected' : ''}><input type="checkbox" name="ownerIds" value={m.id} checked={value.includes(m.id)} onChange={e => onChange(e.target.checked ? [...value, m.id] : value.filter(id => id !== m.id))} /><Avatar id={m.id} /><span>{m.name}</span></label>)}</div>}</fieldset>;
}

function ProjectEditor({ state, modal, run, onClose }: { state: WorkbenchState; modal: Extract<Modal, { kind: 'project' }>; run: Run; onClose: () => void }) {
  const project = state.projects.find(p => p.id === modal.id);
  const [companyName, setCompanyName] = useState(state.companies.find(c => c.id === (project?.companyId || modal.companyId))?.name || '');
  const [draft, setDraft] = useState<Omit<ProjectInput, 'companyId'>>({ title: project?.title || '', description: project?.description || '', ownerIds: project?.ownerIds || (modal.ownerId ? [modal.ownerId] : []), contactIds: project?.contactIds || [], startDate: project?.startDate || modal.date || today(), endDate: project?.endDate || modal.date || today(), status: project?.status || modal.status || 'todo', priority: project?.priority || 'normal' });
  const [newNames, setNewNames] = useState<string[]>([]), [contactName, setContactName] = useState(''), [contactOpen, setContactOpen] = useState(false);
  const [error, setError] = useState(''), [companyChanged, setCompanyChanged] = useState(false), [note, setNote] = useState(''), [deleting, setDeleting] = useState(false), [saving, setSaving] = useState(false);
  const company = findCompanyByName(state, companyName);
  const contacts = state.contacts.filter(c => c.companyId === company?.id && (c.active || draft.contactIds.includes(c.id)));
  const rangeValid = validDate(draft.startDate) && validDate(draft.endDate) && draft.startDate <= draft.endDate;
  const overlaps = rangeValid ? draft.ownerIds.map(id => ({ id, projects: overlapProjects(state, id, draft.startDate, draft.endDate, project?.id) })).filter(item => item.projects.length) : [];
  const set = <K extends keyof Omit<ProjectInput, 'companyId'>>(key: K, value: ProjectInput[K]) => { setDraft(d => ({ ...d, [key]: value })); setError(''); };
  function changeCompany(name: string) {
    const nextCompany = findCompanyByName(state, name);
    if ((company?.id || norm(companyName)) !== (nextCompany?.id || norm(name))) {
      if (draft.contactIds.length || newNames.length) setCompanyChanged(true);
      set('contactIds', []); setNewNames([]); setContactName('');
    }
    setCompanyName(name); setError('');
  }
  function addContact() {
    const name = contactName.trim(); if (!name) return;
    if (!companyName.trim()) { setError('请先填写所属公司，再添加这家公司的对接人。'); return; }
    const existing = state.contacts.find(c => c.companyId === company?.id && norm(c.name) === norm(name));
    if (existing) {
      if (!existing.active && !draft.contactIds.includes(existing.id)) { setError('这位对接人已停用，请到客户公司中恢复后选择。'); return; }
      set('contactIds', [...new Set([...draft.contactIds, existing.id])]);
    } else if (!newNames.some(item => norm(item) === norm(name))) setNewNames([...newNames, name]);
    setContactName(''); setError('');
  }
  const perform = async (command: Command, feedback: string) => { if (saving) return; setSaving(true); try { if (await run(command, feedback, setError)) onClose(); } finally { setSaving(false); } };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (contactName.trim()) { setError('对接人姓名还未加入名单，请先点击“加入对接人”，或清空输入。'); return; }
    perform({ type: 'saveProject', payload: { id: project?.id, companyName, project: draft, newContactNames: newNames } }, project ? '项目已保存，看板与排班已同步' : '项目已创建，并同步到负责人排班');
  };
  const review = (approved: boolean) => { if (!project) return; if (!approved && !note.trim()) { setError('退回修改时，请填写核验意见。'); return; } perform({ type: 'reviewProject', payload: { id: project.id, approved, note } }, approved ? '项目已完成，所有负责人排班已释放' : '已退回进行中，意见已记录'); };
  return <Dialog title={project ? '项目详情' : '新建项目'} wide onClose={onClose}><div className="tw-modal-body"><div className="tw-task-editor"><form id="project-card-form" className="tw-form" onSubmit={submit}><div className="tw-form-grid">
    <Field label="项目名称" full><input name="title" required maxLength={100} value={draft.title} placeholder="例如：香氛空间" onChange={e => set('title', e.target.value)} /></Field>
    <CompanyPicker companies={state.companies} value={companyName} onChange={changeCompany} />
    <p className="tw-note tw-span-2">{company ? `对接人从${company.name}的联系人中选择。` : companyName.trim() ? `保存时建立“${companyName.trim()}”公司，并保存下方新对接人。` : '暂未确定客户公司，可先安排项目，之后补充归属。'}</p>
    <Owners value={draft.ownerIds} onChange={ids => set('ownerIds', ids)} />
    <fieldset aria-label="对接人" className="tw-owner-picker tw-span-2"><legend>对接人 <small>客户公司联系人 · 可多选</small></legend><div className="tw-owner-selection">{draft.contactIds.map(id => { const c = state.contacts.find(item => item.id === id); return <span className="tw-owner-chip" key={id}>{c?.name || '历史联系人'}{c && !c.active && <small>已停用</small>}<button type="button" aria-label={`移除对接人 ${c?.name}`} onClick={() => set('contactIds', draft.contactIds.filter(item => item !== id))}><X size={13} /></button></span>; })}{newNames.map(name => <span className="tw-owner-chip" key={name}>{name}<small>新建</small><button type="button" aria-label={`移除对接人 ${name}`} onClick={() => setNewNames(newNames.filter(item => item !== name))}><X size={13} /></button></span>)}{!draft.contactIds.length && !newNames.length && <span className="tw-owner-placeholder">待添加</span>}<button type="button" className="tw-owner-add" disabled={!companyName.trim()} aria-expanded={contactOpen} aria-controls="customer-contact-options" onClick={() => setContactOpen(!contactOpen)}><Plus size={14} />{contactOpen ? '收起选择' : '添加对接人'}</button></div>
      {contactOpen && <div className="cw-contact-picker" id="customer-contact-options">{contacts.length > 0 ? <div className="tw-owner-options">{contacts.map(c => <label key={c.id} className={draft.contactIds.includes(c.id) ? 'selected' : ''}><input type="checkbox" name="contactIds" value={c.id} checked={draft.contactIds.includes(c.id)} disabled={!c.active && !draft.contactIds.includes(c.id)} onChange={e => set('contactIds', e.target.checked ? [...draft.contactIds, c.id] : draft.contactIds.filter(id => id !== c.id))} /><span>{c.name}{!c.active && '（已停用）'}</span></label>)}</div> : <p className="tw-note">这家公司还没有可用对接人，可在下方添加。</p>}<div className="cw-contact-add"><label className="tw-field"><span>新对接人姓名</span><input name="newContactName" maxLength={60} value={contactName} onChange={e => setContactName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addContact(); } }} placeholder="输入该公司的联系人姓名" /></label><button type="button" className="tw-button small" disabled={!contactName.trim()} onClick={addContact}><Plus size={14} />加入对接人</button></div><p className="tw-note">新姓名随项目保存，之后可在同公司其他项目中复用。</p></div>}
      {companyChanged && <p className="tw-note cw-company-changed">所属公司已变更，请重新选择这家公司的对接人。</p>}
    </fieldset>
    <Field label="计划开始"><input name="startDate" type="date" required value={draft.startDate} onChange={e => set('startDate', e.target.value)} /></Field><Field label="计划结束"><input name="endDate" type="date" required value={draft.endDate} onChange={e => set('endDate', e.target.value)} /></Field>
    <Field label="项目状态"><select name="status" value={draft.status} onChange={e => set('status', e.target.value as ProjectStatus)}>{statuses.filter(s => s !== 'done' || project?.status === 'done').map(s => <option key={s} value={s}>{PROJECT_LABELS[s]}</option>)}</select></Field><Field label="优先级"><select name="priority" value={draft.priority} onChange={e => set('priority', e.target.value as ProjectInput['priority'])}><option value="normal">常规安排</option><option value="high">优先处理</option></select></Field>
    <Field label="项目说明" full><textarea name="description" rows={4} value={draft.description} placeholder="工作内容、交付要求和沟通结果…" onChange={e => set('description', e.target.value)} /></Field>
  </div><p className="tw-note">这组日期就是项目计划，直接用于每位负责人的排班。</p>{!rangeValid ? <div className="tw-conflict">请填写有效日期，结束不能早于开始。</div> : overlaps.length > 0 ? <div className="tw-conflict tw-overlap-warning">{overlaps.map(item => <div key={item.id}><strong>{nameOf(item.id)}同期另有 {item.projects.length} 个项目</strong><p>{item.projects.map(p => p.title).join('、')}</p></div>)}<small>仅提醒，可以并行安排并直接保存，由老板判断工作量。</small></div> : draft.ownerIds.length > 0 && <p className="tw-note"><Check size={13} /> 所选负责人同期没有其他未完成项目。</p>}{error && <p className="tw-error" role="alert">{error}</p>}</form>
  <aside className="tw-task-aside"><div><h3>内部负责人</h3>{draft.ownerIds.length ? draft.ownerIds.map(id => <div className="tw-person-name" key={id}><Avatar id={id} /><strong>{nameOf(id)}</strong><span>负责执行</span></div>) : <p className="tw-note">待分配</p>}<p className="tw-note">多人共用同一项目进度和排期。客户对接人只用于沟通，不计入内部排班。</p></div>
    {project?.status === 'review' && <div className="tw-review-box"><h3>核验这个项目</h3><p>老板根据沟通结果记录。</p><Field label="核验意见"><textarea name="note" value={note} onChange={e => setNote(e.target.value)} placeholder="退回时请写清修改内容" /></Field><div className="tw-actions"><button type="button" className="tw-button primary small" onClick={() => review(true)}>核验通过</button><button type="button" className="tw-button small" onClick={() => review(false)}>退回修改</button></div><small>修改项目资料请先保存，再记录核验结果。</small></div>}
    {project?.completedAt && <p className="tw-note">实际完成：{timeFmt(project.completedAt)}</p>}{project?.legacyNote && <details className="cw-legacy"><summary>迁入前的资料</summary><p>{project.legacyNote}</p></details>}
    {project && <div><h3>项目记录</h3><ol className="tw-activity">{state.activities.filter(a => a.projectId === project.id).slice(0, 15).map(a => <li key={a.id}><time>{timeFmt(a.at)}</time><p>{a.text}</p></li>)}</ol></div>}
  </aside></div></div><footer className="tw-modal-footer">{project && <button type="button" className="tw-button ghost danger" onClick={() => setDeleting(!deleting)}><Trash2 size={15} />删除项目</button>}{deleting ? <div className="tw-confirm"><span>删除此卡片并释放对应排班？</span><button className="tw-button danger" onClick={() => perform({ type: 'deleteProject', payload: { id: project!.id } }, '项目已删除，对应排班已释放')}>确认删除</button></div> : <div className="tw-actions"><button className="tw-button" onClick={onClose}>关闭</button><button className="tw-button primary" form="project-card-form" type="submit" disabled={saving}>{saving ? '正在保存…' : project ? '保存修改' : '创建项目'}</button></div>}</footer></Dialog>;
}

function CompanyEditor({ state, id, run, onClose }: { state: WorkbenchState; id?: string; run: Run; onClose: () => void }) {
  const company = state.companies.find(c => c.id === id), [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const fd = new FormData(event.currentTarget); if (await run({ type: 'saveCompany', payload: { id, changes: { name: String(fd.get('name')), note: String(fd.get('note')) } } }, '客户公司已保存', setError)) onClose(); }
  return <Dialog title={company ? '公司资料' : '新建公司'} onClose={onClose}><div className="tw-modal-body"><form id="company-form" className="tw-form-grid" onSubmit={submit}><Field label="公司名称" full><input name="name" required maxLength={100} defaultValue={company?.name} placeholder="客户公司名称" /></Field><Field label="公司备注" full><textarea name="note" defaultValue={company?.note} placeholder="公司全称、合作说明等" /></Field>{error && <p role="alert" className="tw-error tw-span-2">{error}</p>}<p className="tw-note tw-span-2">公司用于归类项目和客户联系人。项目排期在每张项目卡片中安排。</p></form></div><footer className="tw-modal-footer"><button className="tw-button" onClick={onClose}>关闭</button><button className="tw-button primary" form="company-form" type="submit">保存公司</button></footer></Dialog>;
}
function ContactManager({ state, companyId, run, onClose }: { state: WorkbenchState; companyId: string; run: Run; onClose: () => void }) {
  const company = state.companies.find(c => c.id === companyId)!;
  const [editing, setEditing] = useState<string>(), [name, setName] = useState(''), [note, setNote] = useState(''), [error, setError] = useState('');
  const contacts = state.contacts.filter(c => c.companyId === companyId);
  const clear = () => { setEditing(undefined); setName(''); setNote(''); setError(''); };
  async function save(event: FormEvent) { event.preventDefault(); const active = contacts.find(c => c.id === editing)?.active ?? true; if (await run({ type: 'saveContact', payload: { id: editing, changes: { companyId, name, note, active } } }, editing ? '客户对接人已更新' : '客户对接人已添加', setError)) clear(); }
  function toggle(contact: Contact) { run({ type: 'saveContact', payload: { id: contact.id, changes: { ...contact, active: !contact.active } } }, contact.active ? '已停用，新项目不再选择；历史引用保留' : '已恢复对接人', setError); }
  return <Dialog title={`${company.name} · 对接人`} onClose={onClose}><div className="tw-modal-body"><p className="tw-note">这里只维护该公司的客户联系人，与本公司固定负责人分开。</p><div className="cw-contact-list">{contacts.map(c => <div className="cw-contact-row" key={c.id}><div><strong>{c.name}</strong>{!c.active && <span className="tw-pill">已停用</span>}<p>{c.note || '暂无备注'}</p></div><div className="tw-actions"><button className="tw-button small" aria-label={`编辑对接人 ${c.name}`} onClick={() => { setEditing(c.id); setName(c.name); setNote(c.note); setError(''); }}>编辑</button><button className="tw-button small" aria-label={`${c.active ? '停用' : '恢复'}对接人 ${c.name}`} onClick={() => toggle(c)}>{c.active ? '停用' : '恢复'}</button></div></div>)}{!contacts.length && <div className="tw-empty">尚未添加这家公司的对接人</div>}</div><form id="contact-form" className="tw-form-grid cw-contact-form" onSubmit={save}><h3 className="tw-span-2">{editing ? '编辑对接人' : '添加对接人'}</h3><Field label="联系人姓名" full><input name="contactName" required maxLength={60} value={name} onChange={e => setName(e.target.value)} /></Field><Field label="联系人备注" full><input name="contactNote" maxLength={200} value={note} placeholder="例如：市场部 / 联系方式（选填）" onChange={e => setNote(e.target.value)} /></Field>{error && <p role="alert" className="tw-error tw-span-2">{error}</p>}<div className="tw-actions tw-span-2">{editing && <button type="button" className="tw-button" onClick={clear}>取消编辑</button>}<button type="submit" className="tw-button primary">{editing ? '保存联系人' : '添加联系人'}</button></div></form></div><footer className="tw-modal-footer"><button className="tw-button" onClick={onClose}>关闭</button></footer></Dialog>;
}

export default function Workbench({ remote }: { remote?: WebsiteConnection } = {}) {
  const [initial] = useState(() => remote ? { state: remote.state, warning: '' } : loadWorkbench()), [state, setState] = useState(initial.state), stateRef = useRef(state);
  const [warning, setWarning] = useState(initial.warning || ''), warningRef = useRef(warning);
  const [route, setRoute] = useState(currentRoute), [date, setDate] = useState(() => currentRoute().date || today());
  const [search, setSearch] = useState(''), [ownerFilter, setOwnerFilter] = useState('all'), [freeOnly, setFreeOnly] = useState(false), [mobileStatus, setMobileStatus] = useState<ProjectStatus>('todo');
  const [modal, updateModal] = useState<Modal | null>(null), [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const savingRef = useRef(false);
  const modalSequence = useRef(0);
  const setModal = (next: Modal | null) => updateModal(next ? { ...next, revision: remote?.revision, instance: ++modalSequence.current } : null);
  const closeEditor = () => updateModal(current => current?.instance === modal?.instance ? null : current);
  useEffect(() => { if (remote) { stateRef.current = remote.state; setState(remote.state); } }, [remote?.state]);
  const notify = (text: string, error = false) => setToast({ text, error });
  const run: Run = async (command, feedback, onError) => {
    if (savingRef.current) return undefined;
    savingRef.current = true;
    try { if (warningRef.current) throw new Error(warningRef.current);
      let next: WorkbenchState;
      if (remote) { const saved = await remote.execute(command, modal?.revision); next = saved.state; updateModal(previous => previous && previous.instance === modal?.instance ? { ...previous, revision: saved.revision } : previous); }
      else { next = execute(stateRef.current, command); saveWorkbench(next); }
      stateRef.current = next; setState(next); if (feedback) notify(feedback); return next; }
    catch (e) { const message = e instanceof Error ? e.message : '操作未能保存'; if (onError) { setToast(null); onError(message); } else notify(message, true); return undefined; }
    finally { savingRef.current = false; }
  };
  function navigate(path: string) { location.hash = path; const next = currentRoute(); setRoute(next); if (next.date) setDate(next.date); setSearch(''); setFreeOnly(false); if (!next.focusId) window.scrollTo({ top: 0, behavior: 'instant' }); }
  useEffect(() => {
    const hash = () => { const next = currentRoute(); setRoute(next); if (next.view === 'schedule') setDate(next.date || today()); if (next.focusId) setOwnerFilter('all'); setSearch(''); setFreeOnly(false); };
    const sync = (event: StorageEvent) => { if (event.key === STORAGE_KEY || event.key === null) { const loaded = loadWorkbench(); stateRef.current = loaded.state; setState(loaded.state); setWarning(loaded.warning || ''); warningRef.current = loaded.warning || ''; setModal(null); notify(loaded.warning || '已同步另一个页面的项目修改', !!loaded.warning); } };
    window.addEventListener('hashchange', hash); if (!remote) window.addEventListener('storage', sync);
    return () => { window.removeEventListener('hashchange', hash); window.removeEventListener('storage', sync); };
  }, []);
  useEffect(() => { if (!toast) return; const timeout = setTimeout(() => setToast(null), toast.error ? 10000 : 4500); return () => clearTimeout(timeout); }, [toast]);
  useEffect(() => { if (route.view === 'schedule' && ownerFilter === 'unassigned') setOwnerFilter('all'); }, [route.view, ownerFilter]);
  useEffect(() => {
    if (route.view !== 'schedule' || !route.focusId) return;
    const frame = requestAnimationFrame(() => [...document.querySelectorAll<HTMLElement>('[data-task-id]')].find(el => el.dataset.taskId === route.focusId && el.getClientRects().length)?.scrollIntoView({ block: 'center', behavior: 'instant' }));
    return () => cancelAnimationFrame(frame);
  }, [route, date]);
  const selectedCompany = state.companies.find(c => c.id === route.companyId);
  const companyLabel = (project: Project) => state.companies.find(c => c.id === project.companyId)?.name || '待确认公司';
  const contactLabel = (project: Project) => project.contactIds.map(id => state.contacts.find(c => c.id === id)?.name || '历史联系人').join('、') || '待添加';
  const inScope = (project: Project) => !route.companyId || project.companyId === (route.companyId === 'unassigned' ? '' : route.companyId);
  const scopeProjects = state.projects.filter(inScope);
  const matches = (project: Project) => `${project.title} ${project.description} ${companyLabel(project)} ${project.ownerIds.map(nameOf).join(' ')} ${contactLabel(project)}`.toLowerCase().includes(search.toLowerCase());
  const filtered = scopeProjects.filter(p => matches(p) && (ownerFilter === 'all' || p.ownerIds.includes(ownerFilter) || ownerFilter === 'unassigned' && !p.ownerIds.length));
  const visibleLive = scheduledProjects(state).filter(p => inScope(p) && matches(p) && (ownerFilter === 'all' || p.ownerIds.includes(ownerFilter)));
  const freeCount = MANAGERS.filter(m => personDay(state, m.id, date).free).length;
  const scopeTitle = selectedCompany?.name || (route.companyId === 'unassigned' ? '待确认公司' : '');
  const prefix = route.companyId ? `/company/${route.companyId}` : '';
  const schedulePath = (day: string, id?: string) => `${prefix}/schedule?${new URLSearchParams({ date: day, ...(id ? { project: id } : {}) })}`;
  const viewPath = (view: 'board' | 'schedule') => view === 'schedule' ? `#${schedulePath(date)}` : `#${prefix}/board`;
  function changeDate(day: string) { setDate(day); history.replaceState(null, '', `#${schedulePath(day)}`); setRoute(currentRoute()); }
  function showSchedule(project: Project) { setOwnerFilter('all'); navigate(schedulePath(project.startDate, project.id)); }
  function openProject(id?: string, ownerId?: string, planDate?: string, status?: ProjectStatus) { setModal({ kind: 'project', id, ownerId, date: planDate, status, companyId: selectedCompany?.id }); }
  function advance(project: Project) { if (project.status === 'review') { openProject(project.id); return; } const status = project.status === 'todo' ? 'doing' : 'review'; run({ type: 'setProjectStatus', payload: { id: project.id, status } }, status === 'doing' ? '项目已开始，看板与排班已同步' : '已提交待核验，由老板记录结果'); }
  function ProjectCard({ project }: { project: Project }) {
    const late = project.status !== 'done' && project.endDate < today();
    return <article className="tw-task-card" data-status={project.status} data-task-id={project.id}><button className="tw-card-open" onClick={() => openProject(project.id)} aria-label={`打开项目 ${project.title}`}><span className="tw-card-project"><Building2 size={12} />{companyLabel(project)}</span><h3 className="tw-card-title">{project.title}</h3>{project.description && <p className="tw-card-description">{project.description}</p>}<div className="tw-card-badges">{project.priority === 'high' && <span className="tw-pill high">优先处理</span>}{late && <span className="tw-pill overdue">已逾期</span>}{!project.ownerIds.length && <span className="tw-pill review">待分配</span>}</div><div className="tw-card-dates"><CalendarDays size={13} /><span>{fmt(project.startDate)} — {fmt(project.endDate)}</span>{project.status === 'done' && <CheckCircle2 size={14} />}</div><div className="tw-card-footer"><span className="tw-card-owners">{(project.ownerIds.length ? project.ownerIds : ['']).map(id => <span className="tw-person-name" key={id}><Avatar id={id} /><strong>{nameOf(id)}</strong></span>)}</span><span className="tw-card-contact">对接 · {contactLabel(project)}</span></div></button>{project.status !== 'done' && <div className="tw-card-actions">{project.ownerIds.length > 0 && <button className="tw-card-progress" aria-label={`查看排班 ${project.title}`} onClick={() => showSchedule(project)}><CalendarDays size={13} />查看排班</button>}<button className="tw-card-progress" aria-label={`${project.status === 'todo' ? '开始项目' : project.status === 'doing' ? '提交核验' : '处理核验'} ${project.title}`} onClick={() => advance(project)}>{project.status === 'todo' ? '开始项目' : project.status === 'doing' ? '提交核验' : '处理核验'}<ArrowRight size={13} /></button></div>}</article>;
  }
  const pending = state.projects.filter(p => !p.companyId).length;
  const companyLink = (c: Company) => `#/company/${c.id}/board`;
  const pageName = scopeTitle || (route.view === 'companies' ? '客户公司' : route.view === 'schedule' ? '人员排班' : '项目看板');
  return <div className="tw-app"><aside className="tw-sidebar"><a className="tw-brand" href="#/board"><Layers3 className="tw-brand-icon" size={30} /><span><strong>序间</strong><small>DESIGN WORKSPACE</small></span></a><div className="tw-sidebar-label">老板工作空间</div><nav className="tw-nav" aria-label="主要导航">{([{ id: 'board', label: '项目看板', icon: LayoutGrid }, { id: 'schedule', label: '人员排班', icon: CalendarDays }, { id: 'companies', label: '客户公司', icon: Building2 }] as const).map(n => <a key={n.id} className={`tw-nav-item ${!route.companyId && route.view === n.id ? 'active' : ''}`} href={`#/${n.id}`}><n.icon size={19} /><span>{n.label}</span>{n.id === 'board' && <small>{state.projects.filter(p => p.status !== 'done').length}</small>}</a>)}</nav><div className="tw-sidebar-projects"><div className="tw-sidebar-label">按客户公司<button aria-label="侧栏新建公司" onClick={() => setModal({ kind: 'company' })}><Plus size={16} /></button></div>{state.companies.map(c => <a key={c.id} href={companyLink(c)} className={`tw-sidebar-project ${c.id === route.companyId ? 'active' : ''}`}><Building2 size={13} /><span>{c.name}</span></a>)}{pending > 0 && <a className={`tw-sidebar-project ${route.companyId === 'unassigned' ? 'active' : ''}`} href="#/company/unassigned/board"><span>待确认公司</span><small>{pending}</small></a>}</div><div className="tw-sidebar-bottom"><p>看清项目，也看清每个人的安排。</p><button onClick={() => setModal({ kind: 'help' })}><CircleHelp size={15} />使用说明</button><button onClick={() => setModal({ kind: 'data' })}><Building2 size={15} />{remote ? '数据与账号' : '导出原有数据'}</button>{!remote && <button onClick={() => setModal({ kind: 'reset' })}><RotateCcw size={15} />恢复示例数据</button>}<small>{remote ? '网站版 · 数据统一保存在服务器' : '本地演示 · 数据保存在当前浏览器'}</small></div></aside>
    <div className="tw-main"><header className="tw-topbar"><div className="tw-breadcrumb"><span>工作空间</span><ChevronRight size={13} /><strong>{pageName}</strong></div><div className="tw-actions"><div className="tw-mobile-tools"><button className="tw-icon-button" aria-label="使用说明" onClick={() => setModal({ kind: 'help' })}><CircleHelp size={17} /></button><button className="tw-icon-button" aria-label={remote ? '数据与账号' : '导出原有数据'} onClick={() => setModal({ kind: 'data' })}><Building2 size={17} /></button>{!remote && <button className="tw-icon-button" aria-label="恢复示例数据" onClick={() => setModal({ kind: 'reset' })}><RotateCcw size={17} /></button>}</div><span className="tw-boss"><span>主</span>{remote?.session.user?.username || '老板视角'}</span></div></header><main className="tw-content">
    {remote && <div className="website-sync" role="status"><span>{remote.pending ? '正在保存到服务器…' : remote.error ? '连接需要检查' : '已连接 · 自动同步'}</span><button className="tw-button ghost small" disabled={remote.pending} onClick={() => { void remote.refresh(); }}>刷新数据</button><small>最近更新 {timeFmt(remote.updatedAt)}</small></div>}{remote?.error && <div className="tw-error" role="alert">{remote.error.message}</div>}
    {IS_TRIAL && <div className="cw-trial-notice"><strong>手机与钉钉试用 · 示例数据</strong><p>可以试着安排和修改项目。记录只保存在当前设备，不与电脑工作版同步。</p></div>}
    {warning && <div className="tw-error" role="alert">{warning} 当前暂停写入，原始数据保留。</div>}{state.migrationNotice && <div className="tw-notice"><p>{state.migrationNotice}</p><button className="tw-button ghost small" onClick={() => run({ type: 'dismissMigration', payload: {} })}>已了解</button></div>}
    <div className="tw-heading"><div><div className="tw-eyebrow">{route.companyId ? 'CLIENT WORKSPACE' : 'MAKE ROOM FOR GOOD WORK'}</div><h1>{scopeTitle || (route.view === 'schedule' ? '看清安排，从容分配。' : route.view === 'companies' ? '公司与对接人，一处管理。' : '每一个项目，有序推进。')}</h1><p>{route.companyId ? '查看该公司的项目与排班，统一维护客户对接人。' : route.view === 'companies' ? '客户联系人按公司归类，内部负责人保持固定。' : '一张卡片就是一个项目，项目计划直接同步到负责人排班。'}</p></div><div className="tw-actions">{selectedCompany && <><button className="tw-button" onClick={() => setModal({ kind: 'company', id: selectedCompany.id })}><Pencil size={15} />公司资料</button><button className="tw-button" onClick={() => setModal({ kind: 'contacts', companyId: selectedCompany.id })}><Users size={15} />管理对接人</button></>}{route.view === 'companies' ? <button className="tw-button primary" onClick={() => setModal({ kind: 'company' })}><Plus size={16} />新建公司</button> : <button className="tw-button primary" onClick={() => openProject()}><Plus size={16} />新建项目</button>}</div></div>
    {selectedCompany?.note && <div className="tw-project-banner"><p>{selectedCompany.note}</p></div>}
    {route.view !== 'companies' ? <>
      <div className="tw-stats"><div className="tw-stat"><span>{route.companyId ? '公司项目' : '全部项目'}</span><strong>{scopeProjects.length}<small>个</small></strong><small>{scopeProjects.filter(p => p.status === 'done').length} 个已完成</small></div><div className="tw-stat"><span>正在进行</span><strong>{scopeProjects.filter(p => p.status === 'doing').length}<small>个</small></strong><small>{scopeProjects.filter(p => !p.ownerIds.length && p.status !== 'done').length} 个待分配负责人</small></div><div className="tw-stat"><span>等待核验</span><strong>{scopeProjects.filter(p => p.status === 'review').length}<small>个</small></strong><small>老板根据沟通结果记录</small></div><div className="tw-stat"><span>{fmt(date)} 当天空闲</span><strong>{freeCount}<small>/ 5 人</small></strong><small>按全部客户项目计算</small></div></div>
      <div className="tw-toolbar"><div className="tw-view-switch"><a href={viewPath('board')} className={route.view === 'board' ? 'active' : ''}><LayoutGrid size={16} />项目看板</a><a href={viewPath('schedule')} className={route.view === 'schedule' ? 'active' : ''}><CalendarDays size={16} />人员排班</a></div><label className="tw-search"><Search size={16} /><input aria-label="搜索项目" placeholder="搜索项目、公司或姓名" value={search} onChange={e => setSearch(e.target.value)} /></label><select className="tw-filter" aria-label="筛选负责人" value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)}><option value="all">全部负责人</option>{MANAGERS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}{route.view === 'board' && <option value="unassigned">待分配</option>}</select></div>
      {route.view === 'board' ? <><div className="tw-mobile-status">{statuses.map(s => <button key={s} className={mobileStatus === s ? 'active' : ''} onClick={() => setMobileStatus(s)}>{PROJECT_LABELS[s]} <b>{filtered.filter(p => p.status === s).length}</b></button>)}</div><div className="tw-board">{statuses.map(status => <section key={status} className={`tw-column ${status === mobileStatus ? 'tw-column-active' : ''}`} data-status={status} aria-label={`${PROJECT_LABELS[status]}项目列`}><header className="tw-column-head"><h2><i />{PROJECT_LABELS[status]}</h2><b>{filtered.filter(p => p.status === status).length}</b>{status !== 'done' && <button className="tw-icon-button" aria-label={`添加${PROJECT_LABELS[status]}项目`} onClick={() => openProject(undefined, undefined, undefined, status)}><Plus size={16} /></button>}</header><div className="tw-column-body">{filtered.filter(p => p.status === status).map(project => <ProjectCard key={project.id} project={project} />)}{!filtered.some(p => p.status === status) && <div className="tw-empty">暂无{PROJECT_LABELS[status]}项目</div>}{status !== 'done' && <button className="tw-add-card" onClick={() => openProject(undefined, undefined, undefined, status)}><Plus size={15} />添加项目</button>}</div></section>)}</div></> : <ScheduleTimeline state={state} date={date} ownerFilter={ownerFilter} freeOnly={freeOnly} companyScoped={!!route.companyId} scopeProjects={scopeProjects} visibleProjects={visibleLive} focusId={route.focusId} onDateChange={changeDate} onFreeOnlyChange={setFreeOnly} onOpenProject={openProject} onShowProject={showSchedule} companyLabel={companyLabel} onUnassigned={() => { navigate(`${prefix}/board`); setOwnerFilter('unassigned'); }} />}
    </> : <><div className="tw-toolbar"><label className="tw-search"><Search size={16} /><input aria-label="搜索公司" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索公司名称" /></label><span className="tw-note">{state.companies.length} 家公司 · {state.contacts.filter(c => c.active).length} 位客户对接人</span></div><div className="tw-project-grid">{state.companies.filter(c => norm(c.name).includes(norm(search))).map(c => { const projects = state.projects.filter(p => p.companyId === c.id), contacts = state.contacts.filter(item => item.companyId === c.id && item.active); return <article className="tw-project-card" key={c.id}><div className="tw-project-card-head"><span className="tw-pill doing">客户公司</span><button className="tw-icon-button" aria-label={`编辑公司 ${c.name}`} onClick={() => setModal({ kind: 'company', id: c.id })}><Pencil size={16} /></button></div><a href={companyLink(c)}><h2>{c.name}</h2><p>{c.note || '公司备注待补充'}</p></a><div className="cw-company-counts"><strong>{projects.length} 个项目</strong><span>{projects.filter(p => p.status !== 'done').length} 个待推进</span></div><div className="cw-company-contacts"><small>客户对接人</small><p>{contacts.length ? contacts.map(item => item.name).join('、') : '尚未添加'}</p></div><div className="tw-project-card-footer"><a href={companyLink(c)}><LayoutGrid size={14} />查看项目</a><button className="tw-button ghost small" aria-label={`管理对接人 ${c.name}`} onClick={() => setModal({ kind: 'contacts', companyId: c.id })}>管理对接人<ChevronRight size={14} /></button></div></article>; })}{pending > 0 && <article className="tw-project-card"><span className="tw-pill review">待补充</span><a href="#/company/unassigned/board"><h2>待确认公司</h2><p>{pending} 个迁入项目还需指定所属客户公司。</p></a><div className="tw-project-card-footer"><a href="#/company/unassigned/board">去确认归属<ArrowRight size={14} /></a></div></article>}</div></>}
    <footer className="tw-page-footer"><span>序间 · 项目与排班共用一份记录</span><span>{remote ? '数据保存在服务器 · 每 10 秒同步' : '数据保存在当前浏览器'}</span></footer></main></div>
    {modal?.kind === 'project' && <ProjectEditor key={modal.instance} state={state} modal={modal} run={run} onClose={closeEditor} />}{modal?.kind === 'company' && <CompanyEditor key={modal.instance} state={state} id={modal.id} run={run} onClose={closeEditor} />}{modal?.kind === 'contacts' && state.companies.some(c => c.id === modal.companyId) && <ContactManager key={modal.instance} state={state} companyId={modal.companyId} run={run} onClose={closeEditor} />}
    {modal?.kind === 'help' && <Dialog title="怎样使用项目与排班" onClose={() => setModal(null)}><div className="tw-modal-body tw-help"><h3>1. 一张卡片就是一个项目</h3><p>填写项目名称、所属客户公司、内部负责人和客户对接人。项目起止日期就是排班依据，只有这一组计划日期。</p><h3>2. 公司与联系人</h3><p>DemoA、示例乙、示例丙、示例丁已建立。公司名称可搜索复用或自定义。客户对接人按公司维护，可在项目内添加并多选，也可到客户公司页改名、备注或停用。切公司后需重新选择对应联系人。</p><h3>3. 固定内部人员与项目进度</h3><p>成员一、成员二、成员三、成员四、成员五可共同负责项目。未完成项目按计划日期显示在每人的排班中，对接人不占排班。待办、进行中、待核验、已完成，由老板记录进度和核验。并行允许保存，是否安排由老板决定。</p><h3>4. 保存与旧数据</h3><p>{remote ? '当前为网站版，登录后读取服务器上的同一份项目。保存成功后电脑和手机会自动同步；网络失败保留表单并提示，不会假装保存成功。若其他页面已修改，请关闭详情后重新打开核对。数据与账号中可以导出、导入和恢复历史备份。' : '当前为本地原型，刷新保留，同一浏览器页面同步。通过“导出原有数据”下载记录，再登录网站导入。旧版本存储完整保留，不会自动上传。'}</p></div><footer className="tw-modal-footer"><button className="tw-button primary" onClick={() => setModal(null)}>知道了</button></footer></Dialog>}
    {modal?.kind === 'data' && <Dialog title={remote ? '数据与账号' : '导出原有数据'} onClose={() => setModal(null)} wide><DataPanel state={state} remote={remote} onClose={() => setModal(null)} /></Dialog>}
    {!remote && modal?.kind === 'reset' && <Dialog title="恢复示例数据" onClose={() => setModal(null)}><div className="tw-modal-body"><p>将当前公司、客户联系人和项目替换为示例。旧版本存储保留，负责人仍为固定五人。</p></div><footer className="tw-modal-footer"><button className="tw-button" onClick={() => setModal(null)}>取消</button><button className="tw-button primary" onClick={() => { try { const next = createSeed(); saveWorkbench(next); stateRef.current = next; setState(next); warningRef.current = ''; setWarning(''); setModal(null); setSearch(''); setOwnerFilter('all'); setFreeOnly(false); navigate('/board'); notify('已恢复示例公司与项目'); } catch (e) { notify((e as Error).message, true); } }}>确认恢复</button></footer></Dialog>}
    {toast && <div role={toast.error ? 'alert' : 'status'} className={`tw-toast ${toast.error ? 'error' : ''}`}><span>{toast.text}</span><button aria-label="关闭提示" onClick={() => setToast(null)}><X size={15} /></button></div>}
  </div>;
}
