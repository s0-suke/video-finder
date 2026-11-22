// 視聴履歴（再生した動画を新しい順に残す）

import * as db from './db.js';
import { state, on, emit, relocate, sourceKeys } from './data.js';
import { mergeHistory } from './backup-core.js';

const MAX = 300;
const viewed = new Map(); // key -> at（ミリ秒）

const rows = new Map(); // key -> 保存している行（付け替え用）

export async function init() {
  for (const h of await db.getAll('history')) { viewed.set(h.key, h.at); rows.set(h.key, h); }
  on('data', remap);
  remap();
}

// 統合キーが変わった動画は、構成していた投稿（posts）・品番・タイトルで探し直して付け替える
function remap() {
  if (!state.videos.length) return;
  for (const h of [...rows.values()]) {
    const v = relocate(h);
    if (!v || viewed.has(v.key)) continue;
    viewed.delete(h.key); rows.delete(h.key);
    db.del('history', h.key).catch(() => {});
    const row = { ...h, key: v.key, posts: sourceKeys(v) };
    viewed.set(row.key, row.at); rows.set(row.key, row);
    db.put('history', row).catch(() => {});
  }
}

export const viewedAt = (key) => viewed.get(key) || 0;

export function recentKeys() {
  return [...viewed].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

export async function recordView(video) {
  const at = Date.now();
  viewed.set(video.key, at);
  const row = { key: video.key, at, title: video.title, thumb: video.thumb, code: video.code, posts: sourceKeys(video) };
  rows.set(row.key, row);
  await db.put('history', row);
  if (viewed.size > MAX) {
    for (const k of recentKeys().slice(MAX)) { viewed.delete(k); rows.delete(k); await db.del('history', k); }
  }
  emit('history');
}

/** 書き出し用: 保存している履歴の行（新しい順） */
export const historyRows = () => [...rows.values()].sort((a, b) => b.at - a.at);

/** 読み込み: 履歴に足し合わせる（同じ動画は新しい見た日時を残す）。足した件数を返す */
export async function importHistory(list) {
  const { rows: changed, added } = mergeHistory([...rows.values()], Array.isArray(list) ? list : [], MAX);
  if (!changed.length) return 0;
  for (const r of changed) { viewed.set(r.key, r.at); rows.set(r.key, r); }
  await db.putAll('history', changed);
  emit('history');
  return added;
}
