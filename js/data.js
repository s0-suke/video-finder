// メモリ上のデータ（サイト・投稿・統合後の動画）と、変更通知
//
// events で流れるイベント
//   'data'      動画一覧が作り直された
//   'progress'  収集の進み具合が変わった
//   'favs'      お気に入りが変わった（favorites.js が発行）

import * as db from './db.js';
import { buildStudioTree } from './studios.js';
import { studioKey, isNoiseTag, studioCandidates, studioRank, chooseStudio, extractCode, isCodeForm, groupKey, isCodeTag, normalizeCode, codesOf, titleKeyOf, titleSimilarity, clusterPosts, releaseTitleKey, plausibleRelease, stripCode, safeUrl } from './matching.js';
import { buildEstimateIndex, estimateRelease } from './release-estimate.js';

// 投稿ごとに覚えておく、統合・スタジオ・検索の材料（rebuild のたびに 6 万件分を作り直さないため）。
// 投稿の中身（タイトル・品番・タグ・スタジオ）を書き換えたときは forgetPost で消す（収集で取り直した投稿は別のオブジェクトになる）。
// - 統合（clusterPosts に渡す形。codes / tkey / grams は codesOf / titleKeyOf / titleGrams の結果。grams は clusterPosts が必要なときに埋める）
// - スタジオ名の候補（cands）。スタジオ名は保存した値を使わず、rebuild のたびにタグ・カテゴリ（p.tags）から選び直す
//   （判定を改良したときに保存済みの投稿にも効くように）。保存しておいたスタジオ名は、タグ・カテゴリに候補がないときの予備（最後の候補）
// - 検索用の文字列（hay）と、otokoki の記事との照合に使うタイトルのキー（rkey）
const infoCache = new WeakMap();
function infoOf(p) {
  let c = infoCache.get(p);
  if (!c) {
    const tags = p.tags || [];
    c = {
      key: p.key, siteId: p.siteId, code: p.code, title: p.title, tags, group: p.group,
      codes: codesOf(p.title || '', tags, p.code), tkey: titleKeyOf(p.title), grams: null, cands: null, hay: null, rkey: undefined,
    };
    infoCache.set(p, c);
  }
  return c;
}
export const forgetPost = (p) => { infoCache.delete(p); lastInput = null; groupMemo.clear(); buildSeq++; };

// 前回の rebuild の材料（投稿が 1 件も変わっていなければ、まとめ方とスタジオの順位をそのまま使う）
let lastInput = null; // { posts, sites, groupOf, rank }
// 動画ごとの重い材料（タグ・検索用の文字列など）。まとまった投稿とスタジオが前回と同じなら使い回す（統合キー → 材料）
const groupMemo = new Map();
const sameRows = (a, b) => a.length === b.length && a.every((r, i) => r === b[i]);
function studioCandsOf(p) {
  const c = infoOf(p);
  return c.cands || (c.cands = studioCandidates([...c.tags, p.studio]));
}
// 検索用の文字列（投稿ごと）
function hayOf(p) {
  const c = infoOf(p);
  return c.hay || (c.hay = [p.title, ...c.tags].join('\n').normalize('NFKC').toLowerCase());
}
// otokoki の記事との照合に使うタイトルのキー
function releaseKeyOf(p) {
  const c = infoOf(p);
  return c.rkey !== undefined ? c.rkey : (c.rkey = releaseTitleKey(p.title || ''));
}
// 品番だけのタグか（表示用のタグから除く。同じタグが何度も出るので覚えておく）
const codeTagCache = new Map();
function codeTag(t) {
  let r = codeTagCache.get(t);
  if (r === undefined) { if (codeTagCache.size > 100000) codeTagCache.clear(); codeTagCache.set(t, (r = isCodeTag(t))); }
  return r;
}

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
  studios: [], // { key, name, count（自分の本数）, total（子を含む本数）, parent（親の key。なければ ''）, children（子の key）, virtual（掲載元に単独では付かない親）}（total の多い順）
  // 発売日（release.js が埋める）
  //   official: 公式の配信日（CK DOWNLOAD）。'key:<video.key>' / 'code:<正規化した品番>' -> 日付
  //   byCode / byTitle: otokoki の掲載日（発売日の目安）
  release: { official: new Map(), byCode: new Map(), byTitle: new Map() },
};

