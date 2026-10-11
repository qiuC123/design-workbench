import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, isOverdue, memberName, selectMyWork, today } from './model';
import { createSeed } from './seed';
import type { Command, ProjectInput, State } from './types';

const input = (): ProjectInput => ({ name: '全流程验证项目', client: '虚构客户', contactId: 'c-brand', managerId: 'm-lin', drafterId: 'm-lin', leadId: 'm-chen', drawingConfirmerId: 'm-lin', sampleConfirmerId: 'm-zhou', clientConfirmerId: 'm-zhou', dueDate: today(), plannedDate: today(), location: '上海 · 演示场地', description: '内部验证', blockedReason: '' });
const emptyState = (): State => ({ ...createSeed(), projects: [], tasks: [], artifacts: [], handoffs: [], issues: [], activities: [] });

function flow() {
  let state = applyCommand(emptyState(), { type: 'createProject', payload: input() });
  const projectId = state.projects[0].id;
  const run = (command: Command) => { state = applyCommand(state, command); return state; };
  const switchTo = (memberId: string) => run({ type: 'switchMember', payload: { memberId } });
  const drawing = (version = 'V1') => {
    switchTo('m-lin');
    run({ type: 'addArtifact', payload: { projectId, kind: 'drawing', title: 'CAD 施工图', version, url: '/demo/drawing.svg', notes: '尺寸与节点说明', confirmerId: 'm-lin' } });
    const artifactId = state.artifacts[0].id;
    run({ type: 'confirmArtifact', payload: { artifactId, accepted: true, note: '确认采用' } });
    run({ type: 'createHandoff', payload: { projectId, artifactId, toId: 'm-chen', dueDate: today(), note: '按此版本制作' } });
    const handoffId = state.handoffs[0].id;
    switchTo('m-chen');
    run({ type: 'acceptHandoff', payload: { handoffId, accepted: true, note: '资料齐全' } });
    return { artifactId, handoffId };
  };
  const sample = () => {
    run({ type: 'addArtifact', payload: { projectId, kind: 'sample', title: '样品色板', version: 'S1', url: '/demo/sample.svg', notes: '', confirmerId: 'm-zhou' } });
    switchTo('m-zhou');
    run({ type: 'confirmArtifact', payload: { artifactId: state.artifacts[0].id, accepted: true, note: '符合要求' } });
  };
  const milestone = (kind: 'prebuild' | 'acceptance' | 'onsite', accepted = true, notes = '记录验证结果') => run({ type: 'recordMilestone', payload: { projectId, kind, accepted, notes, title: `${kind}验证记录`, url: '/demo/sample.svg' } });
  return { get state() { return state; }, projectId, run, switchTo, drawing, sample, milestone };
}

test('正常流程：兼任角色、确认版本、组长接收、打样、预搭建、客户验收、现场落地', () => {
  const f = flow();
  assert.equal(f.state.projects[0].managerId, f.state.projects[0].drafterId);
  assert.equal(f.state.projects[0].stage, 'design');
  const drawing = f.drawing();
  assert.equal(f.state.projects[0].stage, 'sample');
  assert.equal(f.state.projects[0].executionDrawingId, drawing.artifactId);
  f.sample();
  assert.equal(f.state.projects[0].stage, 'prebuild');
  f.switchTo('m-chen'); f.milestone('prebuild');
  assert.equal(f.state.projects[0].stage, 'acceptance');
  f.switchTo('m-zhou'); f.milestone('acceptance');
  assert.equal(f.state.projects[0].stage, 'onsite');
  f.switchTo('m-lin'); f.milestone('onsite');
  assert.equal(f.state.projects[0].stage, 'done');
  assert.ok(f.state.projects[0].completedAt);
  assert.equal(f.state.artifacts.length, 5);
  assert.ok(f.state.activities.some(item => item.text.includes('接收图纸交接')));
});

