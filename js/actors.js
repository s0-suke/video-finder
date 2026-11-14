// 出演者データベース
//
// otokoki.net（WordPress。CORS 可）の「出演者」カテゴリ（親 4877。約 2,000 件）を索引にして、IndexedDB の actors に持つ。
//   索引（syncIndex）: 22 ページ（100 件ずつ）。名前・作品数・リンクと、名前から読み取った別名・レーベル・身長・体重・年齢（actors-core.js）。7 日に 1 回。
//   プロフィール（enrich）: その人の出演作の記事（新しい順）から、代表画像（最新作のアイキャッチ）・体型などのタグ・年齢の手がかり・作品の照合材料を取る。
//     一覧に出てきた人から少しずつ（brief）、詳細を開いたときは多めに（full）。結果は actors に残し、14 日は取り直さない。
// 出演者のお気に入りは localStorage の vfFavActors（{ 出演者 id: 表示名 }）。スタジオのお気に入りと同じ作り。
//
// 注意: 取れるのは otokoki が公開している情報だけ。顔写真ではなく、出演作のアイキャッチ画像を「代表画像」として使う。

import * as db from './db.js';
import { wpGet } from './wp.js';
import { state, emit } from './data.js';
import { normalizeCode, releaseCode, releaseTitleKey } from './matching.js';
import { decodeEntities, sleep } from './util.js';
import { parseActorName, ageFromTitles, countTags, actorHay } from './actors-core.js';

const OTOKOKI = 'https://otokoki.net/';
const ACTOR_ROOT = 4877;
const TAG_ROOTS = [4899, 4880]; // 体型・特徴 / プレイ（カテゴリ名を、記事のカテゴリ id から引くため）
const DAY = 24 * 60 * 60 * 1000;
const INDEX_TTL = 7 * DAY;
const PROFILE_TTL = 14 * DAY;
const DEV = new URLSearchParams(location.search).has('dev');

/** id -> 出演者の行（メモリ上。state.actors） */
state.actors = new Map();
let sorted = []; // 作品数の多い順

const clean = (s) => String(s || '').replace(/^[_＿◆■●]+/, '').trim();

// ───────────── 読み込み・索引 ─────────────

/** 保存済みの出演者を読み込む（起動時）。なければ空 */
export async function initActors() {
  try {
    for (const r of await db.getAll('actors')) if (r && r.id) state.actors.set(r.id, r);
  } catch (e) {
    console.warn('出演者を読み込めませんでした', e);
  }
  resort();
}

function resort() {
  sorted = [...state.actors.values()].sort((a, b) => (b.count || 0) - (a.count || 0) || a.display.localeCompare(b.display, 'ja'));
}

/** 作品数の多い順の出演者（配列。呼び出し側で変更しない） */
export const allActors = () => sorted;
export const getActor = (id) => state.actors.get(+id) || null;

let syncing = null;

/** 索引を取る（7 日に 1 回。保存済みがなければ必ず）。同時に 2 回走らない。進み具合は onProgress(取得済みの件数) */
export function syncIndex({ force = false, onProgress } = {}) {
  if (syncing) return syncing;
  syncing = (async () => {
    const last = await db.kvGet('actorIndexAt', 0);
    if (!force && state.actors.size && Date.now() - last < INDEX_TTL) return false;
    const rows = [];
    for (let page = 1, total = 1; page <= total; page++) {
      const { data, totalPages } = await wpGet(OTOKOKI, 'categories', {
        parent: ACTOR_ROOT, per_page: 100, page, orderby: 'count', order: 'desc', _fields: 'id,name,count,slug,link',
      });
      total = totalPages;
      for (const c of data || []) rows.push(toRow(c));
      if (onProgress) onProgress(rows.length);
      await sleep(250); // 続けて取りすぎない
    }
    // 既に持っているプロフィール（代表画像・タグなど）は残して、索引の部分だけ更新する
    const merged = rows.map((r) => ({ ...(state.actors.get(r.id) || {}), ...r }));
    await db.putAll('actors', merged);
    for (const r of merged) state.actors.set(r.id, r);
    resort();
    await db.kvSet('actorIndexAt', Date.now());
    emit('actors');
    return true;
  })().finally(() => { syncing = null; });
  return syncing;
}

function toRow(c) {
  const p = parseActorName(decodeEntities(c.name));
  return {
    id: c.id,
    name: p.raw,
    count: c.count || 0,
    slug: c.slug,
    link: c.link,
    display: p.display,
    aliases: p.aliases,
    label: p.label,
    height: p.height,
    weight: p.weight,
    age: p.age,
    anonymous: p.anonymous,
    descriptor: p.descriptor,
    hay: actorHay(p),
  };
}

// ───────────── プロフィール（代表画像・タグ・作品） ─────────────

let tagNames = null; // 記事のカテゴリ id -> 名前（体型・特徴・プレイ）

async function loadTagNames() {
  if (tagNames) return tagNames;
  const cached = await db.kvGet('otokokiTagNames', null);
  if (cached && Date.now() - cached.at < 30 * DAY) return (tagNames = new Map(cached.rows));
  const rows = [];
  for (const root of TAG_ROOTS) {
    const { data } = await wpGet(OTOKOKI, 'categories', { parent: root, per_page: 100, _fields: 'id,name' });
    for (const c of data || []) rows.push([c.id, clean(decodeEntities(c.name))]);
  }
  await db.kvSet('otokokiTagNames', { at: Date.now(), rows });
  return (tagNames = new Map(rows));
}

const inflight = new Map(); // id -> Promise

