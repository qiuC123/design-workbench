import { useCallback, useEffect, useRef, useState } from 'react';
import { createRecordId } from '../workspace/id';
import type { Command, WorkbenchState } from '../workspace/types';
import { asWebsiteError, websiteApi, WebsiteApiError, type AuthenticatedSession, type WorkspaceSnapshot } from './api';

export interface WebsiteWorkspaceService {
  state: WorkbenchState | null;
  revision: number;
  updatedAt: string;
  loading: boolean;
  pending: boolean;
  error: WebsiteApiError | null;
  refresh: () => Promise<boolean>;
  execute: (command: Command, expectedRevision?: number) => Promise<WorkspaceSnapshot>;
  importState: (state: WorkbenchState, expectedRevision?: number) => Promise<WorkspaceSnapshot>;
  restore: (backupId: string, expectedRevision?: number) => Promise<WorkspaceSnapshot>;
  clearError: () => void;
}

/** Both rendered data and a mutation's result must use the newest accepted revision. */
export function latestWorkspaceSnapshot(current: WorkspaceSnapshot | null, incoming: WorkspaceSnapshot): WorkspaceSnapshot {
  return current && current.revision >= incoming.revision ? current : incoming;
}

export function useWebsite(session: AuthenticatedSession, onUnauthorized: () => void): WebsiteWorkspaceService {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<WebsiteApiError | null>(null);
  const snapshotRef = useRef<WorkspaceSnapshot | null>(null);
  const pendingRef = useRef(false);
  const writeFailureRef = useRef(false);
  const lifecycle = useRef(0);
  const unauthorizedRef = useRef(onUnauthorized);
  unauthorizedRef.current = onUnauthorized;
  const retryRef = useRef<{ fingerprint: string; requestId: string; expectedRevision: number } | null>(null);

  const accept = useCallback((next: WorkspaceSnapshot) => {
    // A slow polling response must never replace a newer saved revision.
    const accepted = latestWorkspaceSnapshot(snapshotRef.current, next);
    if (accepted !== snapshotRef.current) {
      snapshotRef.current = accepted;
      setSnapshot(accepted);
    }
    return accepted;
  }, []);

  const refresh = useCallback(async () => {
    if (pendingRef.current) return false;
    const generation = lifecycle.current;
    try {
      const next = await websiteApi.workspace();
      if (lifecycle.current !== generation) return false;
      accept(next);
      // A background fetch should not dismiss a failed save or conflict message.
      if (!writeFailureRef.current) setError(null);
      return true;
    } catch (cause) {
      if (lifecycle.current !== generation) return false;
      const failure = asWebsiteError(cause);
      setError(previous => previous || failure);
      if (failure.status === 401) unauthorizedRef.current();
      return false;
    } finally {
      if (lifecycle.current === generation) setLoading(false);
    }
  }, [accept]);

  useEffect(() => {
    lifecycle.current += 1;
    snapshotRef.current = null;
    retryRef.current = null;
    writeFailureRef.current = false;
    setSnapshot(null);
    setLoading(true);
    setError(null);
    void refresh();
    const visibleRefresh = () => { if (document.visibilityState === 'visible') void refresh(); };
    const interval = window.setInterval(visibleRefresh, 10000);
    window.addEventListener('focus', visibleRefresh);
    document.addEventListener('visibilitychange', visibleRefresh);
    return () => {
      lifecycle.current += 1;
      clearInterval(interval);
      window.removeEventListener('focus', visibleRefresh);
      document.removeEventListener('visibilitychange', visibleRefresh);
    };
  }, [session.csrfToken, session.user.username, refresh]);

  const mutate = useCallback(async (fingerprint: string, perform: (revision: number, requestId: string) => Promise<WorkspaceSnapshot>, expectedRevision?: number) => {
    if (pendingRef.current) throw new WebsiteApiError('正在保存，请稍候。', 0, 'BUSY');
    if (!snapshotRef.current) throw new WebsiteApiError('项目数据尚未加载，请重试加载后再保存。', 0, 'NOT_READY');
    const generation = lifecycle.current;
    // If a response was lost, retry the same idempotent request instead of creating a duplicate project.
    const previous = retryRef.current;
    const operation = previous?.fingerprint === fingerprint ? previous : {
      fingerprint, requestId: createRecordId('request'), expectedRevision: expectedRevision ?? snapshotRef.current.revision,
    };
    pendingRef.current = true;
    setPending(true);
    writeFailureRef.current = false;
    setError(null);
    try {
      const next = await perform(operation.expectedRevision, operation.requestId);
      if (lifecycle.current === generation) {
        retryRef.current = null;
        // The caller must not render an older mutation response over a newer poll.
        return accept(next);
      }
      return next;
    } catch (cause) {
      const failure = asWebsiteError(cause);
      if (lifecycle.current === generation) {
        retryRef.current = failure.status === 0 && ['NETWORK_ERROR', 'TIMEOUT'].includes(failure.code) ? operation : null;
        writeFailureRef.current = true;
        setError(failure);
        if (failure.status === 401) unauthorizedRef.current();
        else if (failure.status === 409) {
          if (failure.workspace) accept(failure.workspace);
          else {
            try { const latest = await websiteApi.workspace(); if (lifecycle.current === generation) accept(latest); }
            catch { /* Keep the original conflict and the user's unsaved form. */ }
          }
        }
      }
      throw failure;
    } finally {
      pendingRef.current = false;
      if (lifecycle.current === generation) setPending(false);
    }
  }, [accept]);

  const execute = useCallback((command: Command, expectedRevision?: number) => mutate(JSON.stringify({ command, expectedRevision }), (revision, requestId) => websiteApi.execute(command, revision, requestId, session.csrfToken), expectedRevision), [mutate, session.csrfToken]);
  const importState = useCallback((state: WorkbenchState, expectedRevision?: number) => mutate(JSON.stringify({ import: state, expectedRevision }), (revision, requestId) => websiteApi.importState(state, revision, requestId, session.csrfToken), expectedRevision), [mutate, session.csrfToken]);
  const restore = useCallback((backupId: string, expectedRevision?: number) => mutate(JSON.stringify({ restore: backupId, expectedRevision }), (revision, requestId) => websiteApi.restore(backupId, revision, requestId, session.csrfToken), expectedRevision), [mutate, session.csrfToken]);
  const clearError = useCallback(() => { writeFailureRef.current = false; setError(null); }, []);
  return { state: snapshot?.state || null, revision: snapshot?.revision ?? -1, updatedAt: snapshot?.updatedAt || '', loading, pending, error, refresh, execute, importState, restore, clearError };
}
