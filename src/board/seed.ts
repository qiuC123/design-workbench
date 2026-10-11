import { addDays, today } from './model';
import type { Project, Task, WorkbenchState } from './types';

export const SEED_PROJECT_NAMES = [
  { id: 'example-museum', previous: '城市记忆展厅 · 示例', current: '示例乙香氛' },
  { id: 'example-launch', previous: '秋季新品发布会 · 示例', current: '新品展示' },
  { id: 'example-window', previous: '品牌橱窗更新 · 示例', current: '城市车展' },
  { id: 'example-concept', previous: '艺术空间概念提案 · 示例', current: 'DemoA' },
] as const;

export function createSeed(): WorkbenchState {
  const date = today();
  const time = new Date().toISOString();
  const base = { client: '演示客户', contact: '演示对接人', location: '上海', startDate: addDays(date, -7), endDate: addDays(date, 14), status: 'active' as const, note: '虚构示例项目，便于体验任务看板与人员排班。', createdAt: time, updatedAt: time };
  const projects: Project[] = [
    { ...base, id: 'example-museum', name: SEED_PROJECT_NAMES[0].current, client: '城市文化馆（示例）', contact: '陈女士（示例）', managerId: 'member-one', color: '#467c72' },
    { ...base, id: 'example-launch', name: SEED_PROJECT_NAMES[1].current, client: '山序品牌（示例）', contact: '林先生（示例）', managerId: 'member-two', color: '#6886b8' },
    { ...base, id: 'example-window', name: SEED_PROJECT_NAMES[2].current, client: '木间生活（示例）', contact: '顾女士（示例）', managerId: 'member-three', color: '#bd9254' },
    { ...base, id: 'example-concept', name: SEED_PROJECT_NAMES[3].current, client: '拾光空间（示例）', contact: '徐女士（示例）', managerId: '', status: 'planned', startDate: date, color: '#9879b1' },
  ];
  const taskBase = { description: '虚构示例任务，可打开卡片修改负责人、日期和对接人。', contactIds: ['boss'], priority: 'normal' as const, createdAt: time, updatedAt: time };
  const tasks: Task[] = [
    { ...taskBase, id: 'example-task-1', projectId: 'example-museum', title: '展厅方案深化与尺寸复核', ownerIds: ['member-one'], startDate: addDays(date, -1), endDate: addDays(date, 2), status: 'doing', priority: 'high' },
    { ...taskBase, id: 'example-task-2', projectId: 'example-museum', title: '入口装置打样检查', ownerIds: ['member-one'], contactIds: ['member-three'], startDate: addDays(date, 3), endDate: addDays(date, 4), status: 'todo' },
    { ...taskBase, id: 'example-task-3', projectId: 'example-launch', title: '主舞台施工图绘制', ownerIds: ['member-two'], startDate: date, endDate: addDays(date, 3), status: 'doing' },
    { ...taskBase, id: 'example-task-4', projectId: 'example-launch', title: '灯光点位与客户确认', ownerIds: ['member-two'], startDate: date, endDate: addDays(date, 1), status: 'review', priority: 'high' },
    { ...taskBase, id: 'example-task-5', projectId: 'example-window', title: '橱窗材质与收口核验', ownerIds: ['member-three'], contactIds: ['member-one'], startDate: date, endDate: addDays(date, 1), status: 'review' },
    { ...taskBase, id: 'example-task-6', projectId: 'example-window', title: '现场测量与照片整理', ownerIds: ['member-three'], startDate: addDays(date, -5), endDate: addDays(date, -3), status: 'done', completedAt: `${addDays(date, -3)}T10:00:00+08:00` },
    { ...taskBase, id: 'example-task-7', projectId: 'example-concept', title: '概念方案与初步报价', ownerIds: [], startDate: addDays(date, 1), endDate: addDays(date, 5), status: 'todo' },
    { ...taskBase, id: 'example-task-8', projectId: 'example-museum', title: '客户需求整理', ownerIds: ['member-one'], startDate: addDays(date, -7), endDate: addDays(date, -5), status: 'done', completedAt: `${addDays(date, -5)}T10:00:00+08:00` },
  ];
  return { version: 3, seedProjectNamesRevision: 1, projects, tasks, activities: [{ id: 'example-activity', projectId: projects[0].id, text: '示例：任务卡片与人员排班共用数据；共同负责人共享任务进度和日期，老板记录核验结果；对接人仅用于沟通。', at: time }] };
}
