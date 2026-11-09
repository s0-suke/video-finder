// メモリ上のデータ（サイト・投稿・統合後の動画）と、変更通知
//
// events で流れるイベント
//   'data'      動画一覧が作り直された
//   'progress'  収集の進み具合が変わった
//   'favs'      お気に入りが変わった（favorites.js が発行）

import * as db from './db.js';
import { studioKey, isNoiseTag, pickStudio, extractCode, groupKey, isCodeTag } from './matching.js';

// 以前の版で分類タグ（[PORN] など）をスタジオとして保存した投稿を、読み込み時に直す
const studioOf = (p) => (p.studio && isNoiseTag(p.studio) ? pickStudio(p.tags, []) : p.studio);

export const DEFAULT_SITES = [
  'https://gayvidsclub.com/',
  'https://igay69.com/',
  'https://poapan.xyz/',
  'https://javboys.com/',
];

export const state = {
  sites: [],
  posts: new Map(), // key -> post
  videos: [], // 統合後（新しい順）
  byKey: new Map(), // video.key -> video
  studios: [], // { key, name, count }（本数の多い順）
};

// 収集で新しく見つかってから NEW 表示にしておく期間
const NEW_MS = 3 * 24 * 60 * 60 * 1000;
export const isNew = (v) => v.seenAt > Date.now() - NEW_MS;

export const events = new EventTarget();
export const emit = (type, detail) => events.dispatchEvent(new CustomEvent(type, { detail }));
export const on = (type, fn) => events.addEventListener(type, (e) => fn(e.detail));

export async function loadAll() {
  state.sites = await db.getAll('sites');
  const fixed = [];
  for (const p of await db.getAll('posts')) {
    if (migratePost(p)) fixed.push(p);
    state.posts.set(p.key, p);
  }
  if (fixed.length) await db.putAll('posts', fixed);
  rebuild();
}

// 品番の判定を改良したとき用: 品番のない保存済み投稿を判定し直す（変わったら true）
function migratePost(p) {
  if (p.code) return false;
  const code = extractCode(p.title, p.tags || []);
  if (!code) return false;
  p.code = code;
  p.group = groupKey(code, p.title, p.key);
  p.tags = p.tags.filter((t) => !isCodeTag(t));
  return true;
}

export function rebuild() {
  const enabled = new Set(state.sites.filter((s) => s.enabled).map((s) => s.id));
  const siteName = Object.fromEntries(state.sites.map((s) => [s.id, s.name]));
  const groups = new Map();
  for (const p of state.posts.values()) {
    if (!enabled.has(p.siteId)) continue;
    let g = groups.get(p.group);
    if (!g) groups.set(p.group, (g = []));
    g.push(p);
  }

  // スタジオ名は表記ゆれをまとめ、いちばん多い表記を表示名にする
  const studioNames = new Map(); // key -> Map(name -> count)
  const videos = [];
  for (const [key, rows] of groups) {
    rows.sort((a, b) => (b.thumb ? 1 : 0) - (a.thumb ? 1 : 0) || (a.date < b.date ? 1 : -1));
    const main = rows[0];
    const rawTags = [...new Set(rows.flatMap((r) => r.tags))];
    const studio = rows.map(studioOf).find(Boolean) || null;
    const sKey = studio ? studioKey(studio) : null;
    // 表示用のタグからは、分類タグとスタジオ名の言い換え（MEN'S RUSH など）を除く。検索には全部使う
    const tags = rawTags.filter((t) => !isNoiseTag(t) && !(sKey && studioKey(t).length >= 4 && sKey.startsWith(studioKey(t))));
    if (sKey) {
      let m = studioNames.get(sKey);
      if (!m) studioNames.set(sKey, (m = new Map()));
      m.set(studio, (m.get(studio) || 0) + 1);
    }
    videos.push({
      key,
      code: main.code,
      title: main.title,
      thumb: main.thumb,
      date: rows.reduce((d, r) => (r.date > d ? r.date : d), ''),
      studio,
      studioKey: sKey,
      tags,
      siteIds: new Set(rows.map((r) => r.siteId)),
      // どこかのサイトで最初に見つかった時刻（初回の全件取得分は 0 = NEW にしない）
      seenAt: rows.reduce((t, r) => Math.min(t, r.seenAt || 0), Infinity),
      sources: rows.map((r) => ({ ...r, siteName: siteName[r.siteId] || '?' })),
      hay: [...rows.map((r) => r.title), main.code || '', studio || '', ...rawTags].join('\n').normalize('NFKC').toLowerCase(),
    });
  }
  videos.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const studios = [...studioNames].map(([key, names]) => {
    const [name] = [...names].sort((a, b) => b[1] - a[1])[0];
    return { key, name, count: [...names.values()].reduce((a, b) => a + b, 0) };
  });
  studios.sort((a, b) => b.count - a.count);
  const displayName = new Map(studios.map((s) => [s.key, s.name]));
  for (const v of videos) if (v.studioKey) v.studio = displayName.get(v.studioKey);

  state.videos = videos;
  state.byKey = new Map(videos.map((v) => [v.key, v]));
  state.studios = studios;
}

export async function saveSite(site) {
  await db.put('sites', site);
  const i = state.sites.findIndex((s) => s.id === site.id);
  if (i >= 0) state.sites[i] = site;
}
