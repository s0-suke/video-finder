// 視聴履歴（再生した動画を新しい順に残す）

import * as db from './db.js';
import { state, on, emit, findMoved } from './data.js';
import { feature } from './features.js';

const MAX = 300;
const viewed = new Map(); // key -> at（ミリ秒）

const rows = new Map(); // key -> 保存している行（付け替え用）

export async function init() {
  for (const h of await db.getAll('history')) { viewed.set(h.key, h.at); rows.set(h.key, h); }
  on('data', remap);
  remap();
}

// 統合キーが変わった動画は、品番・タイトルで探し直して付け替える
function remap() {
  if (!state.videos.length) return;
  for (const h of [...rows.values()]) {
    if (state.byKey.has(h.key)) continue;
    const v = findMoved(h);
    if (!v || viewed.has(v.key)) continue;
    viewed.delete(h.key); rows.delete(h.key);
    db.del('history', h.key).catch(() => {});
    const row = { ...h, key: v.key };
    viewed.set(row.key, row.at); rows.set(row.key, row);
    db.put('history', row).catch(() => {});
  }
}

export const viewedAt = (key) => viewed.get(key) || 0;

export function recentKeys() {
  return [...viewed].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

export async function recordView(video) {
  if (!feature('history')) return; // 視聴履歴をオフにしているときは記録しない
  const at = Date.now();
  viewed.set(video.key, at);
  const row = { key: video.key, at, title: video.title, thumb: video.thumb, code: video.code };
  rows.set(row.key, row);
  await db.put('history', row);
  if (viewed.size > MAX) {
    for (const k of recentKeys().slice(MAX)) { viewed.delete(k); rows.delete(k); await db.del('history', k); }
  }
  emit('history');
}

export async function clearHistory() {
  viewed.clear();
  rows.clear();
  await db.clear('history');
  emit('history');
}
