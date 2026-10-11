import { chromium, expect } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Business scenarios operate the visible UI. State reads provide additional
// assertions; only an isolated migration scenario injects synthetic old data.
const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';
const output = path.resolve('docs/verification/taskboard');
const key = 'xu-jian-tasks-v3';
const advisoryOnly = process.argv.includes('--advisory-only');
const evidencePrefix = advisoryOnly ? 'advisory' : 'qa';
mkdirSync(output, { recursive: true });
const checks = [], errors = [];
let browser;
try { browser = await chromium.launch({ headless: true }); }
catch {
  const cached = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright/chromium-1234/chrome-win64/chrome.exe');
  browser = await chromium.launch(existsSync(cached) ? { headless: true, executablePath: cached } : { headless: true, channel: 'msedge' });
}
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
const page = await context.newPage();
function track(p) {
  p.setDefaultTimeout(12000);
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push(`${m.text()} ${m.location().url}`.trim()); });
}
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
async function check(title, run) { await run(); checks.push({ title, passed: true }); console.log(`PASS ${title}`); }
async function navigate(href) { await page.goto(`${baseURL}/#${href}`); }
async function noOverflow(p = page) { expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth)).toBe(true); }
async function shot(name, p = page) {
  const closeToast = p.getByRole('button', { name: '关闭提示', exact: true });
  if (await closeToast.count()) await closeToast.click();
  const hasDialog = await p.getByRole('dialog').count() > 0;
  if (!hasDialog) await p.evaluate(() => window.scrollTo(0, 0));
  // Fixed controls and dialog backdrops are represented faithfully by viewport screenshots.
  await p.screenshot({ path: path.join(output, `${evidencePrefix}-${name}.png`), fullPage: p.viewportSize().width > 500 && !hasDialog });
}
function report() {
  writeFileSync(path.join(output, `${evidencePrefix}-results.json`), JSON.stringify({ baseURL, ranAt: new Date().toISOString(), browserVersion: browser.version(), selectedTestMonday: D, checks, consoleErrors: errors, fixtureScope: advisoryOnly ? 'Independent browser context. All projects and tasks created and edited through visible UI; localStorage is read only for assertions.' : 'Only migration uses synthetic v2 localStorage. Main scenarios use visible UI only.' }, null, 2));
}

const card = id => page.locator(`.tw-task-card[data-task-id="${id}"]`);
const desktopMember = id => page.locator(`.tw-person-row[data-member-id="${id}"]`);
const mobileMember = id => page.locator(`.tw-mobile-person[data-member-id="${id}"]`);
const getProject = async name => (await state()).projects.find(p => p.name === name);
const getTask = async title => (await state()).tasks.find(t => t.title === title);
async function submit(name) { await dButton(name).click(); await expect(dialog()).toHaveCount(0); }
async function availability(id, text, mobile = false) { await expect((mobile ? mobileMember(id) : desktopMember(id)).locator('.tw-availability')).toHaveText(text); }
async function schedule(date, projectId) { await navigate(projectId ? `/project/${projectId}/schedule` : '/schedule'); await page.getByLabel('查看日期', { exact: true }).fill(date); }
async function openTask(task) { await navigate(`/project/${task.projectId}/board`); await card(task.id).getByRole('button', { name: `打开任务 ${task.title}`, exact: true }).click(); }
async function createProject(name) {
  await navigate('/projects'); await button('新建项目').click(); await input('name').fill(name); await input('client').fill('虚构验收客户'); await input('contact').fill('QA 客户联系人');
  await input('managerId').selectOption('member-one'); await input('status').selectOption('active');
  await input('startDate').fill(D); await input('endDate').fill(addDays(D, 13)); await input('location').fill('上海 · 虚构测试展厅'); await input('note').fill('任务负责人决定排班，项目经理仅负责统筹。');
  await submit('创建项目'); await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible(); return getProject(name);
}
const ownerOption = id => dialog().locator(`input[name="ownerIds"][value="${id}"]`);
async function showOwnerOptions() {
  const add = dButton('添加负责人');
  if (await add.count()) await add.click();
  await expect(input('ownerIds')).toHaveCount(5);
}
async function setOwners(owners) {
  const ids = Array.isArray(owners) ? owners : owners ? [owners] : [];
  await showOwnerOptions();
  const options = input('ownerIds');
  for (let index = 0; index < await options.count(); index++) {
    const option = options.nth(index);
    await option.setChecked(ids.includes(await option.getAttribute('value')));
  }
}
async function setContacts(contacts) {
  const ids = Array.isArray(contacts) ? contacts : contacts ? [contacts] : [];
  const add = dButton('添加对接人');
  if (await add.count()) await add.click();
  const options = input('contactIds');
  await expect(options).toHaveCount(6);
  for (let index = 0; index < await options.count(); index++) {
    const option = options.nth(index);
    await option.setChecked(ids.includes(await option.getAttribute('value')));
  }
}
async function fillTask(project, title, owners, contacts, start, end) {
  await input('projectName').fill(project.name); await input('title').fill(title); await setOwners(owners); await setContacts(contacts);
  await input('endDate').fill(end); await input('startDate').fill(start); await input('description').fill('虚构任务：多人可共同负责执行，对接人用于沟通联系，核验结果由老板记录。');
}
async function createTask(project, title, owners, contacts, start, end, overlaps = false) {
  await navigate(`/project/${project.id}/board`); await button('新建任务').click(); await fillTask(project, title, owners, contacts, start, end);
  if (overlaps) { await expect(dialog().locator('.tw-conflict')).toContainText('另有'); await expect(dialog().locator('.tw-conflict')).toContainText('可以保留并行安排'); }
  await submit('创建任务'); return getTask(title);
}
async function mobileTab(status) { await page.locator('.tw-mobile-status').getByRole('button', { name: new RegExp(`^${status} `) }).click(); }

