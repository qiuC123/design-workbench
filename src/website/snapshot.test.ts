import test from 'node:test';
import assert from 'node:assert/strict';
import { latestWorkspaceSnapshot } from './useWebsite';
import type { WorkspaceSnapshot } from './api';

function snapshot(revision: number): WorkspaceSnapshot {
  return { state: { version: 4, companies: [], contacts: [], projects: [], activities: [{ id: `change-${revision}`, text: `修改 ${revision}`, at: '2026-10-09T10:00:00Z' }] }, revision, updatedAt: `2026-10-09T10:00:0${revision}Z` };
}

test('轮询先返回较新数据时，迟到的保存响应返回同一份最新状态给调用方', async () => {
  let current: WorkspaceSnapshot | null = snapshot(0);
  const accept = (next: WorkspaceSnapshot) => (current = latestWorkspaceSnapshot(current, next));
  let resolveSave!: (value: WorkspaceSnapshot) => void;
  const delayedSave = new Promise<WorkspaceSnapshot>(resolve => { resolveSave = resolve; }).then(accept);
  const newer = snapshot(2);
  accept(newer);
  resolveSave(snapshot(1));
  const resultForWorkbench = await delayedSave;
  assert.equal(resultForWorkbench, newer);
  assert.equal(current, newer);
  assert.equal(resultForWorkbench.state.activities[0].text, '修改 2');
});

test('保存先完成时，迟到的旧轮询不能回滚；后续新版本仍可进入', () => {
  const saved = snapshot(2);
  assert.equal(latestWorkspaceSnapshot(saved, snapshot(1)), saved);
  const subsequent = snapshot(3);
  assert.equal(latestWorkspaceSnapshot(saved, subsequent), subsequent);
  assert.equal(latestWorkspaceSnapshot(null, saved), saved);
});

test('同版本轮询保留原状态对象，避免无变化时重建界面', () => {
  const current = snapshot(2);
  const polled = snapshot(2);
  assert.notEqual(current, polled);
  assert.equal(latestWorkspaceSnapshot(current, polled), current);
});