// 発売日の出どころ（video.releaseSrc）
//   'official' 公式の配信日（CK DOWNLOAD） / 'otokoki' otokoki の掲載日（目安）
//   'estimate' 同じレーベルの前後の品番の発売日からの推定（release-estimate.js。video.releaseEst に根拠） / '' 不明
// 公式 → otokoki（品番 → タイトルの順）の順に探す。掲載元の最初の投稿日より遅い日付は使わない（matching.js の plausibleRelease）
const firstPosted = (rows) => rows.reduce((d, r) => (r.date && (!d || r.date < d) ? r.date : d), '');

function releaseOf(key, code, rows) {
  const first = firstPosted(rows);
  const ok = (d) => plausibleRelease(d, first);
  const off = state.release.official.get('key:' + key) || (code && state.release.official.get('code:' + normalizeCode(code)));
  if (ok(off)) return { date: off, src: 'official' };
  if (code) {
    const d = state.release.byCode.get(normalizeCode(code));
    if (ok(d)) return { date: d, src: 'otokoki' };
  }
  if (!state.release.byTitle.size) return null;
  for (const r of rows) {
    const k = releaseKeyOf(r);
    const d = k && state.release.byTitle.get(k);
    if (ok(d)) return { date: d, src: 'otokoki' };
  }
  return null;
}

// 既知の発売日（公式・otokoki）から作った、品番の接頭辞ごとの点列（rebuild のたびに作り直す）
let estimateIndex = new Map();

// 既知の発売日がない動画の推定（品番があり、前後の既知の品番に挟まれるときだけ。掲載元の最初の投稿日より遅ければ使わない）
function estimateOf(code, rows) {
  if (!code) return null;
  const e = estimateRelease(estimateIndex, code);
  return e && plausibleRelease(e.date, firstPosted(rows)) ? e : null;
}

const releaseFields = (key, code, rows) => {
  const r = releaseOf(key, code, rows);
  return { release: r ? r.date : '', releaseKnown: !!r, releaseSrc: r ? r.src : '', releaseEst: null };
};

const estimateFields = (code, rows) => {
  const e = estimateOf(code, rows);
  return e ? { release: e.date, releaseSrc: 'estimate', releaseEst: { from: e.from, to: e.to } } : null;
};

// 発売日の対応表が増えたときに、一覧を作り直さずに 1 本だけ発売日を付け直す（release.js から使う）。
// 既知の日付がなければ、前回の rebuild の点列で推定する（点列への反映は次の rebuild）
export function applyRelease(video) {
  Object.assign(video, releaseFields(video.key, video.code, video.sources));
  if (!video.releaseKnown) Object.assign(video, estimateFields(video.code, video.sources));
}

// 収集で新しく見つかってから NEW 表示にしておく期間
const NEW_MS = 3 * 24 * 60 * 60 * 1000;
export const isNew = (v) => v.seenAt > Date.now() - NEW_MS;

export const events = new EventTarget();
export const emit = (type, detail) => events.dispatchEvent(new CustomEvent(type, { detail }));
export const on = (type, fn) => events.addEventListener(type, (e) => fn(e.detail));

// 保存済み投稿の移行（migratePost）を済ませた版。判定を変えて移行し直すときに上げる
const MIGRATE_KEY = 'postsMigrated';
const MIGRATE_VERSION = 2;

export async function loadAll() {
  state.sites = await db.getAll('sites');
  // 移行は版ごとに一度だけ（毎回の起動で 6 万件を判定し直さない）
  const migrate = (await db.kvGet(MIGRATE_KEY, 0)) < MIGRATE_VERSION;
  const fixed = [];
  for (const p of await db.getAll('posts')) {
    if (migrate && migratePost(p)) fixed.push(p);
    state.posts.set(p.key, p);
  }
  if (fixed.length) await db.putAll('posts', fixed);
  if (migrate) await db.kvSet(MIGRATE_KEY, MIGRATE_VERSION);
}

// 分割番号の付いていない品番（GDSR-002。GDSR-002-1 や COCO566-02 は対象外）
const NO_PART_CODE = /^[A-Z]{2,8}-(?:[A-Z]{1,4}-?)?\d{2,6}$/;