async function advisoryChecks() {
  let project, main, sameOwner, otherOwner;
  await check('可见UI创建项目与计划外任务，任务日期不受项目范围硬性阻挡', async () => {
    project = await createProject('QA 提醒不阻挡排班项目');
    main = await createTask(project, 'QA 延后并改派的主任务', 'member-one', 'boss', D, addDays(D, 2));
    sameOwner = await createTask(project, 'QA 成员一计划外并行任务', 'member-one', 'boss', addDays(D, 15), addDays(D, 20));
    otherOwner = await createTask(project, 'QA 成员二计划外并行任务', 'member-two', 'boss', addDays(D, 15), addDays(D, 20));
    expect(sameOwner.startDate).toBe(addDays(D, 15)); expect(otherOwner.endDate).toBe(addDays(D, 20));
    expect((await getProject(project.name)).endDate).toBe(addDays(D, 13));
  });
  await check('任务延后同时超出项目计划且与同人任务重叠，提醒后保存成功', async () => {
    await openTask(main); await input('endDate').fill(addDays(D, 21));
    await expect(dialog().locator('.tw-overlap-warning')).toContainText(sameOwner.title); await expect(dialog().locator('.tw-overlap-warning')).toContainText('不影响保存');
    await expect(dialog().locator('.tw-plan-warning')).toContainText('可以直接保存'); await noOverflow(); await shot('overlap-and-outside-project'); await submit('保存修改');
    const saved = await getTask(main.title); expect(saved.startDate).toBe(D); expect(saved.endDate).toBe(addDays(D, 21));
    expect((await getProject(project.name)).endDate).toBe(addDays(D, 13));
  });
  await check('改派给仍有重叠任务的人可保存，刷新后人员日期和项目原计划完整保留', async () => {
    await openTask(main); await setOwners('member-two');
    await expect(dialog().locator('.tw-overlap-warning')).toContainText(otherOwner.title); await expect(dialog().locator('.tw-overlap-warning')).toContainText('可以保留并行安排'); await submit('保存修改');
    await page.reload(); const saved = await getTask(main.title); expect(saved.ownerIds).toEqual(['member-two']); expect(saved.startDate).toBe(D); expect(saved.endDate).toBe(addDays(D, 21));
    expect((await getProject(project.name)).endDate).toBe(addDays(D, 13));
    await openTask(main); await showOwnerOptions(); await expect(ownerOption('member-two')).toBeChecked(); await expect(ownerOption('member-one')).not.toBeChecked(); await expect(input('endDate')).toHaveValue(addDays(D, 21)); await dButton('关闭').click();
  });
  await check('周排班按实际任务日期展示计划外区间与并行，任务结束次日释放占用', async () => {
    await schedule(addDays(D, 16), project.id); await availability('member-two', '2 项任务 · 并行');
    await expect(desktopMember('member-two').locator(`[data-task-id="${main.id}"]`)).toBeVisible(); await expect(desktopMember('member-two').locator(`[data-task-id="${otherOwner.id}"]`)).toBeVisible();
    await noOverflow(); await shot('actual-dates-schedule');
    await schedule(addDays(D, 21), project.id); await availability('member-two', '1 项任务');
    const bar = desktopMember('member-two').locator(`[data-task-id="${main.id}"]`); await expect(bar).toBeVisible(); expect(await bar.evaluate(el => el.style.gridColumn)).toBe('1 / span 1');
    await page.getByLabel('查看日期').fill(addDays(D, 22)); await availability('member-two', '当天空闲');
  });
  await check('项目缩期保留超范围任务和实际任务日期，不自动改动任务', async () => {
    const beforeTasks = (await state()).tasks.filter(t => t.projectId === project.id);
    await navigate(`/project/${project.id}/board`); await button('项目信息').click(); await input('endDate').fill(addDays(D, 1));
    await expect(dialog().locator('.tw-plan-warning')).toContainText('3 项任务超出当前项目计划'); await expect(dialog().locator('.tw-plan-warning')).toContainText('可以直接保存'); await shot('shorten-project-advisory'); await submit('保存项目');
    await page.reload(); expect((await getProject(project.name)).endDate).toBe(addDays(D, 1));
    expect((await state()).tasks.filter(t => t.projectId === project.id)).toEqual(beforeTasks);
    await schedule(addDays(D, 16), project.id); await availability('member-two', '2 项任务 · 并行');
  });
  await check('真正的逆序日期在表单内明确报错，未覆盖已保存日期；无浏览器错误', async () => {
    await openTask(main); await input('endDate').fill(addDays(D, -1)); await dButton('保存修改').click();
    await expect(dialog()).toBeVisible(); await expect(dialog().getByRole('alert')).toContainText('结束日期不能早于开始日期');
    expect((await getTask(main.title)).endDate).toBe(addDays(D, 21)); await noOverflow(); await shot('invalid-range-inline-error');
    await dButton('关闭').click(); expect(errors).toEqual([]);
  });
}

