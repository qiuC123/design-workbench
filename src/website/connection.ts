import type { Command, WorkbenchState } from '../workspace/types';
import type { WebsiteSession, WorkspaceSnapshot } from './api';

export interface WebsiteConnection {
  state: WorkbenchState;
  revision: number;
  updatedAt: string;
  pending: boolean;
  error: { message: string } | null;
  session: WebsiteSession;
  execute: (command: Command, expectedRevision?: number) => Promise<WorkspaceSnapshot>;
  importState: (state: WorkbenchState, expectedRevision?: number) => Promise<WorkspaceSnapshot>;
  restore: (id: string, expectedRevision?: number) => Promise<WorkspaceSnapshot>;
  refresh: () => Promise<boolean>;
  onUnauthorized: () => void;
}