// 品番の判定を改良したとき用: 保存済み投稿の品番を判定し直す（変わったら true）。何度通しても結果は変わらない。
// - 品番のない投稿 → 新しい判定で品番が取れれば付ける
// - 一般語（Part-02 など）を誤って品番にしていた投稿 → 外す（タイトル先頭・タグからしか取れない形の品番は残す: isCodeForm）
// - 外部 URL が http(s) でないリンクは捨てる
// - 分割番号（GDSR-002-2）を落として「2 – タイトル」と保存した投稿 → 品番に分割番号を戻す（品番が分割番号なしの形のときだけ）
// - タイトルの途中の語を品番にしていた投稿（「涼真-RYOMA-19歳が…」の RYOMA-19）→ 判定し直す
export function migratePost(p) {
  const changed = migrateFields(p);
  if (changed) forgetPost(p);
  return changed;
}

function migrateFields(p) {
  let changed = false;
  if (p.link && !safeUrl(p.link)) { p.link = ''; changed = true; }
  if (p.code && !isCodeForm(p.code)) {
    p.code = null;
    p.group = groupKey(null, p.title, p.key);
    changed = true;
  }
  if (p.code) {
    const part = NO_PART_CODE.test(p.code) && p.title.match(/^(\d{1,3}|[A-F])\s+[–—-]\s+/);
    if (part) {
      p.code = `${p.code}-${part[1]}`;
      p.title = p.title.slice(part[0].length);
      p.group = groupKey(p.code, p.title, p.key);
      return true;
    }
    // 品番がそのままの形でタイトルの途中に残っている（先頭から外せなかった）ものだけ判定し直す。
    // 末尾の「– DT020」のようにハイフンなしで書かれたもの、「GLOSSMEN NM74 …」のように語として書かれたものは、
    // タグから取った品番なので残す（以前の版で保存した投稿は品番だけのタグを持っていないので、タイトルの語をタグ代わりに確かめる）
    if (!p.title.toUpperCase().includes(p.code)) return changed;
    const again = extractCode(p.title, [...(p.tags || []), ...p.title.split(/\s+/)]);
    if (again === p.code) return changed;
    p.code = null;
    p.group = groupKey(null, p.title, p.key);
    changed = true;
  }
  const code = extractCode(p.title, p.tags || []);
  if (!code) return changed;
  p.code = code;
  p.title = stripCode(p.title, code);
  p.group = groupKey(code, p.title, p.key);
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

// 一覧の作り直し。
// rebuild() はその場で最後まで行う。rebuildAsync() は少しずつ区切って進め、合間に画面の操作を受け付ける
// （収集中の定期的な作り直しで、スクロールやタップが引っかからないように）。
// 途中で別の作り直しが始まったり投稿が書き換えられたりしたら、古いほうの結果は捨てる（戻り値 false）
let buildSeq = 0;

export function rebuild() {
  const g = build();
  let r;
  while (!(r = g.next()).done);
  return r.value;
}

const SLICE_MS = 12;
const nextTask = () => new Promise((res) => setTimeout(res, 0));
export async function rebuildAsync() {
  const g = build();
  for (;;) {
    const end = performance.now() + SLICE_MS;
    let r;
    while (!(r = g.next()).done) if (performance.now() > end) break;
    if (r.done) return r.value;
    await nextTask();
  }
}

function* build() {
  const seq = ++buildSeq;
  const enabled = new Set(state.sites.filter((s) => s.enabled).map((s) => s.id));
  const siteName = Object.fromEntries(state.sites.map((s) => [s.id, s.name]));
  const posts = [...state.posts.values()].filter((p) => enabled.has(p.siteId));
  // 投稿が前回と同じ（発売日の対応表が増えただけなど）なら、まとめ方とスタジオの順位を作り直さない
  const sitesKey = [...enabled].sort().join(',');
  const same = lastInput && lastInput.sites === sitesKey && sameRows(posts, lastInput.posts);
  // 品番（別の書き方・別の番号も含む）とタイトルで投稿をまとめる（matching.js の clusterPosts）
  const groupOf = same ? lastInput.groupOf : clusterPosts(posts.map(infoOf));
  yield;
  const groups = new Map();
  for (const p of posts) {
    const k = groupOf.get(p.key) || p.group;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = []));
    g.push(p);
  }

  // スタジオ名: レーベルらしさ（単独で付いていた投稿の数）を数え、投稿ごと・動画ごとに選び直す。
  // 表記ゆれはまとめ、いちばん多い表記を表示名にする
  const rank = same ? lastInput.rank : studioRank(posts.map(studioCandsOf));
  lastInput = { posts, sites: sitesKey, groupOf, rank };
  const studioOf = (p) => chooseStudio(studioCandsOf(p), rank);
  const studioNames = new Map(); // key -> Map(name -> count)
  const videos = [];
  const memoUsed = new Set();
  let n = 0;
  for (const [key, rows] of groups) {
    if (++n % 400 === 0) yield;
    rows.sort((a, b) => (b.thumb ? 1 : 0) - (a.thumb ? 1 : 0) || (a.date < b.date ? 1 : -1));
    const main = rows[0];
    // 投稿ごとのスタジオのうち、メーカーと分かっているもの（販売サイトより絞り込まれたもの）を採る
    const studio = chooseStudio(studioCandidates(rows.map(studioOf).filter(Boolean)), rank);
    const sKey = studio ? studioKey(studio) : null;
    // まとまった投稿とスタジオが前回と同じなら、タグ・検索用の文字列などを使い回す
    let m = groupMemo.get(key);
    if (!m || m.studio !== studio || !sameRows(rows, m.rows)) {
      const rawTags = [...new Set(rows.flatMap((r) => r.tags))];
      m = {
        rows, // groups の配列は rebuild ごとに作り直すので、そのまま持っておける
        studio,
        // 表示用のタグからは、分類タグ・品番だけのタグ・スタジオ名の言い換え（MEN'S RUSH など）を除く。検索には全部使う
        tags: rawTags.filter((t) => !isNoiseTag(t) && !codeTag(t) && !(sKey && studioKey(t).length >= 4 && sKey.startsWith(studioKey(t)))),
        date: rows.reduce((d, r) => (r.date > d ? r.date : d), ''),
        siteIds: new Set(rows.map((r) => r.siteId)),
        // どこかのサイトで最初に見つかった時刻（初回の全件取得分は 0 = NEW にしない）
        seenAt: rows.reduce((t, r) => Math.min(t, r.seenAt || 0), Infinity),
        hay: [...rows.map(hayOf), (main.code || '').toLowerCase(), (studio || '').normalize('NFKC').toLowerCase()].join('\n'),
      };
      groupMemo.set(key, m);
    }
    memoUsed.add(key);
    const { tags } = m;
    if (sKey) {
      let n = studioNames.get(sKey);
      if (!n) studioNames.set(sKey, (n = new Map()));
      n.set(studio, (n.get(studio) || 0) + 1);
    }
    videos.push({
      key,
      code: main.code,
      title: displayTitle(main.title, main.code), // 保存済みのタイトルに品番が残っていても表示では外す
      thumb: main.thumb,
      date: m.date,
      // 発売日（公式の配信日 → otokoki の掲載日の順）と出どころ。照合できなければ空（下で推定する）。掲載日では代用しない
      ...releaseFields(key, main.code, rows),
      studio,
      studioKey: sKey,
      tags,
      siteIds: m.siteIds,
      seenAt: m.seenAt,
      // 投稿はコピーせず参照で持つ（6 万件を毎回コピーしないため。siteName はここで付けておく）
      sources: rows.map((r) => { r.siteName = siteName[r.siteId] || '?'; return r; }),
      hay: m.hay,
    });
  }
  // 今回なくなった動画の材料は捨てる
  if (groupMemo.size > memoUsed.size) for (const k of groupMemo.keys()) if (!memoUsed.has(k)) groupMemo.delete(k);
  videos.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  // 発売日が分からない動画は、同じレーベルの前後の品番の既知の発売日から推定する（推定どうしを根拠にはしない）
  estimateIndex = buildEstimateIndex(videos.filter((v) => v.releaseKnown && v.code).map((v) => ({ code: v.code, date: v.release })));
  yield;
  for (const v of videos) if (!v.releaseKnown) Object.assign(v, estimateFields(v.code, v.sources));

  const studios = [...studioNames].map(([key, names]) => {
    const [name] = [...names].sort((a, b) => b[1] - a[1])[0];
    return { key, name, count: [...names.values()].reduce((a, b) => a + b, 0) };
  });
  const displayName = new Map(studios.map((s) => [s.key, s.name]));
  for (const v of videos) if (v.studioKey) v.studio = displayName.get(v.studioKey);
  // 親子関係（KO COMPANY > KO BEAST など。studios.js）を付ける。親は子を含めた本数（total）で並べる
  const tree = buildStudioTree(studios);
  tree.sort((a, b) => b.total - a.total || b.count - a.count);
  // 親の名前は表の正式な名前になることがある（KO → KO COMPANY）ので、動画の表示名もそれに合わせる
  const treeName = new Map(tree.map((s) => [s.key, s.name]));
  for (const v of videos) if (v.studioKey) v.studio = treeName.get(v.studioKey) || v.studio;

  if (seq !== buildSeq) return false; // 途中で新しい作り直しが始まった
  state.videos = videos;
  state.byKey = new Map(videos.map((v) => [v.key, v]));
  movedIndex = null;
  state.studios = tree;
  return true;
}