let migrationContext;
try {
  if (advisoryOnly) {
    await advisoryChecks();
  } else {
  await navigate('/board');
  await check('全局四列任务看板与五位固定项目经理，界面没有组长安排', async () => {
    for (const label of ['待办', '进行中', '待核验', '已完成']) await expect(page.getByRole('region', { name: `${label}任务列`, exact: true })).toBeVisible();
    await expect(page.locator('.tw-boss')).toContainText('老板视角'); await noOverflow(); await shot('desktop-board');
    await schedule(D); expect(await page.locator('.tw-person-row').count()).toBe(5);
    expect(await page.locator('.tw-person-info > .tw-person-name > strong').allTextContents()).toEqual(['成员一', '成员二', '成员三', '成员四', '成员五']);
    expect(await page.getByText('项目组长', { exact: true }).count()).toBe(0); await noOverflow();
  });
  let a, b, task, first, second, outside, mobileTask;
  await check('创建项目与任务：项目经理、负责人、对接人分别记录', async () => {
    a = await createProject('QA 卡片与排班项目 A');
    task = await createTask(a, 'QA 平面初稿核验', 'member-two', 'member-three', D, addDays(D, 2));
    expect(a.managerId).toBe('member-one'); expect(task.ownerIds).toEqual(['member-two']); expect(task.contactIds).toEqual(['member-three']); expect(task.status).toBe('todo');
    await expect(card(task.id)).toContainText('成员二'); await expect(card(task.id)).toContainText('对接 · 成员三'); expect(Object.hasOwn(a, 'leadId')).toBe(false);
  });
  await check('全局与项目内看板、排班同步；只负责人占用，统筹和对接不重复占用', async () => {
    await navigate('/board'); await expect(card(task.id)).toBeVisible(); await schedule(D);
    await availability('member-two', '1 项任务'); await availability('member-one', '当天空闲'); await availability('member-three', '当天空闲');
    await expect(desktopMember('member-two').locator(`[data-task-id="${task.id}"]`)).toBeVisible();
    await navigate(`/project/${a.id}/board`); await page.locator('.tw-view-switch').getByRole('link', { name: '人员排班', exact: true }).click();
    await page.getByLabel('查看日期').fill(D); await expect(desktopMember('member-two').locator(`[data-task-id="${task.id}"]`)).toBeVisible();
    await expect(page.locator('.tw-content')).toContainText('人员忙闲按所有项目计算'); await noOverflow();
  });
  await check('状态按钮依次从待办到进行中、待核验；待核验仍占用排班', async () => {
    await navigate(`/project/${a.id}/board`); await card(task.id).getByRole('button', { name: `开始任务 ${task.title}`, exact: true }).click();
    await expect(card(task.id)).toHaveAttribute('data-status', 'doing'); await card(task.id).getByRole('button', { name: `提交核验 ${task.title}`, exact: true }).click();
    await expect(card(task.id)).toHaveAttribute('data-status', 'review'); await schedule(D); await availability('member-two', '1 项任务');
    await expect(desktopMember('member-two').locator(`[data-task-id="${task.id}"]`)).toHaveAttribute('data-status', 'review');
  });
  await check('核验退回必须填写意见；回到进行中并保留记录，再次核验通过后完成', async () => {
    await openTask(task); await dButton('退回修改').click(); await expect(dialog().getByRole('alert')).toContainText('请填写核验意见');
    await input('note').fill('尺寸标注需要补充，请调整后再次提交。'); await submit('退回修改');
    await expect(card(task.id)).toHaveAttribute('data-status', 'doing'); await openTask(task); await expect(dialog().locator('.tw-activity')).toContainText('尺寸标注需要补充'); await dButton('关闭').click();
    await card(task.id).getByRole('button', { name: `提交核验 ${task.title}`, exact: true }).click(); await card(task.id).getByRole('button', { name: `处理核验 ${task.title}`, exact: true }).click();
    await input('note').fill('补充尺寸已核对，确认通过。'); await shot('desktop-review'); await submit('核验通过');
    await expect(card(task.id)).toHaveAttribute('data-status', 'done'); expect((await getTask(task.title)).completedAt).toBeTruthy();
    await openTask(task); await expect(dialog().locator('.tw-activity')).toContainText('补充尺寸已核对'); await expect(dialog().locator('.tw-activity')).toContainText('尺寸标注需要补充'); await dButton('关闭').click();
    await schedule(D); await availability('member-two', '当天空闲'); expect(await desktopMember('member-two').locator(`[data-task-id="${task.id}"]`).count()).toBe(0);
  });
  await check('同一负责人多个任务允许日期重叠，同时显示并行提示', async () => {
    first = await createTask(a, 'QA 展陈任务一', 'member-one', 'boss', D, addDays(D, 2));
    second = await createTask(a, 'QA 展陈任务二', 'member-one', 'member-three', D, addDays(D, 1), true);
    await schedule(D); await availability('member-one', '2 项任务 · 并行'); await expect(desktopMember('member-one').locator('.tw-task-bar')).toHaveCount(2); await shot('desktop-overlap');
  });
  await check('编辑任务时日期暂空或逆序不崩溃，改派和调期后同步释放原安排', async () => {
    await openTask(first); await input('startDate').fill(''); await expect(dialog()).toBeVisible(); await expect(dialog().locator('.tw-conflict')).toContainText('有效的起止日期');
    await input('startDate').fill(addDays(D, 5)); await input('endDate').fill(addDays(D, 4)); await dButton('保存修改').click(); await expect(dialog()).toBeVisible(); await expect(dialog().getByRole('alert')).toContainText('结束日期不能早于开始日期');
    await input('endDate').fill(addDays(D, 6)); await input('startDate').fill(addDays(D, 4)); await setOwners('member-five'); await submit('保存修改');
    await openTask(second); await input('endDate').fill(addDays(D, 8)); await input('startDate').fill(addDays(D, 7)); await submit('保存修改');
    await schedule(D); await availability('member-one', '当天空闲'); await availability('member-five', '当天空闲');
    await page.locator('.tw-schedule-head').getByRole('button', { name: `查看${addDays(D, 4)}排班`, exact: true }).click(); await availability('member-five', '1 项任务');
    await expect(page.getByLabel('查看日期')).toHaveValue(addDays(D, 4)); await expect(desktopMember('member-five').locator(`[data-task-id="${first.id}"]`)).toBeVisible();
  });
  await check('项目内只显示本项目任务，但人员忙闲仍考虑其他项目', async () => {
    b = await createProject('QA 卡片与排班项目 B'); outside = await createTask(b, 'QA 其他项目安排', 'member-one', 'boss', addDays(D, 4), addDays(D, 5));
    await schedule(addDays(D, 4), a.id); await availability('member-one', '1 项任务'); expect(await desktopMember('member-one').locator(`[data-task-id="${outside.id}"]`).count()).toBe(0);
    await expect(desktopMember('member-five').locator(`[data-task-id="${first.id}"]`)).toBeVisible();
    await page.getByLabel('仅看当天空闲').check(); expect(await desktopMember('member-one').count()).toBe(0); expect(await desktopMember('member-five').count()).toBe(0); await noOverflow(); await shot('desktop-project-schedule');
  });
  await check('手机390px从选定日期分配任务，卡片按钮可推进及核验，无需拖拽', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await schedule(addDays(D, 4)); await noOverflow();
    await mobileMember('member-four').getByRole('button', { name: '安排任务', exact: true }).click();
    await fillTask(a, 'QA 手机新建任务', 'member-four', 'boss', addDays(D, 4), addDays(D, 5)); await noOverflow(); await shot('mobile-create'); await submit('创建任务');
    mobileTask = await getTask('QA 手机新建任务'); await availability('member-four', '1 项任务', true); await expect(mobileMember('member-four')).toContainText(mobileTask.title); await shot('mobile-day-schedule');
    await navigate(`/project/${a.id}/board`); await mobileTab('待办'); await expect(card(mobileTask.id)).toBeVisible(); await card(mobileTask.id).getByRole('button', { name: `开始任务 ${mobileTask.title}`, exact: true }).click();
    await mobileTab('进行中'); await card(mobileTask.id).getByRole('button', { name: `提交核验 ${mobileTask.title}`, exact: true }).click(); await mobileTab('待核验');
    await card(mobileTask.id).getByRole('button', { name: `处理核验 ${mobileTask.title}`, exact: true }).click(); await input('note').fill('手机核验操作通过。'); await noOverflow(); await submit('核验通过');
    await mobileTab('已完成'); await expect(card(mobileTask.id)).toBeVisible(); await noOverflow(); await shot('mobile-completed');
    await schedule(addDays(D, 4)); await availability('member-four', '当天空闲', true);
  });
  await check('刷新保存改派、日期、已完成任务与核验历史；项目任务统计一致', async () => {
    await page.reload(); await page.getByLabel('查看日期').fill(addDays(D, 4)); await availability('member-five', '1 项任务', true); await availability('member-four', '当天空闲', true);
    await page.setViewportSize({ width: 1440, height: 1000 }); await openTask(task); await expect(dialog().locator('.tw-activity')).toContainText('补充尺寸已核对'); await dButton('关闭').click();
    await navigate('/projects'); const projectCard = page.locator('.tw-project-card').filter({ hasText: a.name }); await expect(projectCard).toContainText('2 / 4 项任务已核验完成'); await noOverflow();
  });
  await check('删除任务需要确认且释放排班，未完成任务不允许项目提前完成', async () => {
    await openTask(second); await dButton('删除任务').click(); await expect(dialog()).toContainText('删除后释放这项任务的排班'); await submit('确认删除');
    await schedule(addDays(D, 7)); await availability('member-one', '当天空闲'); expect((await state()).tasks.some(t => t.id === second.id)).toBe(false);
    await navigate(`/project/${a.id}/board`); await button('项目信息').click(); await input('status').selectOption('done'); await dButton('保存项目').click(); await expect(dialog()).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: /未完成|完成所有|核验/ }).last()).toBeVisible(); await dButton('取消').click();
  });
  await check('待分配提示进入待分配卡片筛选，再切排班恢复全部五人', async () => {
    await navigate('/schedule'); await button('去分配任务').click(); await expect(page.getByLabel('筛选负责人')).toHaveValue('unassigned');
    await expect(page.locator('.tw-task-card')).not.toHaveCount(0);
    expect(await page.locator('.tw-task-card').evaluateAll(cards => cards.every(card => card.textContent.includes('待分配')))).toBe(true);
    await page.locator('.tw-view-switch').getByRole('link', { name: '人员排班', exact: true }).click(); await expect(page.getByLabel('筛选负责人')).toHaveValue('all'); await expect(page.locator('.tw-person-row')).toHaveCount(5);
  });
  await check('点击未来周表日期保留该日期，超出项目计划提醒后仍可保存', async () => {
    const outsideDate = addDays(D, 14); await schedule(outsideDate, a.id);
    await desktopMember('member-four').getByRole('button', { name: `给成员四安排${outsideDate}任务`, exact: true }).click();
    await expect(input('startDate')).toHaveValue(outsideDate); await expect(input('endDate')).toHaveValue(outsideDate); await showOwnerOptions(); await expect(ownerOption('member-four')).toBeChecked();
    await input('title').fill('QA 超出项目日期可保存任务'); await expect(dialog()).toContainText('超出项目'); await submit('创建任务');
    const saved = await getTask('QA 超出项目日期可保存任务'); expect(saved.startDate).toBe(outsideDate); expect(saved.endDate).toBe(outsideDate);
    expect((await getProject(a.name)).endDate).toBe(addDays(D, 13));
  });
  await check('多人任务在每位负责人排班中出现，移除一人仅释放其安排，完成后释放全员', async () => {
    const sharedDate = addDays(D, 28);
    const sharedProject = await createProject('QA 多人共同负责项目');
    const sharedTask = await createTask(sharedProject, 'QA 多人共同执行任务', ['member-two', 'member-three'], 'member-four', sharedDate, addDays(sharedDate, 2));
    expect(sharedTask.ownerIds).toEqual(['member-two', 'member-three']); expect(sharedTask.contactIds).toEqual(['member-four']);
    await expect(card(sharedTask.id)).toContainText('成员二'); await expect(card(sharedTask.id)).toContainText('成员三'); await expect(card(sharedTask.id)).toContainText('对接 · 成员四');
    await page.reload(); expect((await getTask(sharedTask.title)).ownerIds).toEqual(['member-two', 'member-three']);
    await schedule(sharedDate, sharedProject.id);
    for (const member of sharedTask.ownerIds) {
      await availability(member, '1 项任务');
      await expect(desktopMember(member).locator(`[data-task-id="${sharedTask.id}"]`)).toBeVisible();
    }
    await availability('member-four', '当天空闲');
    await page.setViewportSize({ width: 390, height: 844 });
    for (const member of sharedTask.ownerIds) await expect(mobileMember(member).locator(`[data-task-id="${sharedTask.id}"]`)).toBeVisible();
    await noOverflow(); await shot('mobile-shared-task'); await page.setViewportSize({ width: 1440, height: 1000 });
    await openTask(sharedTask); await dButton('移除负责人 成员二').click(); await submit('保存修改');
    const remaining = await getTask(sharedTask.title); expect(remaining.ownerIds).toEqual(['member-three']); expect(remaining.startDate).toBe(sharedDate); expect(remaining.endDate).toBe(addDays(sharedDate, 2));
    await schedule(sharedDate, sharedProject.id); await availability('member-two', '当天空闲'); await availability('member-three', '1 项任务');
    expect(await desktopMember('member-two').locator(`[data-task-id="${sharedTask.id}"]`).count()).toBe(0);
    await openTask(sharedTask); await setOwners(['member-two', 'member-three']); await submit('保存修改');
    await card(sharedTask.id).getByRole('button', { name: `开始任务 ${sharedTask.title}`, exact: true }).click();
    await card(sharedTask.id).getByRole('button', { name: `提交核验 ${sharedTask.title}`, exact: true }).click();
    await card(sharedTask.id).getByRole('button', { name: `处理核验 ${sharedTask.title}`, exact: true }).click();
    await input('note').fill('多人共同完成，对接人仅用于联系。'); await submit('核验通过');
    await schedule(sharedDate, sharedProject.id);
    for (const member of sharedTask.ownerIds) {
      await availability(member, '当天空闲');
      expect(await desktopMember(member).locator(`[data-task-id="${sharedTask.id}"]`).count()).toBe(0);
    }
    expect((await getTask(sharedTask.title)).completedAt).toBeTruthy();
  });
  await check('旧v2迁入经理安排，已知姓名匹配五人、未知转待分配、组长不迁入，旧key字节不变', async () => {
    const time = `${today}T09:00:00+08:00`;
    const oldProject = (id, managerId, name) => ({ id, name, client: '迁移客户', contact: '迁移对接人', location: '迁移场地', startDate: D, endDate: addDays(D, 13), status: 'active', note: '保留旧项目信息', managerId, managerStartDate: D, managerEndDate: addDays(D, 2), leadId: 'old-lead', leadStartDate: D, leadEndDate: addDays(D, 5), createdAt: time, updatedAt: time });
    const fixture = { version: 2, members: [{ id: 'old-known', name: '成员一', specialty: '项目经理', color: '#777', active: true }, { id: 'old-unknown', name: '旧经理姓名', specialty: '项目经理', color: '#777', active: true }, { id: 'old-lead', name: '旧组长', specialty: '组长', color: '#777', active: true }], projects: [oldProject('old-a', 'old-known', '迁移已知经理项目'), oldProject('old-b', 'old-unknown', '迁移未知经理项目')], logs: [] };
    const raw = JSON.stringify(fixture);
    migrationContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
    await migrationContext.addInitScript(value => { if (localStorage.getItem('xu-jian-schedule-v2') === null) localStorage.setItem('xu-jian-schedule-v2', value); }, raw);
    const migrated = await migrationContext.newPage(); track(migrated); await migrated.goto(`${baseURL}/#/board`); await expect(migrated.locator('.tw-notice')).toContainText('未匹配的安排请重新分配');
    const saved = await migrated.evaluate(k => ({ old: localStorage.getItem('xu-jian-schedule-v2'), next: JSON.parse(localStorage.getItem(k)) }), key);
    expect(saved.old).toBe(raw); expect(saved.next.version).toBe(3); expect(saved.next.tasks).toHaveLength(2); expect(saved.next.projects.find(p => p.id === 'old-a').managerId).toBe('member-one'); expect(saved.next.projects.find(p => p.id === 'old-b').managerId).toBe('');
    expect(saved.next.tasks.find(t => t.projectId === 'old-a').ownerIds).toEqual(['member-one']); expect(saved.next.tasks.find(t => t.projectId === 'old-b').ownerIds).toEqual([]); expect(saved.next.tasks.find(t => t.projectId === 'old-b').status).toBe('todo');
    expect(saved.next.projects.every(p => !Object.hasOwn(p, 'leadId'))).toBe(true); expect(saved.next.tasks.some(t => t.ownerIds.includes('old-lead'))).toBe(false);
    await expect(migrated.locator('.tw-task-card').filter({ hasText: '迁移未知经理项目' })).toContainText('待分配'); await noOverflow(migrated); await shot('migration', migrated);
    await migrated.reload(); expect(await migrated.evaluate(() => localStorage.getItem('xu-jian-schedule-v2'))).toBe(raw); await migrationContext.close(); migrationContext = undefined;
  });
  await check('恢复示例按当天生成，保留固定五人；全部检查没有console error或未捕获异常', async () => {
    await page.locator('.tw-sidebar').getByRole('button', { name: '恢复示例数据', exact: true }).click(); await submit('确认恢复');
    expect((await state()).projects.some(p => p.name.startsWith('QA '))).toBe(false); await expect(page.getByRole('heading', { level: 1, name: '每一项工作，有序推进。', exact: true })).toBeVisible(); expect(errors).toEqual([]);
  });
  }
  report(); console.log(`\n${checks.length} taskboard UI checks passed. Evidence: ${output}`);
} catch (error) {
  checks.push({ title: 'run failure', passed: false, error: error.message });
  await shot('failure').catch(() => {}); report(); console.error(error); process.exitCode = 1;
} finally {
  if (migrationContext) await migrationContext.close();
  await context.close(); await browser.close();
}
