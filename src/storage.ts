import type { State } from './domain/types';
import { createSeed } from './domain/seed';

export const STORAGE_KEY = 'xu-jian-workbench-v1';
export function loadState(): { state: State; warning?: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { state: createSeed() };
    const parsed = JSON.parse(raw) as State;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.projects) || !Array.isArray(parsed.tasks) || !Array.isArray(parsed.members) || !Array.isArray(parsed.artifacts) || !Array.isArray(parsed.contacts) || !Array.isArray(parsed.handoffs) || !Array.isArray(parsed.issues) || !Array.isArray(parsed.activities)) throw new Error('数据格式不兼容');
    return { state: parsed };
  } catch {
    return { state: createSeed(), warning: '本地数据无法读取，已载入示例。请用“恢复示例数据”重新保存。' };
  }
}
export function saveState(state: State) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { throw new Error('浏览器无法保存数据，请检查是否禁用了本地存储。此次修改没有保存。'); }
}
