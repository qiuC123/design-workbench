import type { Command, WorkbenchState } from '../workspace/types';

export interface WebsiteSession {
  initialized: boolean;
  authenticated: boolean;
  user?: { username: string };
  csrfToken?: string;
}
export interface AuthenticatedSession extends WebsiteSession {
  authenticated: true;
  user: { username: string };
  csrfToken: string;
}
export interface WorkspaceSnapshot {
  state: WorkbenchState;
  revision: number;
  updatedAt: string;
}
export interface WebsiteBackup {
  id: number;
  createdAt: string;
  projectCount: number;
  reason: string;
}

export class WebsiteApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly workspace?: WorkspaceSnapshot;

  constructor(message: string, status = 0, code = 'NETWORK_ERROR', workspace?: WorkspaceSnapshot) {
    super(message);
    this.name = 'WebsiteApiError';
    this.status = status;
    this.code = code;
    this.workspace = workspace;
  }
}

export function asWebsiteError(error: unknown): WebsiteApiError {
  return error instanceof WebsiteApiError ? error : new WebsiteApiError('无法连接网站，请检查网络后重试。');
}

interface RequestOptions { method?: 'GET' | 'POST'; body?: unknown; csrfToken?: string }

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(`/api/${path}`, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.csrfToken ? { 'X-CSRF-Token': options.csrfToken } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    let data: unknown;
    try { data = await response.json(); }
    catch {
      if (!response.ok) throw new WebsiteApiError('网站服务暂时不可用，请稍后重试。', response.status, 'SERVER_ERROR');
      throw new WebsiteApiError('网站返回的数据格式不正确，请刷新后重试。', response.status, 'INVALID_RESPONSE');
    }
    if (!response.ok) {
      const details = data as { error?: string; code?: string; workspace?: WorkspaceSnapshot };
      const incorrectCurrentPassword = path === 'password' && details?.code === 'PASSWORD';
      const message = response.status === 401 && path !== 'login' && !incorrectCurrentPassword ? '登录已失效，请重新登录。'
        : response.status === 409 && ['commands', 'import', 'restore'].includes(path) ? '数据已在其他页面更新，本次未保存。当前填写内容已保留，请关闭详情再重新打开核对最新记录，然后修改保存。'
        : typeof details?.error === 'string' && details.error.trim() ? details.error
        : response.status === 429 ? '操作太频繁，请稍等片刻再试。'
        : '操作未完成，请稍后重试。';
      throw new WebsiteApiError(message, response.status, details?.code || `HTTP_${response.status}`, details?.workspace);
    }
    return data as T;
  } catch (error) {
    if (error instanceof WebsiteApiError) throw error;
    if (controller.signal.aborted) throw new WebsiteApiError('请求超时，尚未确认是否保存成功。请检查网络后重试。', 0, 'TIMEOUT');
    throw asWebsiteError(error);
  } finally { clearTimeout(timeout); }
}

export const websiteApi = {
  session: () => request<WebsiteSession>('session'),
  setup: (input: { token: string; username: string; password: string }) => request<WebsiteSession>('setup', { method: 'POST', body: input }),
  login: (input: { username: string; password: string }) => request<WebsiteSession>('login', { method: 'POST', body: input }),
  logout: (csrfToken: string) => request<WebsiteSession>('logout', { method: 'POST', csrfToken }),
  changePassword: (input: { currentPassword: string; newPassword: string }, csrfToken: string) => request<WebsiteSession>('password', { method: 'POST', csrfToken, body: input }),
  workspace: () => request<WorkspaceSnapshot>('workspace'),
  execute: (command: Command, expectedRevision: number, requestId: string, csrfToken: string) => request<WorkspaceSnapshot>('commands', { method: 'POST', csrfToken, body: { command, expectedRevision, requestId } }),
  importState: (state: WorkbenchState, expectedRevision: number, requestId: string, csrfToken: string) => request<WorkspaceSnapshot>('import', { method: 'POST', csrfToken, body: { state, expectedRevision, requestId } }),
  restore: (backupId: string, expectedRevision: number, requestId: string, csrfToken: string) => request<WorkspaceSnapshot>('restore', { method: 'POST', csrfToken, body: { backupId, expectedRevision, requestId } }),
  getBackups: () => request<{ backups: WebsiteBackup[] }>('backups'),
  exportState: () => request<WorkspaceSnapshot>('export'),
};
