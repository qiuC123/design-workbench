import Workbench from '../workspace/Workbench';
import WebsiteGate from './WebsiteGate';
import { useWebsite } from './useWebsite';
import type { AuthenticatedSession } from './api';

function ConnectedWorkbench({ session, onUnauthorized }: { session: AuthenticatedSession; onUnauthorized: () => void }) {
  const service = useWebsite(session, onUnauthorized);
  if (!service.state) return <div className="website-gate"><div className="website-auth-card"><h1>序间</h1><p>{service.error?.message || '正在读取项目和排班…'}</p>{service.error && <button className="tw-button primary" onClick={() => { void service.refresh(); }}>重新连接</button>}</div></div>;
  return <Workbench remote={{ ...service, state: service.state, session, onUnauthorized }} />;
}

export default function WebsiteWorkspace() {
  return <WebsiteGate>{(session, onUnauthorized) => <ConnectedWorkbench session={session} onUnauthorized={onUnauthorized} />}</WebsiteGate>;
}
