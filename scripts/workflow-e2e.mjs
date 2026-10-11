import { chromium, expect } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Test only in an independent ephemeral browser context. All business changes
// happen through visible forms/buttons; localStorage is read for assertions.
const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';
const output = path.resolve('work/qa');
mkdirSync(output, { recursive: true });
const checks = [];
const errors = [];
let browser;
try { browser = await chromium.launch({ headless: true }); }
catch (error) {
  const cached = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright/chromium-1234/chrome-win64/chrome.exe');
  browser = await chromium.launch(existsSync(cached) ? { headless: true, executablePath: cached } : { headless: true, channel: 'msedge' });
}
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
page.on('console', msg => { if (msg.type() === 'error') errors.push(`${msg.text()} ${msg.location().url}`.trim()); });
page.setDefaultTimeout(12000);
const dialog = () => page.getByRole('dialog');
const button = (name) => page.getByRole('button', { name, exact: true });
const dButton = name => dialog().getByRole('button', { name, exact: true });
const input = name => dialog().locator(`[name="${name}"]`);
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('xu-jian-workbench-v1')));
async function check(title, run) { await run(); checks.push({ title, passed: true }); console.log(`PASS ${title}`); }
async function submit(name = '保存') {
  await dButton(name).click();
  await expect(dialog(), 'form should close without a business error').toHaveCount(0);
}
async function switchMember(id) { await page.getByLabel('演示成员', { exact: true }).selectOption(id); }
async function navigate(href) {
  await page.goto(`${baseURL}/#${href}`);
  const phaseTab = page.getByRole('tab', { name: '阶段工作', exact: true });
  if (await phaseTab.count()) await phaseTab.click();
}
async function stage(expected) { await expect(page.locator('.detail-title-row .stage-badge')).toHaveText(expected); }
async function projectFromName(name) { return (await state()).projects.find(p => p.name === name); }
async function createProject(name) {
  await switchMember('m-lin');
  await navigate('/projects');
  await button('新建项目').click();
  await input('name').fill(name);
  await input('client').fill('虚构产品验证客户');
  await input('managerId').selectOption('m-lin');
  await input('drafterId').selectOption('m-lin');
  await input('leadId').selectOption('m-chen');
  await input('drawingConfirmerId').selectOption('m-lin');
  await input('sampleConfirmerId').selectOption('m-lin');
  await input('clientConfirmerId').selectOption('m-lin');
  await input('location').fill('上海 · 虚构展厅 A 区');
  await input('description').fill('浏览器端到端验证创建的虚构项目');
  await submit();
  await stage('设计出图');
  return projectFromName(name);
}
async function addTask(title, collaborator = '') {
  await button('新增任务').click();
  await input('title').fill(title);
  await input('ownerId').selectOption('m-lin');
  if (collaborator) await dialog().locator(`input[name="collaboratorIds"][value="${collaborator}"]`).check();
  await submit();
}
async function addArtifact(kind, version, title, notes = '已核对尺寸与材料。') {
  await page.getByRole('tab', { name: /成果与版本/ }).click();
  await button('新增资料').click();
  await input('kind').selectOption(kind);
  await input('version').fill(version);
  await input('title').fill(title);
  await input('confirmerId').selectOption('m-lin');
  await input('notes').fill(notes);
  await submit();
  const card = page.locator('.artifact-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await card.getByRole('button', { name: /确认 \/ 提出修改/ }).click();
  await input('notes').fill(`${version} 确认通过，资料齐全。`);
  await submit('确认通过');
  await expect(card.locator('.badge')).toHaveText('已确认');
}
async function handoff(version) {
  await page.getByRole('tab', { name: '交接与记录', exact: true }).click();
  await button('发起交接').click();
  await input('artifactId').selectOption({ label: `${version} · QA CAD 节点图 ${version}` });
  await input('toId').selectOption('m-chen');
  await input('notes').fill(`请按 ${version} 进行制作，替代版本需要重新确认。`);
  await submit();
}
async function receive(version) {
  const card = page.locator('.record-card').filter({ hasText: `QA CAD 节点图 ${version}` }).filter({ has: page.getByRole('button', { name: /核对并接收/ }) });
  await card.getByRole('button', { name: /核对并接收/ }).click();
  await expect(dialog().getByRole('heading', { name: `QA CAD 节点图 ${version} · ${version}`, exact: true })).toBeVisible();
  const href = await dialog().getByRole('link', { name: /核对执行版本/ }).getAttribute('href');
  const response = await context.request.get(new URL(href, baseURL).href);
  expect(response.status()).toBe(200);
  await input('notes').fill(`${version} 已核对，接收并按此版本执行。`);
  await submit('确认接收此版本');
}
async function milestone(action, notes, accepted = true, title = '') {
  await page.getByRole('tab', { name: '阶段工作', exact: true }).click();
  await button(action).click();
  if (title) await input('title').fill(title);
  await input('notes').fill(notes);
  await input('ownerId').selectOption('m-lin');
  await submit(accepted ? action === '登记现场落地' ? '确认落地并完成项目' : '通过，继续推进' : '不通过，安排整改');
}
async function noHorizontalOverflow() {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

try {
  await page.goto(baseURL);
  await expect(page.getByRole('heading', { name: '项目总览.' })).toBeVisible();
  await check('桌面初始布局 1440px 无页面横向溢出', noHorizontalOverflow);
  await page.screenshot({ path: path.join(output, 'desktop-overview.png'), fullPage: true });
  await check('周予安的我的工作显示客户验收登记，切换组长后按职责变化', async () => {
    await switchMember('m-zhou');
    await navigate('/work');
    const acceptance = page.locator('.work-item').filter({ hasText: '客户验收' }).filter({ has: page.getByRole('heading', { name: '登记客户验收结果', exact: true }) });
    await expect(acceptance.first()).toBeVisible();
    await expect(acceptance.first().getByRole('button', { name: '登记结果', exact: true })).toBeVisible();
    await switchMember('m-chen');
    await expect(page.getByRole('heading', { name: '登记客户验收结果', exact: true })).toHaveCount(0);
  });

  let normal;
  await check('新建项目，同一稳定身份兼任经理与绘图员', async () => {
    normal = await createProject('QA 正常推进演示项目');
    expect(normal.managerId).toBe('m-lin');
    expect(normal.drafterId).toBe('m-lin');
    await expect(page.locator('.role-list')).toContainText('林知夏');
  });
  await check('任务完成与业务阶段分开；新增协作任务可查看分享实际内容', async () => {
    await addTask('QA CAD 绘制任务', 'm-su');
    await page.getByLabel('QA CAD 绘制任务状态', { exact: true }).selectOption('done');
    await stage('设计出图');
    await page.locator('.task-copy').filter({ has: page.locator('.task-title').filter({ hasText: /^QA CAD 绘制任务$/ }) }).click();
    await dButton('复制任务摘要与定位链接').click();
    let shared;
    const fallback = page.getByRole('dialog', { name: '复制任务摘要', exact: true });
    if (await fallback.count()) {
      shared = await fallback.getByLabel('任务分享内容').inputValue();
      await fallback.getByRole('button', { name: '完成', exact: true }).click();
    } else {
      shared = await page.evaluate(() => navigator.clipboard.readText());
      await dButton('关闭窗口').click();
    }
    expect(shared).toContain('QA CAD 绘制任务');
    expect(shared).toContain('主负责人：林知夏');
    expect(shared).toContain('?task=');
    expect(shared).toContain('未发送至微信或钉钉');
  });
  await check('确认 CAD V1，发起指定版本交接，接收前停留设计出图', async () => {
    await addArtifact('drawing', 'V1', 'QA CAD 节点图 V1');
    await handoff('V1');
    await stage('设计出图');
    const saved = await state();
    expect(saved.handoffs.find(h => h.projectId === normal.id).status).toBe('pending');
  });
  await check('成员视角：协作任务、待接收交接与资料确认按身份同步', async () => {
    await switchMember('m-su');
    await navigate('/work');
    await expect(page.locator('.task-copy').filter({ has: page.locator('.task-title').filter({ hasText: /^QA CAD 绘制任务$/ }) })).toBeVisible();
    await expect(page.locator('.work-group').filter({ hasText: '等待我接收' })).not.toContainText(normal.name);
    await switchMember('m-chen');
    await expect(page.locator('.record-card').filter({ hasText: normal.name })).toContainText('V1');
  });
  await check('手机 390px 核对 HTTP 200 资料、填写意见并接收交接', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await noHorizontalOverflow();
    await page.locator('.record-card').filter({ hasText: normal.name }).getByRole('button', { name: /核对并接收/ }).click();
    const href = await dialog().getByRole('link', { name: /核对执行版本/ }).getAttribute('href');
    expect((await context.request.get(new URL(href, baseURL).href)).status()).toBe(200);
    const [asset] = await Promise.all([page.waitForEvent('popup'), dialog().getByRole('link', { name: /核对执行版本/ }).click()]);
    await asset.waitForLoadState('domcontentloaded');
    expect(asset.url()).toBe(new URL(href, baseURL).href);
    await expect(asset.locator('svg')).toBeVisible();
    await asset.close();
    await input('notes').fill('手机核对 V1，尺寸与节点无误，可以开始打样。');
    await noHorizontalOverflow();
    await page.screenshot({ path: path.join(output, 'mobile-receive.png'), fullPage: true });
    await submit('确认接收此版本');
    await navigate(`/project/${normal.id}`);
    await stage('打样');
    await expect(page.locator('.execution-version')).toContainText('V1');
  });
  await check('手机明确选择更新任务，刷新后状态保留', async () => {
    await page.getByLabel('QA CAD 绘制任务状态', { exact: true }).selectOption('review');
    await page.reload();
    await expect(page.getByLabel('QA CAD 绘制任务状态', { exact: true })).toHaveValue('review');
    await stage('打样');
    await noHorizontalOverflow();
    await page.screenshot({ path: path.join(output, 'mobile-project.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await check('样品指定确认人视角，确认后进入预搭建', async () => {
    await switchMember('m-lin');
    await page.getByRole('tab', { name: /成果与版本/ }).click();
    await button('新增资料').click();
    await input('kind').selectOption('sample');
    await input('version').fill('S1');
    await input('title').fill('QA 材料与收口样品');
    await input('confirmerId').selectOption('m-lin');
    await input('notes').fill('包含金属收口和饰面色板。');
    await submit();
    await navigate('/work');
    const item = page.locator('.work-item').filter({ hasText: 'QA 材料与收口样品' });
    await expect(item).toBeVisible();
    await item.getByRole('button', { name: '查看并确认', exact: true }).click();
    await input('notes').fill('色板、收口和材料均符合要求。');
    await submit('确认通过');
    await navigate(`/project/${normal.id}`);
    await stage('工厂预搭建');
  });
  await check('组长预搭建 → 客户通过 → 现场落地完成，实际时间保存', async () => {
    await switchMember('m-chen');
    await navigate('/work');
    const workItem = page.locator('.work-item').filter({ hasText: normal.name });
    await expect(workItem).toContainText('记录工厂预搭建结果');
    await workItem.getByRole('button', { name: '登记结果', exact: true }).click();
    await input('notes').fill('工厂完整预搭建，尺寸与结构均检查通过。');
    await submit('通过，继续推进');
    await navigate(`/project/${normal.id}`);
    await stage('客户验收');
    await switchMember('m-lin');
    await milestone('登记客户验收', '客户现场确认通过，按 V1 落地。');
    await stage('现场落地');
    await milestone('登记现场落地', '现场安装完成，按确认图纸实施并复核。');
    await stage('已完成');
    const p = (await state()).projects.find(p => p.id === normal.id);
    expect(p.completedAt).toBeTruthy();
    expect(p.plannedDate).not.toBe(p.completedAt);
    await page.screenshot({ path: path.join(output, 'desktop-completed-project.png'), fullPage: true });
  });
  await check('总览与详情保持一致，页面刷新后完成阶段保留', async () => {
    await navigate('/projects');
    const card = page.locator('.project-card').filter({ has: page.getByRole('heading', { name: normal.name, exact: true }) });
    await expect(card).toContainText('已完成');
    await page.reload();
    await expect(card).toContainText('已完成');
    await card.click();
    await stage('已完成');
  });

  let rework;
  await check('第二项目说明原因跳过打样，保留原因并进入预搭建', async () => {
    rework = await createProject('QA 返工与跳过打样项目');
    await addArtifact('drawing', 'V1', 'QA CAD 节点图 V1');
    await handoff('V1');
    await switchMember('m-chen');
    await receive('V1');
    await page.getByRole('tab', { name: '阶段工作', exact: true }).click();
    await stage('打样');
    await button('不适用，跳过打样').click();
    await input('notes').fill('复用已验证标准构件和材料，无需重新打样。');
    await submit('记录原因并继续');
    await stage('工厂预搭建');
    await expect(page.locator('.phase-card')).toContainText('复用已验证标准构件');
    await milestone('记录预搭建结果', '预搭建完成，提交客户验收。');
  });
  await check('客户不通过：保留首轮意见，自动建立明确负责人的整改任务', async () => {
    await switchMember('m-lin');
    await milestone('登记客户验收', '主展台收口间隙过大，需要更新 CAD 节点尺寸。', false, 'QA 客户第一轮验收');
    await stage('客户验收');
    await expect(page.locator('.issue-card')).toContainText('主展台收口间隙过大');
    await expect(page.locator('.issue-card')).toContainText('处理人：林知夏');
    await expect(page.locator('.task-row')).toContainText('整改：主展台收口间隙过大');
  });
  await check('整改任务待验收，新增 CAD V2 再确认交接并保留 V1 历史', async () => {
    const title = '整改：主展台收口间隙过大，需要更新 CAD 节点尺寸。';
    await page.getByLabel(`${title}状态`, { exact: true }).selectOption('review');
    await expect(page.locator('.issue-card .badge')).toHaveText('待再次确认');
    await addArtifact('drawing', 'V2', 'QA CAD 节点图 V2', '根据客户第一轮意见更新收口间隙和节点尺寸。');
    await handoff('V2');
    await switchMember('m-chen');
    await receive('V2');
    await expect(page.locator('.execution-version')).toContainText('V2');
    await expect(page.locator('.record-card').filter({ hasText: 'QA CAD 节点图 V1' })).toContainText('已接收');
    const saved = await state();
    expect(saved.artifacts.filter(a => a.projectId === rework.id && a.kind === 'drawing').map(a => a.version).sort()).toEqual(['V1', 'V2']);
    expect(saved.handoffs.filter(h => h.projectId === rework.id && h.status === 'accepted')).toHaveLength(2);
  });
  await check('再次确认整改闭环后再登记客户通过，保留两轮客户结果', async () => {
    await switchMember('m-lin');
    await navigate('/work');
    const myIssue = page.locator('.issue-card').filter({ hasText: '主展台收口间隙过大' });
    await expect(myIssue).toContainText('待再次确认');
    await myIssue.getByRole('button', { name: '再次确认整改', exact: true }).click();
    await input('notes').fill('复核 V2 图纸及现场收口，间隙已修正。');
    await submit('整改确认通过');
    await navigate(`/project/${rework.id}`);
    await expect(page.locator('.issue-card .badge')).toHaveText('已闭环');
    await stage('客户验收');
    await milestone('登记客户验收', '客户复核 V2 后验收通过。', true, 'QA 客户第二轮验收');
    await stage('现场落地');
    await page.getByRole('tab', { name: /成果与版本/ }).click();
    await expect(page.locator('.artifact-card').filter({ hasText: 'QA 客户第一轮验收' })).toContainText('待修改');
    await expect(page.locator('.artifact-card').filter({ hasText: 'QA 客户第二轮验收' })).toContainText('已确认');
    await page.screenshot({ path: path.join(output, 'desktop-rework-history.png'), fullPage: true });
    await page.reload();
    await page.getByRole('tab', { name: '阶段工作', exact: true }).click();
    await expect(page.locator('.issue-card')).toContainText('复核 V2 图纸');
    await stage('现场落地');
  });
  await check('停用成员：新分配排除、历史署名保留、未完成工作提示交接', async () => {
    await navigate('/members');
    const memberCard = page.locator('.member-card').filter({ has: page.getByRole('heading', { name: '苏禾', exact: true }) });
    await memberCard.getByRole('button', { name: '停用成员', exact: true }).click();
    await expect(memberCard.locator('.member-status')).toHaveText('停用');
    await expect(memberCard.locator('.member-transfer')).toContainText('需交接');
    await navigate('/projects');
    await button('新建项目').click();
    expect(await input('drafterId').locator('option[value="m-su"]').count()).toBe(0);
    await dButton('取消').click();
    await navigate('/project/p-atrium');
    await expect(page.locator('.task-row').filter({ hasText: '核对现场尺寸与出图清单' })).toContainText('苏禾');
    const saved = await state();
    expect(saved.members.find(m => m.id === 'm-su').active).toBe(false);
    expect(saved.tasks.some(t => t.ownerId === 'm-su')).toBe(true);
  });
  await check('停用默认经理与组长后，新分配排除且原项目/任务仍可编辑', async () => {
    await navigate('/members');
    for (const name of ['林知夏', '陈屿']) {
      const card = page.locator('.member-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
      await card.getByRole('button', { name: '停用成员', exact: true }).click();
    }
    await navigate('/projects');
    await button('新建项目').click();
    for (const field of ['managerId', 'drafterId', 'leadId', 'drawingConfirmerId', 'sampleConfirmerId', 'clientConfirmerId']) {
      await expect(input(field).locator('option[value="m-lin"]')).toHaveCount(0);
      await expect(input(field).locator('option[value="m-chen"]')).toHaveCount(0);
    }
    await dButton('取消').click();
    await navigate('/project/p-atrium');
    await button('新增任务').click();
    await expect(input('ownerId').locator('option[value="m-lin"]')).toHaveCount(0);
    await dButton('取消').click();
    await button('编辑项目').click();
    await expect(input('managerId')).toHaveValue('m-lin');
    await input('location').fill('上海 · 历史角色编辑验证');
    await submit();
    await button('查看任务 完善 CAD 灯光与节点图').click();
    await expect(input('ownerId')).toHaveValue('m-lin');
    await input('status').selectOption('review');
    await submit();
    const saved = await state();
    expect(saved.projects.find(p => p.id === 'p-atrium').managerId).toBe('m-lin');
    const historicalTask = saved.tasks.find(t => t.id === 't-atrium-cad');
    expect(historicalTask.ownerId).toBe('m-lin');
    expect(historicalTask.collaboratorIds).toContain('m-su');
    expect(historicalTask.status).toBe('review');
  });
  await check('示例恢复入口实际生效，清除测试修改并按当前日期恢复', async () => {
    await page.locator('.sidebar').getByRole('button', { name: '恢复示例数据', exact: true }).click();
    await submit('确认恢复示例');
    await expect(page.getByRole('heading', { name: '项目总览.' })).toBeVisible();
    const saved = await state();
    expect(saved.projects.some(p => p.name.startsWith('QA '))).toBe(false);
    expect(saved.members.find(m => m.id === 'm-su').active).toBe(true);
    const current = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    expect(saved.seedDate).toBe(current);
  });
  await check('全部场景无浏览器 console error 或未捕获异常', async () => expect(errors).toEqual([]));
  writeFileSync(path.join(output, 'e2e-results.json'), JSON.stringify({ baseURL, ranAt: new Date().toISOString(), browserVersion: browser.version(), checks, consoleErrors: errors }, null, 2));
  console.log(`\n${checks.length} UI checks passed. Evidence: ${output}`);
} catch (error) {
  checks.push({ title: 'run failure', passed: false, error: error.message });
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  writeFileSync(path.join(output, 'e2e-results.json'), JSON.stringify({ baseURL, ranAt: new Date().toISOString(), checks, consoleErrors: errors }, null, 2));
  console.error(error);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
