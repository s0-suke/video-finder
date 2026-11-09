// 各サイトからの収集
//
// - 新着側から、既知の投稿が 1 ページ丸ごと続くまで取得する（差分収集）
// - 初回の全件取得が終わっていなければ、前回の続きのページから最後まで取得する
// - 通信量を抑えるため本文は取らない（本文は詳細を開いたときに source.js が取る）

import * as db from './db.js';
import { state, emit, rebuild, saveSite, DEFAULT_SITES } from './data.js';
import { wpGet } from './wp.js';
import { sleep, decodeEntities } from './util.js';
import { isCodeTag, extractCode, stripCode, groupKey, pickStudio } from './matching.js';

const PER_PAGE = 100;
const PAGE_DELAY_MS = 300;

export const crawl = { running: false, added: 0 };

// 開発用: URL に ?dev を付けると、各サイト 1 ページ目だけ取って全件取得はしない
const DEV = new URLSearchParams(location.search).has('dev');

const termCache = new Map(); // `${siteId}:${termId}` -> name

export async function initCrawler() {
  for (const t of await db.getAll('terms')) termCache.set(t.key, t.name);
  if (!state.sites.length && !(await db.kvGet('initialized', false))) {
    for (const u of DEFAULT_SITES) await addSite(u, { verify: false });
    await db.kvSet('initialized', true);
  }
}

// タグ・カテゴリ名とサムネイル URL を、投稿 100 件分まとめて引く
async function resolveTerms(site, ids, taxonomy) {
  const missing = [...new Set(ids)].filter((id) => !termCache.has(`${site.id}:${id}`));
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    const { data } = await wpGet(site.url, taxonomy, { per_page: 100, include: chunk.join(','), _fields: 'id,name' });
    const rows = data.map((t) => ({ key: `${site.id}:${t.id}`, name: decodeEntities(t.name) }));
    for (const r of rows) termCache.set(r.key, r.name);
    for (const id of chunk) if (!termCache.has(`${site.id}:${id}`)) termCache.set(`${site.id}:${id}`, '');
    await db.putAll('terms', rows);
  }
}

async function resolveMedia(site, ids) {
  const map = {};
  const uniq = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 100) {
    const { data } = await wpGet(site.url, 'media', { per_page: 100, include: uniq.slice(i, i + 100).join(','), _fields: 'id,source_url' });
    for (const m of data) map[m.id] = m.source_url;
  }
  return map;
}

async function toPosts(site, raw, { backfill }) {
  const [media] = await Promise.all([
    resolveMedia(site, raw.map((p) => p.featured_media)),
    resolveTerms(site, raw.flatMap((p) => p.tags || []), 'tags'),
    resolveTerms(site, raw.flatMap((p) => p.categories || []), 'categories'),
  ]);
  return raw.map((p) => {
    const key = `${site.id}:${p.id}`;
    const title = decodeEntities(p.title && p.title.rendered);
    const tags = (p.tags || []).map((id) => termCache.get(`${site.id}:${id}`)).filter(Boolean);
    const cats = (p.categories || []).map((id) => termCache.get(`${site.id}:${id}`)).filter(Boolean);
    const code = extractCode(title, tags);
    const clean = stripCode(title, code);
    const prev = state.posts.get(key) || {};
    return {
      ...prev, // 詳細を開いたときに取った本文由来の情報（embeds など）を残す
      key, siteId: site.id, postId: p.id, link: p.link, title: clean, date: p.date,
      thumb: media[p.featured_media] || prev.thumb || null,
      // 新着表示用。初回の全件取得で入った分は 0（NEW にしない）
      seenAt: prev.key ? prev.seenAt || 0 : backfill ? 0 : Date.now(),
      code, group: groupKey(code, clean, key), studio: pickStudio(tags, cats),
      tags: [...new Set([...cats, ...tags])].filter((t) => !isCodeTag(t)),
    };
  });
}

let rebuildTimer;
function scheduleRebuild() {
  if (rebuildTimer) return;
  rebuildTimer = setTimeout(() => { rebuildTimer = null; rebuild(); emit('data'); }, 3000);
}

