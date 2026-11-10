// メモリ上のデータ（サイト・投稿・統合後の動画）と、変更通知
//
// events で流れるイベント
//   'data'      動画一覧が作り直された
//   'progress'  収集の進み具合が変わった
//   'favs'      お気に入りが変わった（favorites.js が発行）

import * as db from './db.js';
import { studioKey, isNoiseTag, pickStudio, extractCode, groupKey, isCodeTag, normalizeCode, releaseTitleKey, plausibleRelease, stripCode, safeUrl } from './matching.js';

// 以前の版で分類タグ（[PORN] など）をスタジオとして保存した投稿を、読み込み時に直す
const studioOf = (p) => (p.studio && isNoiseTag(p.studio) ? pickStudio(p.tags, []) : p.studio);

export const DEFAULT_SITES = [
  'https://gayvidsclub.com/',
  'https://poapan.xyz/',
  'https://javboys.com/',
];

export const state = {
  sites: [],
  posts: new Map(), // key -> post
  videos: [], // 統合後（新しい順）
  byKey: new Map(), // video.key -> video
  studios: [], // { key, name, count }（本数の多い順）
  // 発売日（release.js が埋める）
  //   official: 公式の配信日（CK DOWNLOAD）。'key:<video.key>' / 'code:<正規化した品番>' -> 日付
  //   byCode / byTitle: otokoki の掲載日（発売日の目安）
  release: { official: new Map(), byCode: new Map(), byTitle: new Map() },
};

// 発売日の出どころ（video.releaseSrc）
//   'official' 公式の配信日（CK DOWNLOAD） / 'otokoki' otokoki の掲載日（目安） / '' 不明
// 公式 → otokoki（品番 → タイトルの順）の順に探す。掲載元の最初の投稿日より遅い日付は使わない（matching.js の plausibleRelease）
function releaseOf(key, code, rows) {
  const first = rows.reduce((d, r) => (r.date && (!d || r.date < d) ? r.date : d), '');
  const ok = (d) => plausibleRelease(d, first);
  const off = state.release.official.get('key:' + key) || (code && state.release.official.get('code:' + normalizeCode(code)));
  if (ok(off)) return { date: off, src: 'official' };
  if (code) {
    const d = state.release.byCode.get(normalizeCode(code));
    if (ok(d)) return { date: d, src: 'otokoki' };
  }
  for (const r of rows) {
    const k = releaseTitleKey(r.title);
    const d = k && state.release.byTitle.get(k);
    if (ok(d)) return { date: d, src: 'otokoki' };
  }
  return null;
}

const releaseFields = (key, code, rows) => {
  const r = releaseOf(key, code, rows);
  return { release: r ? r.date : '', releaseKnown: !!r, releaseSrc: r ? r.src : '' };
};

// 発売日の対応表が増えたときに、一覧を作り直さずに 1 本だけ発売日を付け直す（release.js から使う）
export function applyRelease(video) {
  Object.assign(video, releaseFields(video.key, video.code, video.sources));
}

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

// 品番の判定を改良したとき用: 保存済み投稿の品番を判定し直す（変わったら true）。
// - 品番のない投稿 → 新しい判定で品番が取れれば付ける
// - 一般語（Part-02 など）を誤って品番にしていた投稿 → 外す
// - 外部 URL が http(s) でないリンクは捨てる
function migratePost(p) {
  let changed = false;
  if (p.link && !safeUrl(p.link)) { p.link = ''; changed = true; }
  if (p.code && extractCode(p.code) !== p.code) {
    p.code = null;
    p.group = groupKey(null, p.title, p.key);
    changed = true;
  }
  if (p.code) return changed;
  const code = extractCode(p.title, p.tags || []);
  if (!code) return changed;
  p.code = code;
  p.title = stripCode(p.title, code);
  p.group = groupKey(code, p.title, p.key);
  p.tags = (p.tags || []).filter((t) => !isCodeTag(t));
  return true;
}

// 表示用タイトル（品番を外したもの）。rebuild のたびに正規表現を作らないよう覚えておく
const titleCache = new Map();
function displayTitle(title, code) {
  if (!code) return title;
  const k = code + '\u0001' + title;
  let t = titleCache.get(k);
  if (t === undefined) titleCache.set(k, (t = stripCode(title, code)));
  return t;
}

// 検索用の文字列（投稿ごと）。title / tags が変わらない限り作り直さない
const hayCache = new WeakMap();
function hayOf(p) {
  const sig = p.title + '\u0001' + (p.tags || []).join('\u0001');
  let c = hayCache.get(p);
  if (!c || c.sig !== sig) hayCache.set(p, (c = { sig, hay: sig.replace(/\u0001/g, '\n').normalize('NFKC').toLowerCase() }));
  return c.hay;
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
      title: displayTitle(main.title, main.code), // 保存済みのタイトルに品番が残っていても表示では外す
      thumb: main.thumb,
      date: rows.reduce((d, r) => (r.date > d ? r.date : d), ''),
      // 発売日（公式の配信日 → otokoki の掲載日の順）と出どころ。照合できなければ空（不明）。掲載日では代用しない
      ...releaseFields(key, main.code, rows),
      studio,
      studioKey: sKey,
      tags,
      siteIds: new Set(rows.map((r) => r.siteId)),
      // どこかのサイトで最初に見つかった時刻（初回の全件取得分は 0 = NEW にしない）
      seenAt: rows.reduce((t, r) => Math.min(t, r.seenAt || 0), Infinity),
      // 投稿はコピーせず参照で持つ（6 万件を毎回コピーしないため。siteName はここで付けておく）
      sources: rows.map((r) => { r.siteName = siteName[r.siteId] || '?'; return r; }),
      hay: [...rows.map(hayOf), (main.code || '').toLowerCase(), (studio || '').normalize('NFKC').toLowerCase()].join('\n'),
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
  movedIndex = null;
  state.studios = studios;
}

// 統合キーが変わった動画（品番の判定を改良したときなど）を、保存しておいた品番・タイトルから探し直す。
// お気に入り・履歴の付け替えに使う
let movedIndex = null;
export function findMoved({ code, title }) {
  if (!movedIndex) {
    movedIndex = { code: new Map(), title: new Map() };
    for (const v of state.videos) {
      if (v.code && !movedIndex.code.has(normalizeCode(v.code))) movedIndex.code.set(normalizeCode(v.code), v);
      if (v.title && !movedIndex.title.has(v.title)) movedIndex.title.set(v.title, v);
    }
  }
  return (code && movedIndex.code.get(normalizeCode(code))) || (title && movedIndex.title.get(title)) || null;
}

export async function saveSite(site) {
  await db.put('sites', site);
  const i = state.sites.findIndex((s) => s.id === site.id);
  if (i >= 0) state.sites[i] = site;
}