test('普通 CAD 任务完成不会推进阶段；确认 CAD 仍须指定组长接收', () => {
  const f = flow();
  f.run({ type: 'addTask', payload: { projectId: f.projectId, title: 'CAD 绘制', ownerId: 'm-lin', collaboratorIds: [], dueDate: today(), blockedReason: '' } });
  f.run({ type: 'updateTask', payload: { taskId: f.state.tasks[0].id, status: 'done' } });
  assert.equal(f.state.projects[0].stage, 'design');
  assert.ok(f.state.tasks[0].completedAt);
  f.run({ type: 'addArtifact', payload: { projectId: f.projectId, kind: 'drawing', title: '施工图', version: 'V1', notes: '', url: '', confirmerId: 'm-lin' } });
  f.run({ type: 'confirmArtifact', payload: { artifactId: f.state.artifacts[0].id, accepted: true, note: '' } });
  assert.equal(f.state.projects[0].stage, 'design');
  assert.throws(() => f.run({ type: 'createHandoff', payload: { projectId: f.projectId, artifactId: f.state.artifacts[0].id, toId: 'm-su', dueDate: today(), note: '' } }), /项目组长/);
});

test('返工：客户未通过、明确处理人、整改任务、新版本、新交接、再次确认，完整保留历史', () => {
  const f = flow();
  const original = f.drawing(); f.sample();
  f.switchTo('m-chen'); f.milestone('prebuild');
  f.switchTo('m-zhou'); f.milestone('acceptance', false, '灯箱亮度不均');
  assert.equal(f.state.projects[0].stage, 'acceptance');
  assert.match(f.state.projects[0].blockedReason, /灯箱亮度不均/);
  const firstAcceptanceId = f.state.artifacts[0].id;
  f.run({ type: 'createIssue', payload: { projectId: f.projectId, title: '灯箱亮度不均', ownerId: 'm-su', dueDate: today() } });
  const issueId = f.state.issues[0].id;
  const taskId = f.state.issues[0].taskId;
  assert.equal(f.state.tasks.find(task => task.id === taskId)?.ownerId, 'm-su');
  assert.throws(() => f.milestone('acceptance'), /未闭环/);
  f.run({ type: 'updateTask', payload: { taskId, status: 'doing' } });
  assert.equal(f.state.issues[0].status, 'fixing');
  const corrected = f.drawing('V2');
  assert.equal(f.state.projects[0].stage, 'acceptance', '后续阶段接收新图纸不能重置为打样');
  assert.equal(f.state.projects[0].executionDrawingId, corrected.artifactId);
  assert.equal(f.state.artifacts.find(item => item.id === original.artifactId)?.status, 'confirmed');
  assert.equal(f.state.handoffs.find(item => item.id === original.handoffId)?.status, 'accepted');
  assert.equal(f.state.artifacts.find(item => item.id === firstAcceptanceId)?.status, 'rejected');
  f.run({ type: 'updateTask', payload: { taskId, status: 'review' } });
  assert.equal(f.state.issues[0].status, 'awaiting');
  assert.throws(() => f.run({ type: 'reconfirmIssue', payload: { issueId, accepted: true, note: '' } }), /周予安/);
  f.switchTo('m-zhou');
  f.run({ type: 'reconfirmIssue', payload: { issueId, accepted: false, note: '右侧仍有暗区' } });
  assert.equal(f.state.issues[0].status, 'fixing');
  f.run({ type: 'updateTask', payload: { taskId, status: 'done' } });
  f.run({ type: 'reconfirmIssue', payload: { issueId, accepted: true, note: '复测均匀，整改通过' } });
  assert.equal(f.state.issues[0].status, 'closed');
  assert.match(f.state.issues[0].confirmationNote!, /右侧仍有暗区/);
  assert.match(f.state.issues[0].confirmationNote!, /整改通过/);
  f.run({ type: 'updateTask', payload: { taskId, dueDate: today() } });
  assert.equal(f.state.issues[0].status, 'closed', '仅调整任务日期不能重新打开已闭环整改');
  f.milestone('acceptance', true, '第二轮确认通过');
  assert.equal(f.state.projects[0].stage, 'onsite');
  assert.equal(f.state.artifacts.filter(item => item.kind === 'acceptance').length, 2);
});

