import { today } from './model';
import type { Artifact, ArtifactKind, Handoff, Project, Stage, State, Task, TaskStatus } from './types';

/** Synthetic, same-day-relative records. Resetting is useful on any calendar day. */
export function createSeed(): State {
  const seedDate = today();
  const date = (offset: number) => {
    const value = new Date(`${seedDate}T12:00:00+08:00`);
    value.setUTCDate(value.getUTCDate() + offset);
    return value.toISOString().slice(0, 10);
  };
  const time = (offset = 0) => `${date(offset)}T09:30:00+08:00`;
  const state: State = {
    schemaVersion: 1, seedDate, currentMemberId: 'm-lin',
    members: [
      { id: 'm-lin', name: '林知夏', role: '项目经理 · 设计师', color: '#647f71', active: true },
      { id: 'm-zhou', name: '周予安', role: '客户协调 · 项目经理', color: '#a57859', active: true },
      { id: 'm-chen', name: '陈屿', role: '项目组长', color: '#637fa3', active: true },
      { id: 'm-wang', name: '王启明', role: '制作组长', color: '#9878a6', active: true },
      { id: 'm-su', name: '苏禾', role: 'CAD 绘图员', color: '#b99347', active: true },
    ],
    contacts: [
      { id: 'c-brand', name: '许女士', company: '知序品牌', external: true },
      { id: 'c-expo', name: '顾先生', company: '未来会展', external: true },
      { id: 'c-store', name: '孟女士', company: '拾光商业', external: true },
      { id: 'c-internal', name: '郑可', company: '商务部', external: false },
    ],
    projects: [], tasks: [], artifacts: [], handoffs: [], issues: [], activities: [],
  };
  const project = (id: string, code: string, name: string, client: string, contactId: string, stage: Stage, overrides: Partial<Project> = {}): Project => {
    const value: Project = {
      id, code, name, client, contactId, managerId: 'm-lin', drafterId: 'm-su', leadId: 'm-chen',
      drawingConfirmerId: 'm-lin', sampleConfirmerId: 'm-zhou', clientConfirmerId: 'm-zhou',
      handlerId: stage === 'design' ? 'm-su' : stage === 'done' ? 'm-lin' : 'm-chen', stage,
      dueDate: date(3), plannedDate: date(14), location: '上海 · 项目指定场地', description: '', blockedReason: '', createdAt: time(-10), ...overrides,
    };
    state.projects.push(value);
    return value;
  };
  const artifact = (id: string, projectId: string, kind: ArtifactKind, title: string, version: string, status: Artifact['status'] = 'confirmed', confirmerId = 'm-lin', notes = ''): Artifact => {
    const value: Artifact = {
      id, projectId, kind, title, version, status, confirmerId, notes,
      url: kind === 'drawing' ? '/demo/cad.svg' : kind === 'sample' ? '/demo/sample.svg' : '/demo/site.svg',
      createdAt: time(-5), ...(status !== 'pending' ? { confirmedAt: time(-4) } : {}),
    };
    state.artifacts.push(value);
    return value;
  };
  const task = (id: string, projectId: string, title: string, ownerId: string, status: TaskStatus, offset: number, overrides: Partial<Task> = {}): Task => {
    const value: Task = { id, projectId, title, ownerId, status, collaboratorIds: [], dueDate: date(offset), blockedReason: '', ...(status === 'done' ? { completedAt: time(-2) } : {}), ...overrides };
    state.tasks.push(value);
    return value;
  };
  const handoff = (id: string, projectId: string, artifactId: string, toId: string, status: Handoff['status'] = 'accepted') => {
    state.handoffs.push({ id, projectId, artifactId, fromId: 'm-lin', toId, status, dueDate: date(1), note: '请按该确认版本制作；现场尺寸变化需先反馈。', createdAt: time(-4), ...(status === 'accepted' ? { acceptedAt: time(-3) } : {}) });
  };

  project('p-atrium', 'DW-2026-001', '知序品牌 · 中庭快闪空间', '知序品牌', 'c-brand', 'design', {
    managerId: 'm-lin', drafterId: 'm-lin', handlerId: 'm-lin', dueDate: date(1), plannedDate: date(18), location: '上海 · 新天地中庭',
    description: '120㎡品牌快闪空间。经理与绘图员由林知夏兼任，CAD 确认后交接组长，再进入打样。',
  });
  artifact('a-atrium-v1', 'p-atrium', 'drawing', '快闪空间平面及立面图', 'V1.0', 'confirmed', 'm-lin', '原方案已确认，待组长接收指定版。');
  artifact('a-atrium-v2', 'p-atrium', 'drawing', '快闪空间灯光补充图', 'V1.1', 'pending', 'm-lin', '新增灯带与电源位置说明，原版与交接记录保留。');
  handoff('h-atrium-v1', 'p-atrium', 'a-atrium-v1', 'm-chen', 'pending');
  task('t-atrium-cad', 'p-atrium', '完善 CAD 灯光与节点图', 'm-lin', 'doing', 1, { collaboratorIds: ['m-su'] });
  task('t-atrium-check', 'p-atrium', '核对现场尺寸与出图清单', 'm-su', 'review', 2, { collaboratorIds: ['m-lin'] });

  project('p-exhibit', 'DW-2026-002', '未来会展 · 科技主题展台', '未来会展', 'c-expo', 'sample', {
    managerId: 'm-zhou', dueDate: date(2), plannedDate: date(20), location: '上海 · 国家会展中心 4.1 馆', executionDrawingId: 'a-exhibit-v3', description: '组长已接收 V3.0 图纸，本周确认发光字与烤漆色板。',
  });
  artifact('a-exhibit-v2', 'p-exhibit', 'drawing', '科技展台施工图', 'V2.0', 'rejected', 'm-lin', '灯箱位置需调整，已由 V3.0 修订。');
  artifact('a-exhibit-v3', 'p-exhibit', 'drawing', '科技展台施工图', 'V3.0', 'confirmed', 'm-lin', '已确认并交接，作为当前制作依据。');
  artifact('a-exhibit-sample', 'p-exhibit', 'sample', '发光字与烤漆色板', 'S1.0', 'pending', 'm-zhou', '请确认颜色与发光均匀度，照片为虚构示例。');
  handoff('h-exhibit', 'p-exhibit', 'a-exhibit-v3', 'm-chen');
  task('t-exhibit-sample', 'p-exhibit', '制作并提交材质样品', 'm-chen', 'review', 2, { collaboratorIds: ['m-wang'] });
  task('t-exhibit-check', 'p-exhibit', '整理客户样品确认意见', 'm-zhou', 'todo', 3);

  project('p-pop', 'DW-2026-003', '拾光商业 · 春日橱窗装置', '拾光商业', 'c-store', 'prebuild', {
    leadId: 'm-wang', handlerId: 'm-wang', dueDate: date(4), plannedDate: date(12), location: '杭州 · 拾光旗舰店', executionDrawingId: 'a-pop-v1', sampleSkippedReason: '沿用客户已确认的同款标准材料与工艺，本项目不另行打样。', description: '重复使用成熟结构，跳过打样的原因已记录，准备工厂预搭建。',
  });
  artifact('a-pop-v1', 'p-pop', 'drawing', '橱窗装置安装图', 'V1.0');
  handoff('h-pop', 'p-pop', 'a-pop-v1', 'm-wang');
  task('t-pop-prebuild', 'p-pop', '完成工厂预搭建与尺寸复核', 'm-wang', 'doing', 4, { collaboratorIds: ['m-chen'] });
  task('t-pop-pack', 'p-pop', '整理安装工具与运输清单', 'm-chen', 'todo', 6);

  project('p-showroom', 'DW-2026-004', '知序品牌 · 展厅入口改造', '知序品牌', 'c-brand', 'acceptance', {
    dueDate: date(2), plannedDate: date(9), location: '苏州 · 知序品牌展厅', executionDrawingId: 'a-showroom-v1', blockedReason: '待整改：入口灯箱亮度不均，需调整灯带布置', description: '客户首轮验收提出灯箱整改。执行仍以已交接 V1.0 为准，V2.0 确认和交接后切换。',
  });
  artifact('a-showroom-v1', 'p-showroom', 'drawing', '展厅入口施工图', 'V1.0');
  artifact('a-showroom-v2', 'p-showroom', 'drawing', '展厅入口灯带整改图', 'V2.0', 'pending', 'm-lin', '针对客户验收意见调整灯带间距。');
  artifact('a-showroom-sample', 'p-showroom', 'sample', '入口材质样板', 'S1.0', 'confirmed', 'm-zhou');
  artifact('a-showroom-prebuild', 'p-showroom', 'prebuild', '入口结构预搭建', 'R1', 'confirmed', 'm-chen', '结构与尺寸复核通过。');
  artifact('a-showroom-acceptance', 'p-showroom', 'acceptance', '客户首轮验收', 'R1', 'rejected', 'm-zhou', '客户意见：入口灯箱亮度不均，需调整灯带布置；整改后再次确认。');
  handoff('h-showroom', 'p-showroom', 'a-showroom-v1', 'm-chen');
  task('t-showroom-fix', 'p-showroom', '整改：入口灯箱亮度不均，需调整灯带布置', 'm-su', 'doing', 2, { issueId: 'i-showroom-light', collaboratorIds: ['m-lin'] });
  state.issues.push({ id: 'i-showroom-light', projectId: 'p-showroom', title: '入口灯箱亮度不均，需调整灯带布置', ownerId: 'm-su', status: 'fixing', taskId: 't-showroom-fix', createdAt: time(-1) });

  project('p-gallery', 'DW-2026-005', '城市艺术 · 移动展廊', '城市艺术', 'c-internal', 'onsite', {
    dueDate: date(-1), plannedDate: date(2), location: '上海 · 西岸滨江公共空间', executionDrawingId: 'a-gallery-v1', description: '客户已完成验收，等待现场安装与经理确认完成。现场任务有一项逾期。',
  });
  artifact('a-gallery-v1', 'p-gallery', 'drawing', '移动展廊深化图', 'V1.0');
  artifact('a-gallery-sample', 'p-gallery', 'sample', '铝板与亚克力样品', 'S1.0', 'confirmed', 'm-zhou');
  artifact('a-gallery-prebuild', 'p-gallery', 'prebuild', '展廊预搭建记录', 'R1', 'confirmed', 'm-chen');
  artifact('a-gallery-acceptance', 'p-gallery', 'acceptance', '客户最终验收', 'R1', 'confirmed', 'm-zhou', '客户已确认结构、材质与灯光效果，可以落地。');
  handoff('h-gallery', 'p-gallery', 'a-gallery-v1', 'm-chen');
  task('t-gallery-install', 'p-gallery', '现场安装与安全检查', 'm-chen', 'doing', -1, { collaboratorIds: ['m-wang'], blockedReason: '场地临时调整进场时间，已联系商务协调。' });
  task('t-gallery-close', 'p-gallery', '登记落地照片并确认项目完成', 'm-lin', 'todo', 2);

  project('p-completed', 'DW-2026-006', '拾光商业 · 秋季主题陈列', '拾光商业', 'c-store', 'done', {
    managerId: 'm-zhou', handlerId: 'm-zhou', dueDate: date(-6), plannedDate: date(-5), completedAt: time(-5), location: '南京 · 拾光商场一层', executionDrawingId: 'a-completed-v1', description: '已完成现场落地，图纸、交接和各阶段确认记录完整保留。',
  });
  artifact('a-completed-v1', 'p-completed', 'drawing', '主题陈列施工图', 'V1.0', 'confirmed', 'm-lin');
  artifact('a-completed-sample', 'p-completed', 'sample', '主题色板', 'S1.0', 'confirmed', 'm-zhou');
  artifact('a-completed-prebuild', 'p-completed', 'prebuild', '主题陈列预搭建', 'R1', 'confirmed', 'm-chen');
  artifact('a-completed-acceptance', 'p-completed', 'acceptance', '客户验收签认', 'R1', 'confirmed', 'm-zhou');
  artifact('a-completed-onsite', 'p-completed', 'onsite', '现场落地与交付记录', 'R1', 'confirmed', 'm-zhou');
  handoff('h-completed', 'p-completed', 'a-completed-v1', 'm-chen');
  task('t-completed-close', 'p-completed', '完成现场落地并归档', 'm-zhou', 'done', -5);

  state.projects.forEach((item, index) => {
    state.activities.push({ id: `activity-seed-${index}`, projectId: item.id, actorId: item.managerId, at: time(-index - 1), text: `演示项目已进入${({ design: '设计出图', sample: '打样', prebuild: '工厂预搭建', acceptance: '客户验收', onsite: '现场落地', done: '已完成', intake: '项目接入' } as const)[item.stage]}阶段；历史资料与当前执行版本均可查看。` });
  });
  state.activities.unshift({ id: 'activity-seed-rework', projectId: 'p-showroom', actorId: 'm-zhou', at: time(-1), text: '客户首轮验收未通过：入口灯箱亮度不均；已安排苏禾整改，待处理完成后再次确认。' });
  state.activities.unshift({ id: 'activity-seed-skip', projectId: 'p-pop', actorId: 'm-lin', at: time(-3), text: '跳过打样：沿用已确认的标准材料与工艺，进入工厂预搭建。' });
  return state;
}
