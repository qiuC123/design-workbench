export type ProjectStatus = 'todo' | 'doing' | 'review' | 'done';
export type Priority = 'normal' | 'high';
export interface Manager { id: string; name: string; color: string }
export interface Company {
  id: string; name: string; note: string; createdAt: string; updatedAt: string;
}
export interface Contact {
  id: string; companyId: string; name: string; note: string; active: boolean;
  createdAt: string; updatedAt: string;
}
export interface Project {
  id: string; companyId: string; title: string; description: string;
  ownerIds: string[]; contactIds: string[]; startDate: string; endDate: string;
  status: ProjectStatus; priority: Priority; createdAt: string; updatedAt: string;
  completedAt?: string; legacyNote?: string;
}
export interface Activity { id: string; projectId?: string; companyId?: string; text: string; at: string }
export interface WorkbenchState {
  version: 4; companies: Company[]; contacts: Contact[]; projects: Project[];
  activities: Activity[]; migrationNotice?: string;
}
export type ProjectInput = Pick<Project, 'companyId' | 'title' | 'description' | 'ownerIds' | 'contactIds' | 'startDate' | 'endDate' | 'status' | 'priority'>;
export interface CompanyInput { name: string; note: string }
export interface ContactInput { companyId: string; name: string; note: string; active: boolean }
export type Command =
  | { type: 'saveProject'; payload: { id?: string; companyName: string; project: Omit<ProjectInput, 'companyId'>; newContactNames?: string[] } }
  | { type: 'saveCompany'; payload: { id?: string; changes: CompanyInput } }
  | { type: 'saveContact'; payload: { id?: string; changes: ContactInput } }
  | { type: 'setProjectStatus'; payload: { id: string; status: ProjectStatus } }
  | { type: 'reviewProject'; payload: { id: string; approved: boolean; note: string } }
  | { type: 'deleteProject'; payload: { id: string } }
  | { type: 'dismissMigration'; payload: Record<string, never> };
