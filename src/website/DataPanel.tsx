import { useEffect, useState, type FormEvent } from 'react';
import type { WorkbenchState } from '../workspace/types';
import { validateState } from '../workspace/storage';
import { websiteApi, type WebsiteBackup } from './api';
import type { WebsiteConnection } from './connection';
import './data-panel.css';

function download(value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url;
  link.download = `序间项目备份-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
const dateLabel = (at: string) => new Date(at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
function reasonLabel(reason: string) {
  if (reason.includes('import')) return '导入前';
  if (reason.includes('restore')) return '恢复前';
  if (reason.includes('delete')) return '删除前';
  return '修改前';
}

export default function DataPanel({ state, remote, onClose }: { state: WorkbenchState; remote?: WebsiteConnection; onClose: () => void }) {
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState<WorkbenchState | null>(null), [fileName, setFileName] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [revision, setRevision] = useState(remote?.revision || 0), [backups, setBackups] = useState<WebsiteBackup[]>([]), [restoreId, setRestoreId] = useState('');
  const [currentPassword, setCurrentPassword] = useState(''), [newPassword, setNewPassword] = useState(''), [confirmPassword, setConfirmPassword] = useState('');
  async function listBackups() { const result = await websiteApi.getBackups(); setBackups(result.backups); }
  useEffect(() => { if (remote) void listBackups().catch(e => setError(e.message)); }, []);
  async function perform(action: () => Promise<void>) {
    if (busy || remote?.pending) return; setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : '操作失败，请重试'); } finally { setBusy(false); }
  }
  async function chooseFile(file?: File) {
    setCandidate(null); setConfirmed(false); setError(''); setMessage(''); setRestoreId('');
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error('备份文件超过 5MB，请检查是否选择了序间 JSON 备份。');
      const data: unknown = JSON.parse(await file.text());
      const value = data && typeof data === 'object' && 'state' in data ? data.state : data;
      const next = validateState(value); setCandidate(next); setFileName(file.name); setRevision(remote!.revision);
    } catch (e) { setError(`文件未导入：${e instanceof Error ? e.message : '格式无效'}`); }
  }
  async function importFile() {
    if (!remote || !candidate || !confirmed) return;
    await perform(async () => { const saved = await remote.importState(candidate, revision); setRevision(saved.revision); setCandidate(null); setConfirmed(false); setMessage('导入成功，电脑和手机读取同一份记录。原服务器数据已留备份。'); await listBackups(); });
  }
  async function changePassword(event: FormEvent) {
    event.preventDefault(); if (!remote) return;
    if (newPassword !== confirmPassword) { setError('两次新密码不一致'); return; }
    await perform(async () => {
      const session = await websiteApi.changePassword({ currentPassword, newPassword }, remote.session.csrfToken!);
      if (!('csrfToken' in session) || !session.csrfToken) throw new Error('密码已修改，请刷新页面确认登录状态。');
      await websiteApi.logout(session.csrfToken); remote.onUnauthorized();
    });
  }
  return <>
    <div className="tw-modal-body website-data">
      <section><h3>{remote ? '保存与备份' : '把原有数据带到网站'}</h3>
        <p>{remote ? '项目、公司和客户对接人统一保存在服务器。每次修改前自动保留快照，最近 30 份可以恢复。' : '先下载当前浏览器中的项目备份，再到网站的“数据与账号”选择文件导入。下载不会改变或清空这里的记录。'}</p>
        <div className="website-counts"><span><strong>{state.projects.length}</strong> 个项目</span><span><strong>{state.companies.length}</strong> 家公司</span><span><strong>{state.contacts.length}</strong> 位对接人</span></div>
        <button className="tw-button primary" disabled={busy} onClick={() => void perform(async () => { const data = remote ? await websiteApi.exportState() : { state, exportedAt: new Date().toISOString() }; download(data); setMessage('已生成备份下载，请保存好这个 JSON 文件。'); })}>下载完整数据备份</button>
      </section>
      {remote && <>
        <section><h3>导入已有项目</h3><p>选择从旧工作台或网站下载的 JSON 备份。确认导入后会替换网站当前记录，替换前自动备份。</p>
          <label className="tw-field"><span>选择序间备份文件</span><input type="file" accept=".json,application/json" disabled={busy || remote.pending} onChange={e => void chooseFile(e.target.files?.[0])} /></label>
          {candidate && <div className="website-import-preview"><strong>{fileName}</strong><p>将导入 {candidate.projects.length} 个项目、{candidate.companies.length} 家公司、{candidate.contacts.length} 位对接人。</p><p>网站现有 {state.projects.length} 个项目会被替换。</p><label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />我已核对，使用这份备份替换网站数据</label><button className="tw-button primary" disabled={!confirmed || busy || remote.pending} onClick={() => void importFile()}>确认导入</button></div>}
        </section>
        <section><h3>恢复历史备份</h3><p>每份备份对应当时完整的工作台记录。恢复前，当前记录也会再备份。</p>
          <label className="tw-field"><span>选择备份时间</span><select disabled={busy || remote.pending} value={restoreId} onChange={e => { setRestoreId(e.target.value); setRevision(remote.revision); setCandidate(null); }}><option value="">请选择要恢复的备份</option>{backups.map(backup => <option key={backup.id} value={backup.id}>{dateLabel(backup.createdAt)} · {backup.projectCount} 个项目 · {reasonLabel(backup.reason)}</option>)}</select></label>
          {!backups.length && <p className="tw-note">还没有历史备份，第一次保存后会自动生成。</p>}
          {restoreId && <div className="website-import-preview"><p>将把网站整体恢复到所选时间，当前所有设备随后会同步。</p><button className="tw-button" disabled={busy || remote.pending} onClick={() => void perform(async () => { const saved = await remote.restore(restoreId, revision); setRevision(saved.revision); setRestoreId(''); setMessage('已恢复所选备份。'); await listBackups(); })}>确认恢复这份备份</button></div>}
        </section>
        <section><h3>账号管理</h3><p>当前账号：{remote.session.user?.username}。修改密码后需重新登录。</p><form className="tw-form-grid" onSubmit={changePassword}>
          <label className="tw-field tw-span-2"><span>当前密码</span><input type="password" autoComplete="current-password" required value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} /></label>
          <label className="tw-field"><span>新密码（至少 10 位）</span><input type="password" autoComplete="new-password" minLength={10} maxLength={128} required value={newPassword} onChange={e => setNewPassword(e.target.value)} /></label>
          <label className="tw-field"><span>再次输入新密码</span><input type="password" autoComplete="new-password" minLength={10} maxLength={128} required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></label>
          <button className="tw-button" type="submit" disabled={busy || remote.pending}>修改密码</button>
        </form><button className="tw-button ghost" disabled={busy || remote.pending} onClick={() => void perform(async () => { await websiteApi.logout(remote.session.csrfToken!); remote.onUnauthorized(); })}>退出登录</button></section>
      </>}
      {error && <p className="tw-error" role="alert">{error}</p>}{message && <p className="tw-notice" role="status">{message}</p>}
      {(busy || remote?.pending) && <p role="status">正在处理，请稍候…</p>}
    </div><footer className="tw-modal-footer"><button className="tw-button" onClick={onClose} disabled={busy || remote?.pending}>关闭</button></footer>
  </>;
}
