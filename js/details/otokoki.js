// otokoki.net（WordPress。CORS 可）から動画の記事を探し、説明文・アイキャッチ画像・カテゴリを取る
// 品番 → タイトルの順に検索し、品番またはタイトルの一致を確かめてから使う。
// 結果は IndexedDB の details に { key, fetchedAt, version, found, otokoki } で保存する
// （見つかったら 14 日、見つからなければ 3 日は取り直さない。通信エラーは保存しない）。

import * as db from '../db.js';
import { wpGet } from '../wp.js';
import { noteRelease } from '../release.js';
import { normalizeCode, normalizeTitle, stripCode, safeUrl } from '../matching.js';
import { decodeEntities } from '../util.js';

export const OTOKOKI = 'https://otokoki.net/';
const CACHE_VERSION = 3; // 保存する形や探し方を変えたら上げる（古いキャッシュを取り直す）
const DAY = 24 * 60 * 60 * 1000;
const TTL_FOUND = 14 * DAY;
const TTL_MISSING = 3 * DAY;

// otokoki の親カテゴリ → 見出し（並びはこの順）
const GROUPS = [
  [4877, '出演者'],
  [4899, '体型・特徴'],
  [4880, 'プレイ'],
  [6398, 'シチュエーション'],
  [3135, 'シリーズ'],
  [4881, '同人'],
  [13, 'レーベル'],
  [10, 'サイト'],
];
const GROUP_LABEL = new Map(GROUPS);
// ランキング・特集・未分類などは表示しない
const IGNORE_ROOTS = new Set([1, 94, 1772, 3018]);
// 掲載元の本文にあるプレイヤー切り替えボタンのアイコンなど（画像として出さない）
const memo = new Map(); // video.key -> Promise（同じセッション中に開き直したときの重複取得を防ぐ）
const parentOf = new Map(); // otokoki のカテゴリ id -> { name, parent }
// ───────────── otokoki ─────────────

export function getOtokoki(video) {
  if (!memo.has(video.key)) {
    const p = loadOtokoki(video).catch((e) => {
      memo.delete(video.key); // 通信エラーは次回やり直す
      throw e;
    });
    memo.set(video.key, p);
  }
  return memo.get(video.key);
}

async function loadOtokoki(video) {
  let cached = null;
  try { cached = await db.get('details', video.key); } catch {}
  if (cached && cached.version === CACHE_VERSION &&
      Date.now() - cached.fetchedAt < (cached.found ? TTL_FOUND : TTL_MISSING)) {
    if (cached.otokoki && cached.otokoki.date && titleMatched(video, cached.otokoki.title)) noteRelease(video, cached.otokoki.date);
    return cached.otokoki || null;
  }
  const post = await findPost(video);
  const otokoki = post ? await buildOtokoki(post) : null;
  // 見つかった記事の日付を、この動画の発売日の目安として記録する（全件の対応表で照合できなかった動画も埋まる）
  if (otokoki && otokoki.date && titleMatched(video, otokoki.title)) noteRelease(video, otokoki.date);
  const row = { key: video.key, fetchedAt: Date.now(), version: CACHE_VERSION, found: !!otokoki, otokoki };
  try { await db.put('details', row); } catch {}
  return otokoki;
}

const SEARCH_FIELDS = 'id,date,link,title,content,featured_media,categories';

async function search(q) {
  const { data } = await wpGet(OTOKOKI, 'posts', { search: q, per_page: 5, _fields: SEARCH_FIELDS });
  return Array.isArray(data) ? data : [];
}

// 品番 → タイトルの順に探す。どちらも一致を確かめたものだけ返す
async function findPost(video) {
  const code = videoCode(video);
  if (code) {
    const re = codeRegExp(code);
    const hit = (await search(code)).find((p) => re.test(plain(p.title.rendered + '\n' + p.content.rendered)));
    if (hit) return hit;
  }
  const titles = [...new Set([video.title, ...video.sources.map((s) => s.title)]
    .filter(Boolean)
    .map((t) => cleanTitle(t, code)))]
    .filter((t) => normalizeTitle(t).length >= 8)
    .slice(0, 2);
  for (const t of titles) {
    const q = searchWords(t);
    if (!q) continue;
    const hit = (await search(q)).find((p) => sameTitle(t, cleanTitle(decodeEntities(p.title.rendered), code)));
    if (hit) return hit;
  }
  return null;
}

// 品番として抽出されていなくても、タイトル先頭の「OAV463 – 」「ACST435 – 」のような英字＋数字は品番として試す
export function videoCode(video) {
  return video.code || (decodeEntities(video.title).match(/^\s*([A-Z]{2,8}\d{3,8})(?=[_\s–\-:])/) || [])[1] || '';
}

// 品番の前後が英数字で続いていない箇所だけを一致とみなす（GT-272 が GT-2720 に一致しないように）
// 発売日として記録してよいのは、記事のタイトル自体が一致した場合だけ
// （本文に品番が出てくるだけの続編・シリーズ紹介の記事の日付を付けないため）
function titleMatched(video, otokokiTitle) {
  if (!otokokiTitle) return false;
  const code = videoCode(video);
  if (code && codeRegExp(code).test(plain(otokokiTitle))) return true;
  return [video.title, ...video.sources.map((s) => s.title)].some((t) => t && sameTitle(cleanTitle(t, code), cleanTitle(otokokiTitle, code)));
}

