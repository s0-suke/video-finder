// 各サイトからの収集
//
// - 新着側から、既知の投稿が 1 ページ丸ごと続くまで取得する（差分収集）
// - 初回の全件取得が終わっていなければ、前回の続きのページから最後まで取得する
// - 通信量を抑えるため本文は取らない（本文は詳細を開いたときに source.js が取る）

import * as db from './db.js';
import { state, emit, rebuild, rebuildAsync, saveSite, forgetPost, DEFAULT_SITES } from './data.js';
import { wpGet } from './wp.js';
import { sleep, decodeEntities } from './util.js';
import { extractCode, stripCode, groupKey, pickStudio, safeUrl } from './matching.js';

const PER_PAGE = 100;
const PAGE_DELAY_MS = 300;

export const crawl = { running: false, added: 0, generation: 0 };

// 収集中にサイトの削除や収集データの削除が起きたら、走っている収集を打ち切るための目印
class Aborted extends Error {}
const checkAlive = (site, gen) => {
  if (gen !== crawl.generation || !state.sites.includes(site)) throw new Aborted();
};

// 開発用: URL に ?dev を付けると、各サイト 1 ページ目だけ取って全件取得はしない
const DEV = new URLSearchParams(location.search).has('dev');

const termCache = new Map(); // `${siteId}:${termId}` -> name

// 1.12 より前の版の既定のサイト（seededDefaults を持たない端末は、これを登録済みとして扱う）
const LEGACY_DEFAULTS = ['https://gayvidsclub.com/', 'https://poapan.xyz/', 'https://javboys.com/'];

export async function initCrawler() {
  for (const t of await db.getAll('terms')) termCache.set(t.key, t.name);
  await seedDefaultSites();
}