test('跳过打样须已接收图纸且说明原因；可继续正常推进', () => {
  const f = flow();
  assert.throws(() => f.run({ type: 'skipSample', payload: { projectId: f.projectId, reason: '成熟工艺' } }), /接收图纸/);
  f.drawing();
  f.switchTo('m-su');
  assert.throws(() => f.run({ type: 'skipSample', payload: { projectId: f.projectId, reason: '成熟工艺' } }), /项目经理或项目组长/);
  f.switchTo('m-chen');
  assert.throws(() => f.run({ type: 'skipSample', payload: { projectId: f.projectId, reason: '  ' } }), /原因/);
  f.run({ type: 'skipSample', payload: { projectId: f.projectId, reason: '使用客户已确认的标准材质' } });
  assert.equal(f.state.projects[0].stage, 'prebuild');
  assert.match(f.state.projects[0].sampleSkippedReason!, /标准材质/);
  f.milestone('prebuild');
  assert.equal(f.state.projects[0].stage, 'acceptance');
});

test('身份：只允许指定确认人确认、指定接收人接收、节点默认角色登记', () => {
  const f = flow();
  f.run({ type: 'addArtifact', payload: { projectId: f.projectId, kind: 'drawing', title: '施工图', version: 'V1', notes: '', url: '', confirmerId: 'm-lin' } });
  const artifactId = f.state.artifacts[0].id;
  f.switchTo('m-su');
  assert.throws(() => f.run({ type: 'confirmArtifact', payload: { artifactId, accepted: true, note: '' } }), /林知夏/);
  f.switchTo('m-lin');
  f.run({ type: 'confirmArtifact', payload: { artifactId, accepted: true, note: '' } });
  f.run({ type: 'createHandoff', payload: { projectId: f.projectId, artifactId, toId: 'm-chen', dueDate: today(), note: '' } });
  const handoffId = f.state.handoffs[0].id;
  assert.throws(() => f.run({ type: 'acceptHandoff', payload: { handoffId, accepted: true, note: '' } }), /陈屿/);
  f.switchTo('m-chen');
  f.run({ type: 'acceptHandoff', payload: { handoffId, accepted: true, note: '' } });
  f.run({ type: 'skipSample', payload: { projectId: f.projectId, reason: '无需打样' } });
  f.switchTo('m-lin');
  assert.throws(() => f.milestone('prebuild'), /陈屿/);
});

test('成员视角按稳定 ID 展示主责、协作、待交接与待确认', () => {
  const state = createSeed();
  const lin = selectMyWork(state, 'm-lin');
  const chen = selectMyWork(state, 'm-chen');
  const zhou = selectMyWork(state, 'm-zhou');
  assert.ok(lin.tasks.some(task => task.ownerId !== 'm-lin' && task.collaboratorIds.includes('m-lin')));
  assert.ok(lin.confirmations.some(artifact => artifact.projectId === 'p-atrium'));
  assert.equal(chen.handoffs[0].id, 'h-atrium-v1');
  assert.ok(zhou.confirmations.some(artifact => artifact.kind === 'sample'));
  assert.ok(lin.confirmations.every(artifact => artifact.status === 'pending'));
  const switched = applyCommand(state, { type: 'switchMember', payload: { memberId: 'm-chen' } });
  assert.equal(switched.currentMemberId, 'm-chen');
  assert.equal(state.currentMemberId, 'm-lin');
});

test('停用成员阻止新分配，保留历史身份与未完成任务；角色可转交', () => {
  let state = createSeed();
  const originalTaskCount = state.tasks.filter(task => task.ownerId === 'm-su').length;
  state = applyCommand(state, { type: 'toggleMember', payload: { memberId: 'm-su' } });
  assert.equal(memberName(state, 'm-su'), '苏禾');
  assert.equal(state.tasks.filter(task => task.ownerId === 'm-su').length, originalTaskCount);
  assert.throws(() => applyCommand(state, { type: 'createProject', payload: { ...input(), drafterId: 'm-su' } }), /已停用/);
  assert.throws(() => applyCommand(state, { type: 'addTask', payload: { projectId: 'p-atrium', title: '新任务', ownerId: 'm-su', collaboratorIds: [], dueDate: today(), blockedReason: '' } }), /已停用/);
  assert.throws(() => applyCommand(state, { type: 'switchMember', payload: { memberId: 'm-su' } }), /已停用/);
  const inactiveTask = state.tasks.find(task => task.ownerId === 'm-su')!;
  state = applyCommand(state, { type: 'updateTask', payload: { taskId: inactiveTask.id, ownerId: 'm-su', status: 'review' } });
  assert.equal(state.tasks.find(task => task.id === inactiveTask.id)?.ownerId, 'm-su');
  assert.equal(state.tasks.find(task => task.id === inactiveTask.id)?.status, 'review');
  state = applyCommand(state, { type: 'editProject', payload: { projectId: 'p-exhibit', changes: { name: '历史项目仍可编辑' } } });
  assert.equal(state.projects.find(project => project.id === 'p-exhibit')?.drafterId, 'm-su');
  state = applyCommand(state, { type: 'editProject', payload: { projectId: 'p-exhibit', changes: { drafterId: 'm-lin' } } });
  assert.equal(state.projects.find(project => project.id === 'p-exhibit')?.drafterId, 'm-lin');
});

