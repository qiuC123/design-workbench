import { chromium, expect } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';
const output = path.resolve('work/boss-qa');
const key = 'xu-jian-schedule-v2';
mkdirSync(output, { recursive: true });
const checks = [], errors = [];
let browser;
try { browser = await chromium.launch({ headless: true }); }
catch { const cached = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright/chromium-1234/chrome-win64/chrome.exe'); browser = await chromium.launch(existsSync(cached) ? { headless: true, executablePath: cached } : { headless: true, channel: 'msedge' }); }
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
const page = await context.newPage();
function track(p) { p.setDefaultTimeout(12000); p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(`${m.text()} ${m.location().url}`.trim()); }); }
track(page);
const dialog = () => page.getByRole('dialog');
const button = name => page.getByRole('button', { name, exact: true });
const dButton = name => dialog().getByRole('button', { name, exact: true });
const input = name => dialog().locator(`[name="${name}"]`);
const state = () => page.evaluate(k => JSON.parse(localStorage.getItem(k)), key);
const addDays = (date, n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const future = addDays(today, 35), weekday = new Date(`${future}T12:00:00Z`).getUTCDay();
const D = addDays(future, -((weekday + 6) % 7));
const fmt = date => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
async function check(title, run) { await run(); checks.push({ title, passed: true }); console.log(`PASS ${title}`); }
async function navigate(href) { await page.goto(`${baseURL}/#${href}`); }
async function submit(name) { await dButton(name).click(); await expect(dialog(), 'successful business form closes').toHaveCount(0); }
async function noOverflow(p = page) { expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); }
async function project(name) { return (await state()).projects.find(p => p.name === name); }
async function createProject(name) {
  await navigate('/projects'); await button('新建项目').click();
  await input('name').fill(name); await input('client').fill('虚构排班验证客户'); await input('contact').fill('QA 联系人 · 商务沟通');
  await input('location').fill('上海 · 虚构展厅'); await input('startDate').fill(D); await input('endDate').fill(addDays(D, 13));
  await input('note').fill('老板单人安排，经理先定、组长后定。'); await submit('创建项目');
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible(); return project(name);
}
const roleSlot = role => page.locator('.b-detail-roles .b-role-slot').filter({ hasText: role === 'manager' ? '项目经理' : '项目组长' });
async function openRole(p, role) { await navigate(`/project/${p.id}`); await roleSlot(role).getByRole('button').click(); }
async function assign(p, role, memberId, start, end, overlap = false) {
  await openRole(p, role); await input('endDate').fill(end); await input('startDate').fill(start); await input('memberId').selectOption(memberId);
  if (overlap) { await expect(dialog().locator('.b-conflict-info')).toContainText('与其他项目日期重叠'); await expect(dialog().locator('.b-conflict-info')).toContainText('保存不会被阻止'); }
  await submit('保存安排');
}
async function schedule(date) { await navigate('/schedule'); await page.getByLabel('查看日期', { exact: true }).fill(date); }
const desktopMember = id => page.locator(`.b-team-row[data-member-id="${id}"]`);
const mobileMember = id => page.locator(`.b-member-card[data-member-id="${id}"]`);
async function availability(id, text, mobile = false) { await expect((mobile ? mobileMember(id) : desktopMember(id)).locator('.b-availability')).toHaveText(text); }
let migrationContext;
try {
  await page.goto(baseURL); await expect(page.getByRole('heading', { name: '人员排班.' })).toBeVisible();
  await check('老板单人入口：无身份切换、我的工作、资料确认或审批；桌面1440px无横溢', async () => {
    await expect(page.getByText('老板视角', { exact: true })).toBeVisible();
    expect(await page.getByLabel('演示成员', { exact: true }).count()).toBe(0);
    expect(await page.getByRole('button', { name: /我的工作|确认成果|确认图纸|审批/ }).count()).toBe(0); await noOverflow();
  });
  await page.screenshot({ path: path.join(output, 'desktop-initial-schedule.png'), fullPage: true });
  let a, b;
  await check('新项目空角色，先安排经理及日期，组长仍待定', async () => {
    a = await createProject('QA 项目 A · 先经理后组长'); expect(a.managerId).toBe(''); expect(a.leadId).toBe('');
    await expect(roleSlot('lead')).toContainText('可以稍后确定');
    await assign(a, 'manager', 'm-lin', D, addDays(D, 3));
    const saved = await project(a.name); expect(saved.managerId).toBe('m-lin'); expect(saved.leadId).toBe('');
    expect(saved.managerStartDate).toBe(D); expect(saved.managerEndDate).toBe(addDays(D, 3));
    await expect(roleSlot('lead').getByRole('button', { name: '安排组长', exact: true })).toBeVisible();
  });
  await check('后安排组长，两种角色日期分别展示，周排班与选定日一致', async () => {
    await assign(a, 'lead', 'm-chen', addDays(D, 2), addDays(D, 6));
    await expect(roleSlot('manager')).toContainText(`${fmt(D)} — ${fmt(addDays(D, 3))}`);
    await expect(roleSlot('lead')).toContainText(`${fmt(addDays(D, 2))} — ${fmt(addDays(D, 6))}`);
    await schedule(D); await availability('m-lin', '已安排 1 项'); await availability('m-chen', '空闲');
    await expect(desktopMember('m-lin').getByRole('button', { name: `调整 ${a.name} 项目经理`, exact: true })).toBeVisible();
    await expect(desktopMember('m-chen').getByRole('button', { name: `调整 ${a.name} 项目组长`, exact: true })).toBeVisible();
    await page.locator('.b-days').getByRole('button', { name: `查看${addDays(D, 2)}排班`, exact: true }).click();
    await availability('m-chen', '已安排 1 项'); await expect(page.getByLabel('查看日期')).toHaveValue(addDays(D, 2)); await noOverflow();
  });
  await check('同人兼任同项目两种职责，当天只按一个项目计数', async () => {
    await assign(a, 'lead', 'm-lin', D, addDays(D, 3)); await schedule(D);
    await availability('m-lin', '已安排 1 项'); await availability('m-chen', '空闲');
    expect(await desktopMember('m-lin').locator('.b-booking').count()).toBe(2);
    await expect(page.locator('.b-board-note')).toContainText('同一人兼任同项目按 1 个项目计数');
  });
  await check('跨项目日期重叠提示但允许保存，当天项目数为2', async () => {
    b = await createProject('QA 项目 B · 允许并行统筹'); await assign(b, 'manager', 'm-lin', D, addDays(D, 2), true); await schedule(D);
    await availability('m-lin', '已安排 2 项 · 日期重叠'); await expect(desktopMember('m-lin')).toContainText(a.name); await expect(desktopMember('m-lin')).toContainText(b.name);
    await page.screenshot({ path: path.join(output, 'desktop-overlap-schedule.png'), fullPage: true });
  });
  await check('清空或反向日期不白屏，错误在表单内可修正', async () => {
    await openRole(a, 'manager'); await input('startDate').fill(''); await expect(dialog()).toBeVisible();
    await input('startDate').fill(addDays(D, 5)); await input('endDate').fill(addDays(D, 4)); await input('memberId').selectOption('m-su');
    await dButton('保存安排').click(); await expect(dialog()).toBeVisible();
    await expect(dialog().getByRole('alert')).toContainText('结束日期不能早于开始日期');
    await input('endDate').fill(addDays(D, 6)); await input('startDate').fill(addDays(D, 4)); await submit('保存安排');
  });
  await check('调日期与改派后，旧人空闲、新人项目安排同步变化', async () => {
    await openRole(a, 'lead'); await dButton('取消此角色安排').click(); await expect(dialog()).toHaveCount(0);
    await schedule(addDays(D, 4)); await availability('m-lin', '空闲'); await availability('m-su', '已安排 1 项'); await expect(desktopMember('m-su')).toContainText(a.name);
    await assign(a, 'manager', 'm-wang', addDays(D, 4), addDays(D, 6)); await schedule(addDays(D, 4));
    await availability('m-su', '空闲'); await availability('m-wang', '已安排 1 项'); await expect(desktopMember('m-wang')).toContainText(a.name);
  });
  await check('取消安排释放排期，项目恢复角色待分配', async () => {
    await openRole(a, 'manager'); await dButton('取消此角色安排').click(); await expect(dialog()).toHaveCount(0);
    await expect(roleSlot('manager')).toContainText('尚未分配'); await schedule(addDays(D, 4)); await availability('m-wang', '空闲');
  });
  await check('手机390px选日期、查看当天每人项目、实际分配与修改人选日期', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await schedule(addDays(D, 4)); await noOverflow();
    await page.locator('.b-mobile-daystrip').getByRole('button', { name: `查看${addDays(D, 5)}排班`, exact: true }).click();
    await expect(page.getByLabel('查看日期')).toHaveValue(addDays(D, 5)); await availability('m-wang', '空闲', true);
    await mobileMember('m-wang').getByRole('button', { name: '安排项目', exact: true }).click();
    await input('projectId').selectOption(a.id); await input('role').selectOption('manager'); await input('endDate').fill(addDays(D, 6)); await input('startDate').fill(addDays(D, 4)); await input('memberId').selectOption('m-wang');
    await noOverflow(); await submit('保存安排'); await availability('m-wang', '已安排 1 项', true); await expect(mobileMember('m-wang')).toContainText(a.name);
    await mobileMember('m-wang').locator('.b-today-item').filter({ hasText: a.name }).click();
    await input('endDate').fill(addDays(D, 8)); await input('startDate').fill(addDays(D, 7)); await input('memberId').selectOption('m-su'); await noOverflow();
    await page.screenshot({ path: path.join(output, 'mobile-adjust-assignment.png'), fullPage: true }); await submit('保存安排');
    await availability('m-wang', '空闲', true); await availability('m-su', '空闲', true); await page.getByLabel('查看日期').fill(addDays(D, 7));
    await availability('m-su', '已安排 1 项', true); await expect(mobileMember('m-su')).toContainText(a.name); await noOverflow();
    await page.screenshot({ path: path.join(output, 'mobile-day-schedule.png'), fullPage: true });
  });
  await check('刷新保留；完成释放人员排班，历史人选与日期保留', async () => {
    await page.reload(); await page.getByLabel('查看日期').fill(addDays(D, 7)); await availability('m-su', '已安排 1 项', true); await navigate(`/project/${a.id}`);
    await expect(roleSlot('manager')).toContainText('苏禾'); await expect(roleSlot('manager')).toContainText(`${fmt(addDays(D, 7))} — ${fmt(addDays(D, 8))}`);
    await page.getByLabel(`${a.name}项目状态`, { exact: true }).selectOption('done'); await expect(page.locator('.b-board-note')).toContainText('排班占用已释放');
    expect((await project(a.name)).managerId).toBe('m-su'); expect((await project(a.name)).completedAt).toBeTruthy();
    await schedule(addDays(D, 7)); await availability('m-su', '空闲', true); await page.reload(); await page.getByLabel('查看日期').fill(addDays(D, 7)); await availability('m-su', '空闲', true);
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await check('停用成员不用于新分配，历史角色保留且提示改派', async () => {
    await navigate('/team'); const member = page.locator('.b-member-item').filter({ hasText: '林知夏' });
    await member.getByRole('button', { name: '停用', exact: true }).click(); await expect(member).toContainText('已停用'); await expect(member).toContainText('原项目安排保留，请改派');
    await navigate(`/project/${b.id}`); await expect(roleSlot('manager')).toContainText('林知夏'); await expect(roleSlot('manager')).toContainText('需改派');
    await roleSlot('lead').getByRole('button', { name: '安排组长', exact: true }).click(); expect(await input('memberId').locator('option[value="m-lin"]').count()).toBe(0); await dButton('关闭').click();
    await schedule(D); expect(await desktopMember('m-lin').count()).toBe(0); expect((await state()).projects.find(p => p.id === b.id).managerId).toBe('m-lin');
  });
  await check('项目列表同步状态与历史负责人，原任务流程入口已移除', async () => {
    await navigate('/projects'); const row = page.locator(`.b-project-row[data-project-id="${a.id}"]`);
    await expect(row.getByLabel(`${a.name}项目状态`)).toHaveValue('done'); await expect(row).toContainText('苏禾'); await noOverflow();
    expect(await page.getByRole('button', { name: /我的工作|发起图纸交接|确认成果|审批/ }).count()).toBe(0);
    await page.screenshot({ path: path.join(output, 'desktop-project-arrangements.png'), fullPage: true });
  });
  await check('独立旧fixture迁入项目成员，旧key原字节保留，新排期说明初始建议', async () => {
    // Only migration injects synthetic v1 data. Main business scenarios above use
    // visible UI only, with localStorage reads solely for additional assertions.
    const fixture = { schemaVersion: 1, seedDate: today, currentMemberId: 'old-manager',
      members: [{ id: 'old-manager', name: '迁移经理', role: '项目经理', color: '#647f71', active: true }, { id: 'old-lead', name: '迁移组长', role: '项目组长', color: '#637fa3', active: true }],
      contacts: [{ id: 'old-contact', name: '迁移联系人', company: '迁移客户', external: true }],
      projects: [{ id: 'old-project', name: '旧版项目 · 排班迁移验证', client: '迁移客户', contactId: 'old-contact', managerId: 'old-manager', drafterId: 'old-manager', leadId: 'old-lead', drawingConfirmerId: 'old-manager', sampleConfirmerId: 'old-manager', clientConfirmerId: 'old-manager', handlerId: 'old-lead', stage: 'design', dueDate: addDays(today, 3), plannedDate: addDays(today, 12), location: '上海 · 迁移场地', description: '旧版项目基本信息应保留', blockedReason: '', createdAt: `${today}T09:00:00+08:00` }], tasks: [], artifacts: [], handoffs: [], issues: [], activities: [] };
    const raw = JSON.stringify(fixture);
    migrationContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
    await migrationContext.addInitScript(value => { if (localStorage.getItem('xu-jian-workbench-v1') === null) localStorage.setItem('xu-jian-workbench-v1', value); }, raw);
    const migrated = await migrationContext.newPage(); track(migrated); await migrated.goto(baseURL);
    await expect(migrated.locator('.b-migration')).toContainText('新增排班日期是初始建议'); await migrated.goto(`${baseURL}/#/project/old-project`);
    await expect(migrated.getByRole('heading', { name: '旧版项目 · 排班迁移验证', exact: true })).toBeVisible(); await expect(migrated.locator('.b-detail-roles')).toContainText('迁移经理'); await expect(migrated.locator('.b-detail-roles')).toContainText('迁移组长');
    await expect(migrated.locator('.b-definition')).toContainText('上海 · 迁移场地'); await expect(migrated.locator('.b-definition')).toContainText('迁移联系人 · 迁移客户');
    const saved = await migrated.evaluate(k => ({ old: localStorage.getItem('xu-jian-workbench-v1'), next: JSON.parse(localStorage.getItem(k)) }), key);
    expect(saved.old).toBe(raw); expect(saved.next.version).toBe(2); expect(saved.next.projects[0].id).toBe('old-project'); expect(saved.next.projects[0].managerId).toBe('old-manager'); expect(saved.next.projects[0].leadId).toBe('old-lead'); expect(saved.next.projects[0].note).toContain('排期为建议值');
    await migrated.reload(); await expect(migrated.locator('.b-migration')).toBeVisible(); await migrated.screenshot({ path: path.join(output, 'desktop-migration.png'), fullPage: true }); await migrationContext.close(); migrationContext = undefined;
  });
  await check('恢复示例实际生效、日期按当天生成，全部场景无console error或未捕获异常', async () => {
    await page.locator('.sidebar').getByRole('button', { name: '恢复示例数据', exact: true }).click(); await submit('确认恢复示例');
    await expect(page.getByLabel('查看日期')).toHaveValue(today); expect((await state()).projects.some(p => p.name.startsWith('QA '))).toBe(false); expect((await state()).members.find(m => m.id === 'm-lin').active).toBe(true); expect(errors).toEqual([]);
  });
  writeFileSync(path.join(output, 'e2e-results.json'), JSON.stringify({ baseURL, ranAt: new Date().toISOString(), browserVersion: browser.version(), selectedTestMonday: D, checks, consoleErrors: errors, fixtureScope: 'Only migration uses synthetic v1 localStorage. Main scenarios use visible UI only.' }, null, 2));
  console.log(`\n${checks.length} boss scheduling UI checks passed. Evidence: ${output}`);
} catch (error) {
  checks.push({ title: 'run failure', passed: false, error: error.message }); await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  writeFileSync(path.join(output, 'e2e-results.json'), JSON.stringify({ baseURL, ranAt: new Date().toISOString(), checks, consoleErrors: errors }, null, 2)); console.error(error); process.exitCode = 1;
} finally { if (migrationContext) await migrationContext.close(); await context.close(); await browser.close(); }
