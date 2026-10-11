export type TaskStatus = 'todo' | 'doing' | 'review' | 'done';
export type ProjectStatus = 'planned' | 'active' | 'done';
export type Priority = 'normal' | 'high';
export interface Manager { id: string; name: string; color: string }
export interface Project {
  id: string; name: string; client: string; contact: string; location: string;
  startDate: string; endDate: string; managerId: string; status: ProjectStatus;
  note: string; color: string; createdAt: string; updatedAt: string; completedAt?: string;
}
export interface Task {
  id: string; projectId: string; title: string; description: string;
  ownerIds: string[]; contactIds: string[]; startDate: string; endDate: string;
  status: TaskStatus; priority: Priority; createdAt: string; updatedAt: string;
  completedAt?: string;
}
export interface Activity { id: string; projectId: string; taskId?: string; text: string; at: string }
export interface WorkbenchState {
  version: 3; projects: Project[]; tasks: Task[]; activities: Activity[];
  migrationNotice?: string;
  seedProjectNamesRevision?: 1;
}
export type ProjectInput = Pick<Project, 'name' | 'client' | 'contact' | 'location' | 'startDate' | 'endDate' | 'managerId' | 'status' | 'note' | 'color'>;
export type TaskInput = Pick<Task, 'projectId' | 'title' | 'description' | 'ownerIds' | 'contactIds' | 'startDate' | 'endDate' | 'status' | 'priority'>;
export type Command =
  | { type: 'createProject'; payload: ProjectInput }
  | { type: 'editProject'; payload: { id: string; changes: ProjectInput } }
  | { type: 'setProjectStatus'; payload: { id: string; status: ProjectStatus } }
  | { type: 'createTask'; payload: TaskInput }
  | { type: 'editTask'; payload: { id: string; changes: TaskInput } }
  | { type: 'saveTaskByProjectName'; payload: { id?: string; projectName: string; task: Omit<TaskInput, 'projectId'> } }
  | { type: 'setTaskStatus'; payload: { id: string; status: TaskStatus } }
  | { type: 'reviewTask'; payload: { id: string; approved: boolean; note: string } }
  | { type: 'deleteTask'; payload: { id: string } }
  | { type: 'dismissMigration'; payload: Record<string, never> };