test('跳过已有待确认样品会退出个人确认队列，但不自动关闭已登记的整改', () => {
  const f = flow();
  f.drawing();
  f.run({ type: 'addArtifact', payload: { projectId: f.projectId, kind: 'sample', title: '待确认色板', version: 'S1', url: '/demo/sample.svg', notes: '', confirmerId: 'm-zhou' } });
  f.run({ type: 'createIssue', payload: { projectId: f.projectId, title: '独立结构节点需修改', ownerId: 'm-su', dueDate: today() } });
  f.run({ type: 'skipSample', payload: { projectId: f.projectId, reason: '取消色板打样，改用客户指定成品材料' } });
  assert.equal(f.state.projects[0].stage, 'prebuild');
  assert.equal(selectMyWork(f.state, 'm-zhou').confirmations.length, 0);
  const sample = f.state.artifacts.find(item => item.kind === 'sample')!;
  assert.equal(sample.status, 'rejected', '现有契约使用 rejected 保存未采用资料');
  assert.match(sample.notes, /已跳过打样/);
  assert.equal(f.state.issues[0].status, 'open');
  f.milestone('prebuild');
  f.switchTo('m-zhou');
  assert.throws(() => f.milestone('acceptance'), /未闭环/);
});

test('项目确认人可调整；只更新待确认资料，保留旧版签名', () => {
  const state = applyCommand(createSeed(), { type: 'editProject', payload: { projectId: 'p-atrium', changes: { drawingConfirmerId: 'm-zhou' } } });
  assert.equal(state.artifacts.find(artifact => artifact.id === 'a-atrium-v2')?.confirmerId, 'm-zhou');
  assert.equal(state.artifacts.find(artifact => artifact.id === 'a-atrium-v1')?.confirmerId, 'm-lin');
});

test('任务、总览、个人工作共用不可变状态，可序列化后恢复', () => {
  const state = createSeed();
  const snapshot = JSON.stringify(state);
  const next = applyCommand(state, { type: 'updateTask', payload: { taskId: 't-atrium-cad', status: 'review' } });
  assert.equal(JSON.stringify(state), snapshot);
  assert.equal(selectMyWork(next, 'm-lin').tasks.find(task => task.id === 't-atrium-cad')?.status, 'review');
  const restored = JSON.parse(JSON.stringify(next)) as State;
  assert.deepEqual(restored, next);
  assert.equal(restored.projects.find(project => project.id === 'p-atrium')?.stage, 'design');
});

test('资料版本不可覆盖，链接仅允许网页与示例文件', () => {
  const f = flow();
  for (const url of ['javascript:alert(1)', 'file:///C:/secret', '/demo/../../secret', 'data:text/html,unsafe']) {
    assert.throws(() => f.run({ type: 'addArtifact', payload: { projectId: f.projectId, kind: 'drawing', title: '资料', version: 'V1', url, notes: '', confirmerId: 'm-lin' } }), /资料链接/);
  }
  f.run({ type: 'addArtifact', payload: { projectId: f.projectId, kind: 'drawing', title: '资料', version: 'V1', url: 'https://example.com/drawing.pdf', notes: '', confirmerId: 'm-lin' } });
  assert.throws(() => f.run({ type: 'addArtifact', payload: { projectId: f.projectId, kind: 'drawing', title: '另一份资料', version: 'V1', url: '', notes: '', confirmerId: 'm-lin' } }), /相同版本/);
});