function codeRegExp(code) {
  // 区切り（ハイフン・アンダースコア・空白）の有無は問わない（MR-KR2391 / MRKR2391 / MR-KR-2391）
  const body = [...normalizeCode(code).replace(/[^A-Z0-9]/g, '')].join('[-_ ]?');
  return new RegExp('(?:^|[^A-Z0-9])' + body + '(?![0-9])', 'i');
}

const plain = (html) => decodeEntities(String(html || '').replace(/<[^>]+>/g, ' ')).normalize('NFKC').toUpperCase();

// 品番・先頭の [シリーズ名]・前後の空白を除いたタイトル
function cleanTitle(title, code) {
  let t = decodeEntities(title);
  t = stripCode(t, code);
  t = t.replace(/^\s*(?:\[[^\]]*\]|【[^】]*】)\s*/, '');
  return t.trim();
}

// 検索語: 記号で区切った長い塊を 2 つまで（全角・半角の違いで外れないよう記号は使わない）
function searchWords(title) {
  const parts = title.split(/[\s!！?？♂♀☆★♪…・、。,.「」『』【】\[\]()（）~～〜\-–—:：/／&＆#＃*＊]+/u)
    .filter((p) => p.length >= 3)
    .sort((a, b) => b.length - a.length);
  return parts.slice(0, 2).join(' ');
}

function sameTitle(a, b) {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length < y.length ? [x, y] : [y, x];
  return s.length >= 12 && l.includes(s) && s.length / l.length >= 0.6;
}

async function buildOtokoki(post) {
  const [image, groups] = await Promise.all([
    post.featured_media ? wpGet(OTOKOKI, 'media/' + post.featured_media, { _fields: 'source_url' })
      .then(({ data }) => data && data.source_url).catch(() => null) : null,
    categoryGroups(post.categories || []).catch(() => []),
  ]);
  return {
    id: post.id,
    date: post.date, // otokoki の掲載日 = 発売日の目安
    link: safeUrl(post.link, OTOKOKI),
    title: decodeEntities(post.title.rendered),
    description: otokokiDescription(post.content.rendered),
    image: safeUrl(image, OTOKOKI),
    groups,
  };
}

// 本文の <p> を段落に。末尾の「【レーベル】品番_DL」などは省く
function otokokiDescription(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  const paras = [...doc.querySelectorAll('p')]
    .map((p) => p.textContent.replace(/[ \t]+\n/g, '\n').trim())
    .filter(Boolean);
  if (paras.length) {
    const tail = /\s*(?:【[^】]*】|[（(][^）)]*[）)])?\s*(?=[A-Z0-9_-]*\d)[A-Z]{2,}[A-Z0-9]*(?:[-_][A-Z0-9]+)+\s*$/i;
    paras[paras.length - 1] = paras[paras.length - 1].replace(tail, '').trim();
  }
  return paras.filter((p) => p.length > 1).join('\n\n');
}

// カテゴリを親でグループ分けする。親が見出しの対象でなければ祖先をたどる（最大 3 段）
async function categoryGroups(ids) {
  if (!ids.length) return [];
  await fetchCategories(ids);
  for (let depth = 0; depth < 3; depth++) {
    const unknown = [...new Set(ids.map((id) => rootOf(id)).filter((p) => p && !parentOf.has(p)))];
    if (!unknown.length) break;
    await fetchCategories(unknown);
  }
  const byGroup = new Map();
  for (const id of ids) {
    const c = parentOf.get(id);
    if (!c) continue;
    const g = groupOf(id);
    if (!g) continue;
    const name = c.name.replace(/^[_＿◆■●]+/, '').trim();
    if (!name) continue;
    if (!byGroup.has(g)) byGroup.set(g, []);
    if (!byGroup.get(g).includes(name)) byGroup.get(g).push(name);
  }
  return GROUPS.map(([, label]) => label).filter((l) => byGroup.has(l)).map((label) => ({ label, items: byGroup.get(label) }));
}

async function fetchCategories(ids) {
  const need = ids.filter((id) => !parentOf.has(id));
  if (!need.length) return;
  const { data } = await wpGet(OTOKOKI, 'categories', { include: need.join(','), per_page: 100, _fields: 'id,name,parent' });
  for (const c of data || []) parentOf.set(c.id, { name: decodeEntities(c.name), parent: c.parent });
}

// 見出しの対象の親にたどり着くまで上る。たどり着けない（未取得の）祖先の id を返す
function rootOf(id) {
  let cur = parentOf.get(id);
  for (let i = 0; cur && i < 5; i++) {
    if (GROUP_LABEL.has(cur.parent) || IGNORE_ROOTS.has(cur.parent) || cur.parent === 0) return null;
    if (!parentOf.has(cur.parent)) return cur.parent;
    cur = parentOf.get(cur.parent);
  }
  return null;
}

function groupOf(id) {
  let cur = parentOf.get(id);
  for (let i = 0; cur && i < 5; i++) {
    if (GROUP_LABEL.has(cur.parent)) return GROUP_LABEL.get(cur.parent);
    if (!cur.parent || IGNORE_ROOTS.has(cur.parent)) return null;
    cur = parentOf.get(cur.parent);
  }
  return null;
}