// 既定のサイトを登録する。「登録したことのある既定のサイト」を覚えておき、まだのものだけを足す。
// （以前は初回だけだったので、あとから既定に足しても、既に使っている端末には届かなかった）
// 利用者が削除したサイトは、覚えているので戻さない。
async function seedDefaultSites() {
  let seeded = await db.kvGet('seededDefaults', null);
  if (!seeded) {
    // 古い版から上がってきた端末: 初期化済みなら、そのときの既定 3 つは登録したことにする（削除されていても戻さない）
    seeded = (await db.kvGet('initialized', false)) || state.sites.length ? LEGACY_DEFAULTS.slice() : [];
  }
  const todo = DEFAULT_SITES.filter((u) => !seeded.includes(u));
  if (!todo.length && (await db.kvGet('seededDefaults', null))) return;
  for (const u of todo) {
    if (!state.sites.some((s) => s.url === u)) await addSite(u, { verify: false }).catch(() => {});
    seeded.push(u);
  }
  await db.kvSet('seededDefaults', seeded);
  await db.kvSet('initialized', true);
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

// 投稿のタグの持ち方の版（2: 品番だけのタグも残す）。これより古い投稿は repairCodes でタグを取り直す
const TERMS_VERSION = 2;

// WordPress の投稿 1 件から、タイトル・品番・タグなど収集で決まる項目を作る（toPosts と repairCodes で共通）
function postFields(site, key, p) {
  const title = decodeEntities(p.title && p.title.rendered);
  const tags = (p.tags || []).map((id) => termCache.get(`${site.id}:${id}`)).filter(Boolean);
  const cats = (p.categories || []).map((id) => termCache.get(`${site.id}:${id}`)).filter(Boolean);
  const code = extractCode(title, tags);
  const clean = stripCode(title, code);
  return {
    title: clean,
    // スタジオは仮の値（一覧ではタグ・カテゴリから選び直す: data.js の rebuild）
    code, group: groupKey(code, clean, key), studio: pickStudio(tags, cats),
    // 品番だけのタグも残す（別の番号での統合と検索に使う。表示では除く）
    tags: [...new Set([...cats, ...tags])],
    termsV: TERMS_VERSION,
  };
}

async function toPosts(site, raw, { backfill }) {
  const [media] = await Promise.all([
    resolveMedia(site, raw.map((p) => p.featured_media)),
    resolveTerms(site, raw.flatMap((p) => p.tags || []), 'tags'),
    resolveTerms(site, raw.flatMap((p) => p.categories || []), 'categories'),
  ]);
  return raw.map((p) => {
    const key = `${site.id}:${p.id}`;
    const prev = state.posts.get(key) || {};
    return {
      ...prev, // 詳細を開いたときに取った本文由来の情報（embeds など）を残す
      key, siteId: site.id, postId: p.id, link: safeUrl(p.link, site.url) || '', date: p.date,
      thumb: media[p.featured_media] || prev.thumb || null,
      // 新着表示用。初回の全件取得で入った分は 0（NEW にしない）
      seenAt: prev.key ? prev.seenAt || 0 : backfill ? 0 : Date.now(),
      ...postFields(site, key, p),
    };
  });
}

let rebuildTimer;
function scheduleRebuild() {
  if (rebuildTimer) return;
  // 収集中の作り直しは重いので、間隔をあけてまとめて行う
  // 初回の全件取得中は件数が一気に増え、全件の作り直し（iPhone で 1 秒前後）が頻繁だとスクロールが引っかかるので間隔を広げる
  const backfilling = state.sites.some((s) => s.enabled && !s.backfillDone);
  rebuildTimer = setTimeout(() => { rebuildTimer = null; rebuildAsync().then((ok) => { if (ok) emit('data'); }); }, backfilling ? 15000 : 8000);
}

async function crawlPages(site, start, { stopWhenKnown, track, maxPage = Infinity, gen }) {
  let page = start, total = start;
  while (page <= Math.min(total, maxPage)) {
    site.status = `収集中 ${page}/${total} ページ`;
    // 全件取得の進み具合（差分パスで 1 ページ目に戻っても、バナーの % が跳ねないよう大きいほうを使う）
    site.progress = { page: Math.max(page, site.backfillDone ? 0 : site.backfillPage || 0), total };
    emit('progress');
    const { data, totalPages } = await wpGet(site.url, 'posts', {
      per_page: PER_PAGE, page, _fields: 'id,date,link,title,featured_media,tags,categories',
    });
    total = totalPages;
    if (!data.length) break;
    const rows = await toPosts(site, data, { backfill: !!track });
    checkAlive(site, gen);
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
  const gen = crawl.generation;
  try {
    const track = !site.backfillDone;
    if (DEV) {
      // 開発モードでも、初回の取得分は NEW にしない（track のときだけ backfill 扱い）
      await crawlPages(site, 1, { stopWhenKnown: true, track, maxPage: 1, gen });
      site.status = 'OK（開発モード: 1 ページ目のみ）';
      site.error = false;
      site.lastRun = new Date().toISOString();
      checkAlive(site, gen);
      await saveSite(site);
      return emit('progress');
    }
    await crawlPages(site, 1, { stopWhenKnown: !full, track, gen });
    if (!full && !site.backfillDone) {
      await crawlPages(site, site.backfillPage || 1, { stopWhenKnown: false, track, gen });
    }
    checkAlive(site, gen);
    site.backfillDone = true;
    site.progress = null;
    site.status = 'OK';
    site.error = false;
  } catch (e) {
    if (e instanceof Aborted) return; // 削除されたサイト・消されたデータは書き戻さない
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
  const pending = state.sites.filter((s) => s.enabled && !s.backfillDone);
  if (!pending.length) return null;
  let done = 0, total = 0;
  for (const s of pending) {
    const p = s.progress || { page: s.backfillPage || 0, total: 0 };
    done += p.page; total += Math.max(p.total, p.page, 1);
  }
  return done / total;
}

// 一度だけ動く修復: タイトル・タグ・カテゴリを取り直し、品番とタグを今の収集と同じ形にする。
// - 以前の版は品番だけのタグを捨てていた（別の番号での統合に使えない）
// - 開発中の版で、タイトル先頭・タグからしか取れない形の品番（FC2-PPV-1365684 / COCO566-02 など）を誤って外した投稿がある
//   （タイトルからは収集時に品番を外しているので、取り直さないと戻せない）
// タグの持ち方の版（termsV）が古い投稿だけが対象。収集で取り直した投稿は対象外になる
const REPAIR_KEY = 'repairTerms2';
let repairing = false;
export async function repairCodes() {
  if (repairing || crawl.running || DEV || !navigator.onLine || (await db.kvGet(REPAIR_KEY, false))) return;
  repairing = true;
  const gen = crawl.generation;
  try {
    for (const site of state.sites.filter((s) => s.enabled)) {
      const siteKey = `${REPAIR_KEY}:${site.id}`;
      if (await db.kvGet(siteKey, false)) continue;
      try {
        const ids = [...state.posts.values()].filter((p) => p.siteId === site.id && (p.termsV || 0) < TERMS_VERSION).map((p) => p.postId);
        for (let i = 0; i < ids.length; i += 100) {
          const { data } = await wpGet(site.url, 'posts', { include: ids.slice(i, i + 100).join(','), per_page: 100, _fields: 'id,title,tags,categories' });
          await Promise.all([
            resolveTerms(site, data.flatMap((p) => p.tags || []), 'tags'),
            resolveTerms(site, data.flatMap((p) => p.categories || []), 'categories'),
          ]);
          if (gen !== crawl.generation) return;
          const fixed = [];
          for (const raw of data) {
            const post = state.posts.get(`${site.id}:${raw.id}`);
            if (!post || (post.termsV || 0) >= TERMS_VERSION) continue; // その間に収集で取り直した投稿はそのまま
            Object.assign(post, postFields(site, post.key, raw));
            forgetPost(post); // rebuild の覚えておいた材料を作り直させる
            fixed.push(post);
          }
          if (fixed.length) { await db.putAll('posts', fixed); scheduleRebuild(); }
          await sleep(PAGE_DELAY_MS);
        }
        await db.kvSet(siteKey, true); // サイトごとに完了を記録（途中で止まっても次回は続きのサイトから）
      } catch {
        // このサイトは失敗。ほかのサイトは続ける（このサイトは次回やり直す）
      }
    }
    // 有効なサイトがすべて済んだら、修復全体を完了にする
    const done = await Promise.all(state.sites.filter((s) => s.enabled).map((s) => db.kvGet(`${REPAIR_KEY}:${s.id}`, false)));
    if (done.every(Boolean)) await db.kvSet(REPAIR_KEY, true);
  } finally {
    repairing = false;
  }
}

// 全件取得が終わっていないサイトは、自動収集の間隔の設定やエラーに関係なく再開する
// （エラーになったサイトは 5 分おいてから）。それ以外は前回から一定時間経っていれば新着を取りに行く
const RETRY_MS = 5 * 60 * 1000;
export async function maybeAutoCollect() {
  if (crawl.running || !navigator.onLine) return;
  const unfinished = !DEV && state.sites.some((s) => s.enabled && !s.backfillDone &&
    (!s.error || Date.now() - new Date(s.lastRun || 0).getTime() > RETRY_MS));
  const min = await db.kvGet('intervalMin', 30);
  const last = await db.kvGet('lastCollect', 0);
  if (unfinished || (min && Date.now() - last >= min * 60 * 1000)) await collect();
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
  crawl.generation++;
  await db.deleteByIndex('posts', 'site', id);
  await db.del('sites', id);
  state.sites = state.sites.filter((s) => s.id !== id);
  for (const [k, p] of state.posts) if (p.siteId === id) state.posts.delete(k);
  rebuild();
  emit('data');
}

export async function wipeData() {
  crawl.generation++;
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
