export type Stage = 'intake' | 'design' | 'sample' | 'prebuild' | 'acceptance' | 'onsite' | 'done';
export type TaskStatus = 'todo' | 'doing' | 'review' | 'done';
export type ArtifactKind = 'drawing' | 'sample' | 'prebuild' | 'acceptance' | 'onsite';
export interface Member { id: string; name: string; role: string; color: string; active: boolean }
export interface Contact { id: string; name: string; company: string; external: boolean }
export interface Project {
  id: string; code: string; name: string; client: string; contactId: string;
  managerId: string; drafterId: string; leadId: string;
  drawingConfirmerId: string; sampleConfirmerId: string; clientConfirmerId: string;
  handlerId: string; stage: Stage; dueDate: string; plannedDate: string; location: string;
  description: string; blockedReason: string; executionDrawingId?: string;
  sampleSkippedReason?: string; completedAt?: string; createdAt: string;
}
export interface Task {
  id: string; projectId: string; title: string; ownerId: string; collaboratorIds: string[];
  status: TaskStatus; dueDate: string; blockedReason: string; completedAt?: string; issueId?: string;
}
export interface Artifact {
  id: string; projectId: string; kind: ArtifactKind; title: string; version: string; url: string;
  notes: string; status: 'pending' | 'confirmed' | 'rejected'; confirmerId: string;
  createdAt: string; confirmedAt?: string;
}
export interface Handoff {
  id: string; projectId: string; fromId: string; toId: string; artifactId: string; dueDate: string;
  note: string; status: 'pending' | 'accepted' | 'returned'; createdAt: string; acceptedAt?: string;
}
export interface Issue {
  id: string; projectId: string; title: string; ownerId: string;
  status: 'open' | 'fixing' | 'awaiting' | 'closed'; taskId: string; createdAt: string;
  resolvedAt?: string; confirmationNote?: string;
}
export interface Activity { id: string; projectId: string; text: string; actorId: string; at: string }
export interface State {
  schemaVersion: number; seedDate: string; currentMemberId: string;
  members: Member[]; contacts: Contact[]; projects: Project[]; tasks: Task[];
  artifacts: Artifact[]; handoffs: Handoff[]; issues: Issue[]; activities: Activity[];
}
export type ProjectInput = Omit<Project, 'id' | 'code' | 'handlerId' | 'stage' | 'createdAt' | 'executionDrawingId' | 'sampleSkippedReason' | 'completedAt'>;
export type TaskInput = Omit<Task, 'id' | 'status' | 'completedAt' | 'issueId'>;
export type Command =
  | { type: 'createProject'; payload: ProjectInput }
  | { type: 'editProject'; payload: { projectId: string; changes: Partial<ProjectInput> } }
  | { type: 'addTask'; payload: TaskInput }
  | { type: 'updateTask'; payload: { taskId: string; status?: TaskStatus; ownerId?: string; collaboratorIds?: string[]; dueDate?: string; blockedReason?: string } }
  | { type: 'addArtifact'; payload: { projectId: string; kind: ArtifactKind; title: string; version: string; url: string; notes: string; confirmerId: string } }
  | { type: 'confirmArtifact'; payload: { artifactId: string; accepted: boolean; note: string } }
  | { type: 'createHandoff'; payload: { projectId: string; artifactId: string; toId: string; dueDate: string; note: string } }
  | { type: 'acceptHandoff'; payload: { handoffId: string; accepted: boolean; note: string } }
  | { type: 'skipSample'; payload: { projectId: string; reason: string } }
  | { type: 'recordMilestone'; payload: { projectId: string; kind: 'prebuild' | 'acceptance' | 'onsite'; accepted: boolean; notes: string; title: string; url: string } }
  | { type: 'createIssue'; payload: { projectId: string; title: string; ownerId: string; dueDate: string } }
  | { type: 'reconfirmIssue'; payload: { issueId: string; accepted: boolean; note: string } }
  | { type: 'toggleMember'; payload: { memberId: string } }
  | { type: 'switchMember'; payload: { memberId: string } }
  | { type: 'addContact'; payload: Omit<Contact, 'id'> };
