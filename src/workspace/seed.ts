import { addDays, today } from './model';
import type { Company, Project, WorkbenchState } from './types';

export const DEFAULT_COMPANIES = [
  { id: 'company-demoa', name: 'DemoA' },
  { id: 'company-demob', name: '示例乙' },
  { id: 'company-democ', name: '示例丙' },
  { id: 'company-demod', name: '示例丁（示例设计公司）' },
] as const;

export function createSeed(): WorkbenchState {
  const date = today();
  const time = new Date().toISOString();
  const companies: Company[] = DEFAULT_COMPANIES.map(company => ({ ...company, note: '', createdAt: time, updatedAt: time }));
  const base = { description: '示例项目，用于体验项目看板与人员排班；负责人和日期可按实际安排修改。客户对接人请在所属公司下添加。', contactIds: [], priority: 'normal' as const, createdAt: time, updatedAt: time };
  const projects: Project[] = [
    { ...base, id: 'example-project-demob', companyId: 'company-demob', title: '示例乙香氛装置深化（示例）', ownerIds: ['member-one', 'member-two'], startDate: addDays(date, -1), endDate: addDays(date, 2), status: 'doing', priority: 'high' },
    { ...base, id: 'example-project-demoa', companyId: 'company-demoa', title: 'DemoA 店铺陈列设计（示例）', ownerIds: ['member-three'], startDate: addDays(date, 2), endDate: addDays(date, 5), status: 'todo' },
    { ...base, id: 'example-project-democ', companyId: 'company-democ', title: '示例丙展台尺寸复核（示例）', ownerIds: ['member-four'], startDate: addDays(date, -1), endDate: addDays(date, 1), status: 'review' },
    { ...base, id: 'example-project-demod', companyId: 'company-demod', title: '示例丁现场收口确认（示例）', ownerIds: ['member-five'], startDate: addDays(date, -5), endDate: addDays(date, -3), status: 'done', completedAt: `${addDays(date, -3)}T10:00:00+08:00` },
  ];
  return { version: 4, companies, contacts: [], projects, activities: [{ id: 'example-project-activity', companyId: projects[0].companyId, projectId: projects[0].id, text: '示例：一张卡片就是一个项目，与人员排班共用同一组日期。客户对接人按公司维护，待填写真实联系人。', at: time }] };
}
