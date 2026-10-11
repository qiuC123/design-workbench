import { addDays, today } from './model';
import type { ScheduleProject, ScheduleState } from './types';

/** Synthetic schedules are generated relative to today, not tied to a fixed demo month. */
export function createSeed(): ScheduleState {
  const date = today();
  const time = new Date().toISOString();
  const state: ScheduleState = {
    version: 2,
    members: [
      { id: 'm-lin', name: '林知夏', specialty: '项目统筹 · 设计深化', color: '#647f71', active: true },
      { id: 'm-zhou', name: '周予安', specialty: '项目统筹 · 客户协调', color: '#a57859', active: true },
      { id: 'm-chen', name: '陈屿', specialty: '制作管理 · 现场带队', color: '#637fa3', active: true },
      { id: 'm-wang', name: '王启明', specialty: '工厂制作 · 搭建管理', color: '#9878a6', active: true },
      { id: 'm-su', name: '苏禾', specialty: 'CAD 深化 · 项目协作', color: '#b99347', active: true },
    ],
    projects: [], logs: [],
  };
  const project = (id: string, name: string, client: string, start: number, end: number, changes: Partial<ScheduleProject> = {}) => {
    const value: ScheduleProject = {
      id, name, client, contact: '', location: '', startDate: addDays(date, start), endDate: addDays(date, end), status: 'active', note: '',
      managerId: '', managerStartDate: '', managerEndDate: '', leadId: '', leadStartDate: '', leadEndDate: '',
      createdAt: time, updatedAt: time, ...changes,
    };
    state.projects.push(value);
  };
  project('p-atrium', '知序品牌 · 中庭快闪空间', '知序品牌', -2, 10, {
    contact: '许女士', location: '上海 · 新天地中庭', managerId: 'm-lin', managerStartDate: addDays(date, -2), managerEndDate: addDays(date, 6),
    note: '林知夏先负责项目统筹，制作组长待定。根据方案进度安排后续带队人员。',
  });
  project('p-exhibit', '未来会展 · 科技主题展台', '未来会展', -1, 12, {
    contact: '顾先生', location: '上海 · 国家会展中心', managerId: 'm-zhou', managerStartDate: addDays(date, -1), managerEndDate: addDays(date, 9),
    leadId: 'm-chen', leadStartDate: date, leadEndDate: addDays(date, 4), note: '经理负责客户协调，组长负责本周制作与搭建。',
  });
  project('p-pop', '拾光商业 · 春日橱窗装置', '拾光商业', 1, 8, {
    status: 'planned', contact: '孟女士', location: '杭州 · 拾光旗舰店', managerId: 'm-wang', managerStartDate: addDays(date, 1), managerEndDate: addDays(date, 5),
    note: '王启明今天没有安排，明天开始负责此项目；组长可在后续再确定。',
  });
  project('p-showroom', '知序品牌 · 展厅入口改造', '知序品牌', 2, 14, {
    status: 'planned', contact: '许女士', location: '苏州 · 知序品牌展厅', note: '新接项目，先选择项目经理，再根据制作时间确定组长。',
  });
  project('p-gallery', '城市艺术 · 移动展廊', '城市艺术', -3, 5, {
    contact: '郑可 · 商务部', location: '上海 · 西岸滨江', managerId: 'm-lin', managerStartDate: date, managerEndDate: addDays(date, 2),
    leadId: 'm-chen', leadStartDate: addDays(date, 2), leadEndDate: addDays(date, 5), note: '林知夏今日同时统筹两个项目，排班表会提示重叠；陈屿后天开始带队。',
  });
  project('p-completed', '拾光商业 · 秋季主题陈列', '拾光商业', -14, -5, {
    status: 'done', contact: '孟女士', location: '南京 · 拾光商场', managerId: 'm-zhou', managerStartDate: addDays(date, -14), managerEndDate: addDays(date, -5),
    leadId: 'm-chen', leadStartDate: addDays(date, -9), leadEndDate: addDays(date, -5), completedAt: `${addDays(date, -5)}T12:00:00+08:00`, note: '已完成，保留历史人选与排期，不再占用人员。',
  });
  state.projects.forEach((item, index) => {
    state.logs.push({ id: `schedule-seed-${index}`, projectId: item.id, at: time, text: item.status === 'done' ? '项目已完成，释放人员排班并保留历史安排。' : `项目计划 ${item.startDate} 至 ${item.endDate}${item.managerId ? '，已安排项目经理' : '，经理待分配'}${item.leadId ? '与项目组长。' : '，组长待定。'}` });
  });
  return state;
}