async function crawlPages(site, start, { stopWhenKnown, track, maxPage = Infinity }) {
  let page = start, total = start;
  while (page <= Math.min(total, maxPage)) {
    site.status = `収集中 ${page}/${total} ページ`;
    site.progress = { page, total };
    emit('progress');
    const { data, totalPages } = await wpGet(site.url, 'posts', {
      per_page: PER_PAGE, page, _fields: 'id,date,link,title,featured_media,tags,categories',
    });
    total = totalPages;
    if (!data.length) break;
    const rows = await toPosts(site, data, { backfill: !!track });
    let known = 0;
    for (const p of rows) {
      if (state.posts.has(p.key)) known++; else crawl.added++;
      state.posts.set(p.key, p);
    }
    await db.putAll('posts', rows);
    site.count = (site.count || 0) + rows.length - known;
    if (track) site.backfillPage = Math.max(site.backfillPage || 1, page);
    await saveSite(site);
    scheduleRebuild();
    if (stopWhenKnown && known === data.length) break;
    page++;
    await sleep(PAGE_DELAY_MS);
  }
}

async function crawlSite(site, { full = false } = {}) {
  try {
    const track = !site.backfillDone;
    if (DEV) {
      await crawlPages(site, 1, { stopWhenKnown: true, track: false, maxPage: 1 });
      site.status = 'OK（開発モード: 1 ページ目のみ）';
      site.error = false;
      site.lastRun = new Date().toISOString();
      await saveSite(site);
      return emit('progress');
    }
    await crawlPages(site, 1, { stopWhenKnown: !full, track });
    if (!full && !site.backfillDone) {
      await crawlPages(site, site.backfillPage || 1, { stopWhenKnown: false, track });
    }
    site.backfillDone = true;
    site.progress = null;
    site.status = 'OK';
    site.error = false;
  } catch (e) {
    site.status = 'エラー: ' + e.message;
    site.error = true;
  }
  site.lastRun = new Date().toISOString();
  await saveSite(site);
  emit('progress');
}

export async function collect({ siteId, full = false } = {}) {
  if (crawl.running) return;
  crawl.running = true;
  crawl.added = 0;
  emit('progress');
  try {
    const targets = state.sites.filter((s) => (siteId ? s.id === siteId : s.enabled));
    await Promise.all(targets.map((s) => crawlSite(s, { full })));
    await db.kvSet('lastCollect', Date.now());
  } finally {
    crawl.running = false;
    clearTimeout(rebuildTimer); rebuildTimer = null;
    rebuild();
    emit('data');
    emit('progress');
  }
}

// アプリを開いたとき・画面に戻ったときに、前回から一定時間経っていれば新着を取りに行く
// 初回の全件取得の進み具合（0〜1）。全件取得中のサイトがなければ null
export function backfillProgress() {
  const pending = state.sites.filter((s) => s.enabled && !s.backfillDone && !s.error);
  if (!pending.length) return null;
  let done = 0, total = 0;
  for (const s of pending) {
    const p = s.progress || { page: s.backfillPage || 0, total: 0 };
    done += p.page; total += Math.max(p.total, p.page, 1);
  }
  return done / total;
}

export async function maybeAutoCollect() {
  const min = await db.kvGet('intervalMin', 30);
  if (!min || crawl.running || !navigator.onLine) return;
  const last = await db.kvGet('lastCollect', 0);
  const unfinished = !DEV && state.sites.some((s) => s.enabled && !s.backfillDone && !s.error);
  if (unfinished || Date.now() - last >= min * 60 * 1000) await collect();
}

export async function addSite(input, { verify = true } = {}) {
  let u;
  try { u = new URL(/^https?:\/\//.test(input) ? input : 'https://' + input); } catch { throw new Error('URL が不正です'); }
  const url = `${u.protocol}//${u.host}/`;
  if (state.sites.some((s) => s.url === url)) throw new Error('登録済みです');
  const site = { url, name: u.hostname, enabled: true, status: null, count: 0, backfillDone: false, backfillPage: 1 };
  if (verify) await wpGet(url, 'posts', { per_page: 1, _fields: 'id' }); // ブラウザから取得できるか確認
  site.id = await db.req(db.store('sites', 'readwrite').add(site));
  state.sites.push(site);
  return site;
}

export async function removeSite(id) {
  await db.deleteByIndex('posts', 'site', id);
  await db.del('sites', id);
  state.sites = state.sites.filter((s) => s.id !== id);
  for (const [k, p] of state.posts) if (p.siteId === id) state.posts.delete(k);
  rebuild();
  emit('data');
}

export async function wipeData() {
  await db.clear('posts');
  await db.clear('terms');
  state.posts.clear();
  termCache.clear();
  for (const s of state.sites) {
    Object.assign(s, { count: 0, backfillDone: false, backfillPage: 1, status: null, error: false, lastRun: null });
    await saveSite(s);
  }
  await db.kvSet('lastCollect', 0);
  rebuild();
  emit('data');
}