test('日期、对接人复用与受阻验证', () => {
  assert.equal(isOverdue('2000-01-01'), true);
  assert.equal(isOverdue('2000-01-01', true), false);
  assert.equal(isOverdue(today()), false);
  assert.equal(isOverdue(''), false);
  assert.throws(() => applyCommand(emptyState(), { type: 'createProject', payload: { ...input(), dueDate: '2026-02-30' } }), /日期无效/);
  assert.throws(() => applyCommand(createSeed(), { type: 'addContact', payload: { name: '许女士', company: '知序品牌', external: true } }), /搜索复用/);
  const seed = createSeed();
  assert.equal(seed.seedDate, today());
  assert.equal(seed.projects.length, 6);
  assert.equal(seed.members.length, 5);
  assert.ok(seed.projects.some(project => project.stage !== 'done' && project.dueDate >= today()));
  assert.ok(seed.artifacts.filter(artifact => ['prebuild', 'acceptance', 'onsite'].includes(artifact.kind)).every(artifact => artifact.url === '/demo/site.svg'));
});

test('新建同名项目忽略首尾空格与英文大小写，提示复用或改名', () => {
  const state = applyCommand(emptyState(), { type: 'createProject', payload: { ...input(), name: ' DESIGN LAB ' } });
  assert.equal(state.projects[0].name, 'DESIGN LAB');
  assert.throws(() => applyCommand(state, { type: 'createProject', payload: { ...input(), name: 'design lab' } }), /复用已有项目或修改项目名称/);
});

test('已完成项目不能生成无法处理的待确认资料、交接或整改；基本信息仍可编辑', () => {
  const state = createSeed();
  const before = JSON.stringify(state);
  assert.throws(() => applyCommand(state, { type: 'addArtifact', payload: { projectId: 'p-completed', kind: 'drawing', title: '补充资料', version: 'V2', url: '/demo/cad.svg', notes: '', confirmerId: 'm-lin' } }), /已完成项目不能新增待确认资料/);
  assert.throws(() => applyCommand(state, { type: 'createHandoff', payload: { projectId: 'p-completed', artifactId: 'a-completed-v1', toId: 'm-chen', dueDate: today(), note: '' } }), /已完成项目不能发起/);
  assert.throws(() => applyCommand(state, { type: 'createIssue', payload: { projectId: 'p-completed', title: '不应新增的整改', ownerId: 'm-su', dueDate: today() } }), /已完成项目不能新增整改/);
  assert.equal(JSON.stringify(state), before);
  assert.ok(!selectMyWork(state, 'm-lin').confirmations.some(artifact => artifact.projectId === 'p-completed'));
  assert.ok(!selectMyWork(state, 'm-chen').handoffs.some(handoff => handoff.projectId === 'p-completed'));
  const edited = applyCommand(state, { type: 'editProject', payload: { projectId: 'p-completed', changes: { description: '交付后补充归档说明' } } });
  assert.equal(edited.projects.find(project => project.id === 'p-completed')?.description, '交付后补充归档说明');
  const taskEdited = applyCommand(edited, { type: 'updateTask', payload: { taskId: 't-completed-close', dueDate: today() } });
  assert.equal(taskEdited.projects.find(project => project.id === 'p-completed')?.stage, 'done');
});

test('禁止越过业务节点、空退回意见和重复接收', () => {
  const f = flow();
  f.switchTo('m-zhou');
  assert.throws(() => f.milestone('acceptance'), /前序交接/);
  f.switchTo('m-lin');
  f.run({ type: 'addArtifact', payload: { projectId: f.projectId, kind: 'drawing', title: '施工图', version: 'V1', url: '', notes: '', confirmerId: 'm-lin' } });
  assert.throws(() => f.run({ type: 'confirmArtifact', payload: { artifactId: f.state.artifacts[0].id, accepted: false, note: '' } }), /修改意见/);
  const accepted = f.drawing('V2');
  assert.throws(() => f.run({ type: 'acceptHandoff', payload: { handoffId: accepted.handoffId, accepted: true, note: '' } }), /已经处理/);
});
