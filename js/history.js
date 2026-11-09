// 視聴履歴（再生した動画を新しい順に残す）

import * as db from './db.js';
import { emit } from './data.js';

const MAX = 300;
const viewed = new Map(); // key -> at（ミリ秒）

export async function init() {
  for (const h of await db.getAll('history')) viewed.set(h.key, h.at);
}

export const viewedAt = (key) => viewed.get(key) || 0;

export function recentKeys() {
  return [...viewed].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

export async function recordView(video) {
  const at = Date.now();
  viewed.set(video.key, at);
  await db.put('history', { key: video.key, at, title: video.title, thumb: video.thumb, code: video.code });
  if (viewed.size > MAX) {
    for (const k of recentKeys().slice(MAX)) { viewed.delete(k); await db.del('history', k); }
  }
  emit('history');
}

export async function clearHistory() {
  viewed.clear();
  await db.clear('history');
  emit('history');
}