// 動画を構成している投稿の key（並びをそろえる）。お気に入り・履歴の行に残し、findMoved の付け替えに使う
export const sourceKeys = (video) => (video.sources || []).map((s) => s.key).sort();

// 統合キーが変わった動画（品番の判定を改良したとき、別の投稿とまとまったときなど）を探し直す。お気に入り・履歴の付け替えに使う。
// 保存しておいた行（{ code, title, posts }）の、構成していた投稿の key（posts）→ 品番（各動画のすべての投稿の品番）→ タイトルの順に探す。
// 品番・タイトルで候補が複数あるときは、タイトルがいちばん似ているもの
let movedIndex = null;
const addTo = (m, k, v) => { if (!k) return; const a = m.get(k); if (!a) m.set(k, [v]); else if (!a.includes(v)) a.push(v); };
export function findMoved({ code, title, posts } = {}) {
  if (!movedIndex) {
    movedIndex = { post: new Map(), code: new Map(), tkey: new Map(), title: new Map() };
    for (const v of state.videos) {
      for (const s of v.sources) {
        const info = infoOf(s);
        movedIndex.post.set(s.key, v);
        for (const c of info.codes) addTo(movedIndex.code, c, v);
        addTo(movedIndex.tkey, info.tkey, v);
      }
      if (v.code) addTo(movedIndex.code, normalizeCode(v.code), v);
      addTo(movedIndex.tkey, titleKeyOf(v.title), v);
      addTo(movedIndex.title, v.title, v);
    }
  }
  if (Array.isArray(posts) && posts.length) {
    const count = new Map();
    for (const k of posts) { const v = movedIndex.post.get(k); if (v) count.set(v, (count.get(v) || 0) + 1); }
    if (count.size) return [...count].sort((a, b) => b[1] - a[1])[0][0];
  }
  const cands = (code && movedIndex.code.get(normalizeCode(code))) ||
    (title && (movedIndex.tkey.get(titleKeyOf(title)) || movedIndex.title.get(title))) || [];
  if (cands.length < 2 || !title) return cands[0] || null;
  let best = null, bestSim = -1;
  for (const v of cands) { const s = titleSimilarity(title, v.title); if (s > bestSim) { best = v; bestSim = s; } }
  return best;
}

// お気に入り・履歴の行（{ key, code, title, posts }）がいま指すべき動画。付け替えが要らなければ null。
// - 行の key の動画がない → findMoved で探す
// - 行の key の動画はあるが、構成していた投稿が 1 つも含まれず、その投稿がほかの動画にある → そちら（統合キーが別の作品に移ったとき）
export function relocate(row) {
  if (!state.videos.length) return null;
  const v = state.byKey.get(row.key);
  if (!v) return findMoved(row);
  if (!Array.isArray(row.posts) || !row.posts.length) return null;
  if (v.sources.some((s) => row.posts.includes(s.key))) return null;
  const w = findMoved({ posts: row.posts });
  return w && w !== v ? w : null;
}

export async function saveSite(site) {
  await db.put('sites', site);
  const i = state.sites.findIndex((s) => s.id === site.id);
  if (i >= 0) state.sites[i] = site;
}
