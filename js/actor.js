// 出演者で探す
//
// 詳細の「出演者」のチップを押したら、otokoki.net の出演者カテゴリ（親カテゴリ 4877 の直下）から
// その人の出演作の記事タイトルを取り、品番 → タイトルの順に手元の動画と照らし合わせて一覧に出す。
// 掲載元のタイトル・タグに名前が書かれていない作品も見つかる。名前での検索（全文検索）に当たる動画も合わせる。
// 記事タイトルの品番・タイトルのキーは IndexedDB の kv に 3 日間覚えておく（動画の key ではなく照合の材料を残すので、統合が変わっても使える）。

import * as db from './db.js';
import { wpGet } from './wp.js';
import { state } from './data.js';
import { normalizeCode, releaseCode, releaseTitleKey } from './matching.js';
import { decodeEntities, toast } from './util.js';
import { setActor, setQuery } from './ui/list.js';

const OTOKOKI = 'https://otokoki.net/';
const ACTOR_ROOT = 4877; // otokoki の「出演者」カテゴリ
const MAX_PAGES = 5; // 100 件 × 5 ページ（出演作がいちばん多い人で 500 件ほど）
const TTL = 3 * 24 * 60 * 60 * 1000;
const clean = (s) => s.replace(/^[_＿◆■●]+/, '').trim();

// 出演作の照合の材料 { codes: [正規化した品番], tkeys: [タイトルのキー] }。見つからなければ null
async function works(name) {
  const kvKey = 'actor:' + name;
  const cached = await db.kvGet(kvKey, null);
  if (cached && Date.now() - cached.at < TTL) return cached.found ? cached : null;
  const { data: cats } = await wpGet(OTOKOKI, 'categories', { search: name, parent: ACTOR_ROOT, per_page: 20, _fields: 'id,name' });
  const cat = (cats || []).find((c) => clean(decodeEntities(c.name)) === name);
  if (!cat) { await db.kvSet(kvKey, { at: Date.now(), found: false }); return null; }
  const codes = new Set(), tkeys = new Set();
  for (let page = 1, total = 1; page <= Math.min(total, MAX_PAGES); page++) {
    const { data, totalPages } = await wpGet(OTOKOKI, 'posts', { categories: cat.id, per_page: 100, page, _fields: 'id,title' });
    total = totalPages;
    for (const p of data || []) {
      const title = decodeEntities(p.title && p.title.rendered);
      const c = releaseCode(title), t = releaseTitleKey(title);
      if (c) codes.add(c);
      if (t) tkeys.add(t);
    }
  }
  const row = { at: Date.now(), found: true, codes: [...codes], tkeys: [...tkeys] };
  await db.kvSet(kvKey, row);
  return row;
}

// 照合の材料に当たる動画の key（品番は掲載元の各投稿の品番も見る。タイトルは各投稿のタイトル）
function match({ codes, tkeys }) {
  const C = new Set(codes), T = new Set(tkeys);
  const keys = new Set();
  for (const v of state.videos) {
    for (const s of v.sources) {
      if ((s.code && C.has(normalizeCode(s.code))) || (T.size && T.has(releaseTitleKey(s.title || '')))) { keys.add(v.key); break; }
    }
  }
  return keys;
}

// 名前での検索に当たる動画（短すぎる語は無関係の作品まで当たるので使わない）
function textHits(q) {
  const w = (q || '').normalize('NFKC').toLowerCase().trim();
  const keys = new Set();
  if (w.length < 3) return keys;
  for (const v of state.videos) if (v.hay.includes(w)) keys.add(v.key);
  return keys;
}

// 出演者の作品を一覧に出す。otokoki で見つからなければ、これまでどおり名前で検索する（fallbackQuery）
export async function showActor(name, fallbackQuery) {
  name = clean(name);
  toast(`${name} の出演作を探しています…`);
  let keys = new Set();
  try {
    const w = await works(name);
    if (w) keys = match(w);
  } catch {
    // 通信できなければ名前での検索だけにする
  }
  for (const k of textHits(fallbackQuery)) keys.add(k);
  if (!keys.size) return setQuery(fallbackQuery || name);
  setActor(name, keys);
  toast(`${name} の出演作 ${keys.size.toLocaleString()} 本`);
}
