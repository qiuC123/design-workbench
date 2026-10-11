export type AssignmentRole = 'manager' | 'lead';
export type ProjectStatus = 'planned' | 'active' | 'done';
export interface TeamMember { id: string; name: string; specialty: string; color: string; active: boolean }
export interface ScheduleProject {
  id: string; name: string; client: string; contact: string; location: string;
  startDate: string; endDate: string; status: ProjectStatus; note: string;
  managerId: string; managerStartDate: string; managerEndDate: string;
  leadId: string; leadStartDate: string; leadEndDate: string;
  createdAt: string; updatedAt: string; completedAt?: string;
}
export interface ScheduleLog { id: string; projectId: string; text: string; at: string }
export interface ScheduleState { version: 2; members: TeamMember[]; projects: ScheduleProject[]; logs: ScheduleLog[]; migratedFromWorkflow?: boolean }
export interface Booking { projectId: string; memberId: string; role: AssignmentRole; startDate: string; endDate: string; status: ProjectStatus }
export interface MemberDay { memberId: string; projectCount: number; bookings: Booking[]; free: boolean; conflicting: boolean }
export type ProjectInput = Pick<ScheduleProject, 'name' | 'client' | 'contact' | 'location' | 'startDate' | 'endDate' | 'status' | 'note'>;
export type ScheduleCommand =
  | { type: 'createProject'; payload: ProjectInput }
  | { type: 'editProject'; payload: { projectId: string; changes: Partial<ProjectInput> } }
  | { type: 'assign'; payload: { projectId: string; role: AssignmentRole; memberId: string; startDate: string; endDate: string } }
  | { type: 'unassign'; payload: { projectId: string; role: AssignmentRole } }
  | { type: 'setProjectStatus'; payload: { projectId: string; status: ProjectStatus } }
  | { type: 'addMember'; payload: { name: string; specialty: string } }
  | { type: 'editMember'; payload: { memberId: string; name: string; specialty: string } }
  | { type: 'toggleMember'; payload: { memberId: string } }
  | { type: 'dismissMigrationNotice'; payload: Record<string, never> };
