import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, CalendarDays, LoaderCircle, LockKeyhole, RefreshCw } from 'lucide-react';
import { asWebsiteError, websiteApi, WebsiteApiError, type AuthenticatedSession, type WebsiteSession } from './api';
import './website.css';

export interface WebsiteGateProps {
  children: (session: AuthenticatedSession, onUnauthorized: () => void) => ReactNode;
}

export function WebsiteGate({ children }: WebsiteGateProps) {
  const [session, setSession] = useState<WebsiteSession | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [token, setToken] = useState('');
  const [expired, setExpired] = useState(false);
  const requestSequence = useRef(0);
  const submittingRef = useRef(false);

  const loadSession = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setChecking(true); setError('');
    try { const next = await websiteApi.session(); if (sequence === requestSequence.current) setSession(next); }
    catch (cause) { if (sequence === requestSequence.current) setError(asWebsiteError(cause).message); }
    finally { if (sequence === requestSequence.current) setChecking(false); }
  }, []);
  useEffect(() => { void loadSession(); }, [loadSession]);

  const onUnauthorized = useCallback(() => {
    requestSequence.current += 1;
    setSession({ initialized: true, authenticated: false });
    setPassword(''); setConfirmation(''); setExpired(true); setError('');
  }, []);

  if (session?.authenticated && session.user && session.csrfToken) {
    return children(session as AuthenticatedSession, onUnauthorized);
  }
  const setup = session !== null && !session.initialized;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submittingRef.current || checking) return;
    if (setup && password !== confirmation) { setError('两次输入的密码不一致。'); return; }
    requestSequence.current += 1;
    submittingRef.current = true;
    setPending(true); setError('');
    try {
      const next = setup
        ? await websiteApi.setup({ token: token.trim(), username: username.trim(), password })
        : await websiteApi.login({ username: username.trim(), password });
      if (!next.authenticated || !next.user || !next.csrfToken) throw new WebsiteApiError('登录信息不完整，请刷新后重试。', 200, 'INVALID_RESPONSE');
      setSession(next); setExpired(false); setPassword(''); setConfirmation(''); setToken('');
    } catch (cause) { setError(asWebsiteError(cause).message); }
    finally { submittingRef.current = false; setPending(false); }
  }

  return <main className="website-gate">
    <section className="website-auth-card" aria-labelledby="website-auth-title">
      <div className="website-brand"><span><CalendarDays size={23} /></span><strong>序间</strong><small>项目安排与人员排班</small></div>
      {checking ? <div className="website-auth-loading" role="status"><LoaderCircle className="website-spin" size={22} /><p>正在连接工作台…</p></div>
        : !session ? <div className="website-auth-loading"><h1 id="website-auth-title">暂时无法连接</h1><p role="alert">{error}</p><button className="website-primary" onClick={() => void loadSession()}><RefreshCw size={16} />重新连接</button></div>
          : <>
            <div className="website-auth-heading"><LockKeyhole size={19} /><h1 id="website-auth-title">{setup ? '创建你的管理账号' : '登录项目工作台'}</h1></div>
            <p className="website-auth-intro">{setup ? '完成首次设置，即可在电脑和手机管理同一份项目安排。' : '查看项目进展，安排每一位负责人的时间。'}</p>
            {expired && <p className="website-auth-notice" role="status">登录已失效，请重新登录后继续。</p>}
            <form className="website-auth-form" onSubmit={submit}>
              {setup && <label>初始化口令<input name="setup-token" autoComplete="off" type="password" value={token} onChange={e => setToken(e.target.value)} required disabled={pending} /><small>使用网站启动时提供的一次性口令。</small></label>}
              <label>账号<input name="username" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} maxLength={64} required disabled={pending} placeholder="输入管理账号" /></label>
              <label>密码<input name="password" autoComplete={setup ? 'new-password' : 'current-password'} type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={setup ? 10 : undefined} maxLength={128} required disabled={pending} placeholder={setup ? '至少 10 位密码' : '输入密码'} /></label>
              {setup && <label>确认密码<input name="confirm-password" autoComplete="new-password" type="password" value={confirmation} onChange={e => setConfirmation(e.target.value)} minLength={10} maxLength={128} required disabled={pending} placeholder="再次输入密码" /></label>}
              {error && <p className="website-auth-error" role="alert">{error}</p>}
              <button className="website-primary" type="submit" disabled={pending}>{pending ? <><LoaderCircle size={17} className="website-spin" />{setup ? '正在创建…' : '正在登录…'}</> : <>{setup ? '创建账号并进入' : '登录'}<ArrowRight size={17} /></>}</button>
            </form>
            <p className="website-auth-footer">网站版 · 项目统一保存，电脑与手机同步</p>
          </>}
    </section>
  </main>;
}

export default WebsiteGate;