/**
 * 出演者のプロフィールを取る（取得済み・新しければ何もしない）。
 * mode 'brief': 最新の数件（代表画像・タグ・年齢の手がかり）だけ。一覧に出てきたとき。
 * mode 'full' : 出演作を最大 300 件（照合の材料・タグ・年齢）。詳細を開いたとき。
 */
export function enrich(id, mode = 'brief') {
  const a = state.actors.get(+id);
  if (!a) return Promise.resolve(null);
  const have = a.profile;
  if (have && Date.now() - have.at < PROFILE_TTL && (mode === 'brief' || have.full)) return Promise.resolve(a);
  const k = `${a.id}:${mode}`;
  if (!inflight.has(k)) inflight.set(k, doEnrich(a, mode).finally(() => inflight.delete(k)));
  return inflight.get(k);
}

async function doEnrich(a, mode) {
  const full = mode === 'full';
  const names = await loadTagNames();
  const pages = full ? 3 : 1;
  const per = full ? 100 : 6;
  const posts = [];
  for (let page = 1, total = 1; page <= Math.min(total, pages); page++) {
    const { data, totalPages } = await wpGet(OTOKOKI, 'posts', {
      categories: a.id, per_page: per, page, _fields: 'id,date,title,categories,featured_media,link',
    });
    total = totalPages;
    posts.push(...(data || []));
    if (page < Math.min(total, pages)) await sleep(250);
  }
  const titles = posts.map((p) => decodeEntities(p.title && p.title.rendered));
  const codes = new Set(), tkeys = new Set();
  for (const t of titles) {
    const c = releaseCode(t), k = releaseTitleKey(t);
    if (c) codes.add(c);
    if (k) tkeys.add(k);
  }
  // 代表画像: 最新の記事のアイキャッチ（取れなければ次の記事）
  let photo = (a.profile && a.profile.photo) || null;
  if (!photo) {
    for (const p of posts.slice(0, 3)) {
      if (!p.featured_media) continue;
      try {
        const { data } = await wpGet(OTOKOKI, `media/${p.featured_media}`, { _fields: 'source_url,media_details' });
        const sz = data && data.media_details && data.media_details.sizes;
        photo = (sz && ((sz.medium && sz.medium.source_url) || (sz.large && sz.large.source_url))) || (data && data.source_url) || null;
        if (photo) break;
      } catch { /* 次の記事で */ }
    }
  }
  const tags = countTags(posts.map((p) => p.categories), names).slice(0, 8);
  const row = {
    ...a,
    profile: {
      at: Date.now(),
      full: full || !!(a.profile && a.profile.full),
      photo,
      tags,
      age: a.age || ageFromTitles(titles),
      latest: posts[0] ? posts[0].date : (a.profile && a.profile.latest) || null,
      latestTitle: titles[0] || '',
      codes: full ? [...codes] : (a.profile && a.profile.codes) || [],
      tkeys: full ? [...tkeys] : (a.profile && a.profile.tkeys) || [],
    },
  };
  try { await db.put('actors', row); } catch (e) { console.warn('出演者を保存できませんでした', e); }
  state.actors.set(row.id, row);
  emit('actors');
  return row;
}

/** 年齢（名前に書かれていればそれ。なければ作品のタイトルから） */
export const ageOf = (a) => a.age || (a.profile && a.profile.age) || null;

// ───────────── 手元の動画との照合 ─────────────

/** 出演作の照合材料に当たる、手元の動画（新しい順。state.videos は新しい順）。照合材料がなければ [] */
export function videosOf(a) {
  const p = a && a.profile;
  if (!p || (!p.codes.length && !p.tkeys.length)) return [];
  const C = new Set(p.codes), T = new Set(p.tkeys);
  const out = [];
  for (const v of state.videos) {
    for (const s of v.sources) {
      if ((s.code && C.has(normalizeCode(s.code))) || (T.size && T.has(releaseTitleKey(s.title || '')))) { out.push(v); break; }
    }
  }
  return out;
}

// ───────────── お気に入り ─────────────

const FAV_KEY = 'vfFavActors';
// お気に入りは、読むたびに localStorage から取る（別のウインドウで変えた分や、アプリ側の変更とずれないように。数が少ないので軽い）
function loadFavs() { try { return JSON.parse(localStorage.getItem(FAV_KEY) || '{}') || {}; } catch { return {}; } }

export const isFavActor = (id) => String(id) in loadFavs();
export const favActorIds = () => Object.keys(loadFavs()).map(Number);

/** お気に入りの付け外し。付けたら true */
export function toggleFavActor(id) {
  const a = state.actors.get(+id);
  const favs = loadFavs();
  const key = String(id);
  const on = !(key in favs);
  if (on) favs[key] = a ? a.display : key; else delete favs[key];
  try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); } catch { /* 保存できなくても、このあいだは効かない（案内は呼び出し側） */ }
  emit('favactors', +id);
  return on;
}

// ───────────── 一覧用の探し方 ─────────────

/** 名前・別名・レーベル・特徴・数値で絞る。空なら全員（作品数の多い順）。minCount 未満は除く */
export function searchActors(q, { minCount = 1 } = {}) {
  const w = (q || '').normalize('NFKC').toLowerCase().trim();
  const words = w.split(/\s+/).filter(Boolean);
  return sorted.filter((a) => a.count >= minCount && words.every((x) => a.hay.includes(x)));
}

/** 開発用: ?dev のとき、索引を小さくするのではなく、そのまま取る（出演者は 22 リクエストで済む） */
export const isDev = DEV;
