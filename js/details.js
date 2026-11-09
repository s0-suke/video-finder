// 外部サイトから取る詳細情報（説明文・画像・出演者/ジャンルなど）
//
// 公開する関数（detail.js / main.js から使う。名前と引数は変えないこと）
//   init()                                        起動時に 1 回呼ばれる
//   mountDetails(container, video, { onTag, onStudio })
//       詳細シートの container に、説明文・画像・出演者/ジャンルなどを非同期で描画する。
//       タグ的なものを押したら onTag(文字列) を、スタジオを押したら onStudio(studioKey) を呼ぶ。
//
// 情報源
//   1. otokoki.net（WordPress。CORS 可）… 品番 → タイトルの順に検索し、品番またはタイトルの一致を確かめてから使う。
//      説明文・アイキャッチ画像・カテゴリ（出演者・体型・プレイなど。親カテゴリでグループ分け）を取る。
//      結果は IndexedDB の details に { key, fetchedAt, version, found, otokoki } で保存する
//      （見つかったら 14 日、見つからなければ 3 日は取り直さない。通信エラーは保存しない）。
//   2. 掲載元サイトの本文（source.js の loadContent）… 説明文と場面写真。otokoki と重なる段落・画像は省く。
//   3. レーベル公式サイトのサンプル画像 … HTML は CORS で読めないので、品番から画像 URL を組み立て、
//      new Image() で読めたものだけ使う（読めなければ外す）。分かっている規則は previewSources() を参照。
//
// 画像（アイキャッチ・場面写真・サンプル画像）は重複を除いて 2 列のグリッドにまとめる（スワイプしなくても全体が見渡せるように）。
// 多いときは最初の SHOTS_FOLDED 枚だけ出して「すべて表示」で広げる。タップで全画面表示（全画面では左右に送れる）。

import * as db from './db.js';
import { wpGet } from './wp.js';
import { loadContent } from './source.js';
import { noteRelease } from './release.js';
import { state } from './data.js';
import { normalizeCode, normalizeTitle, stripCode, studioKey, safeUrl } from './matching.js';
import { esc, decodeEntities } from './util.js';

const OTOKOKI = 'https://otokoki.net/';
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
const JUNK_IMAGE = /favicon|vidara|firestream|dood|streamtape|mixdrop|filemoon|\/voe[-_.]|avatar|\/ads?\//i;

const memo = new Map(); // video.key -> Promise（同じセッション中に開き直したときの重複取得を防ぐ）
const parentOf = new Map(); // otokoki のカテゴリ id -> { name, parent }

export function init() {}

export function mountDetails(container, video, { onTag, onStudio } = {}) {
  if (!container || !video) return;
  container.innerHTML = skeletonHTML();
  container.classList.add('dt-root');
  // otokoki と掲載元は別々に待ち、先に揃った分から描く
  // （otokoki が見つかればすぐ描き、掲載元の本文が届いたら足して描き直す）
  let oto; // undefined = 取得中、null = なし
  let src; // undefined = 取得中
  let pre = []; // レーベルのサンプル画像（届いたら足す）
  const update = () => {
    if (oto === undefined || (oto === null && src === undefined)) return;
    try {
      render(container, video, merge(video, oto, src || [], pre), { onTag, onStudio });
    } catch (e) {
      console.warn('details:', e);
      container.innerHTML = '';
    }
  };
  getOtokoki(video).catch(() => null).then((v) => { oto = v; update(); });
  getSources(video).catch(() => []).then((v) => { src = v; update(); });
  getPreviews(video, () => container.isConnected).catch(() => []).then((v) => {
    if (!v.length) return;
    pre = v;
    update();
  });
}

// ───────────── otokoki ─────────────

function getOtokoki(video) {
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
function videoCode(video) {
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

// ───────────── 掲載元の本文 ─────────────

// 詳細シート側（ui/detail.js）も同じ source の loadContent を呼ぶが、取得中の Promise を共有するので通信は 1 回で済む
async function getSources(video) {
  const results = await Promise.allSettled(video.sources.map(async (s) => {
    const p = await loadContent(s);
    return { siteName: s.siteName, link: s.link, description: p.description || '', images: p.images || [] };
  }));
  return results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
}

// ───────────── レーベルのサンプル画像 ─────────────
//
// 調べた規則（2026-11 時点。Referer があると 403 になるサイトがあるので、読むときは必ず no-referrer）
//   HUNK CHANNEL（hunk-ch.com。G@MES・西麻布撮影所・CRUISING など多数のレーベルを扱う）
//     https://www.hunk-ch.com/video/img/{接頭辞}/{品番}/{品番}_big01.jpg 〜 _big20 前後
//     品番は小文字。DL 版は「cr-0885_dl」、G@MES 系（OAV・OGP・DT など）は「gv/gv-oav463(_dl)」の形になる
//   ACCEED（acceed.jp）
//     https://acceed.jp/pic_base/product/ACST435/thumb/ACST435_001_b.jpg 〜 _044_b（853×480）
//   Men's Rush.TV（mensrush.tv）… 場面写真の URL は連番でない ID を含むので組み立てられない。ジャケットだけ取れる
//     https://img.mensrush.tv/goods/gt-2720_dl/gt-2720_dl.webp

const PREVIEW_CHUNK = 12; // 連番の画像を一度に確かめる枚数
const previewMemo = new Map(); // video.key -> Promise<string[]>

// alive() が false になったら（詳細を閉じた・別の動画へ移った）残りの確認を打ち切る。空の結果や打ち切りは覚えない
function getPreviews(video, alive = () => true) {
  if (!previewMemo.has(video.key)) {
    const p = loadPreviews(video, alive).then((urls) => {
      if (!urls.length || !alive()) previewMemo.delete(video.key);
      return urls;
    });
    previewMemo.set(video.key, p);
  }
  return previewMemo.get(video.key);
}

// 品番から試す画像の候補。at(i) は i 枚目（1 始まり）の URL
function previewSources(rawCode) {
  // 「OAV463」「MR-KR2391」「CR-0885_DL」→ 接頭辞と残りに分ける
  const m = String(rawCode).normalize('NFKC').toUpperCase().replace(/[_-]DL$/, '')
    .match(/^([A-Z]{2,8})[-_ ]?([A-Z]{0,6}[-_]?\d{2,8})$/);
  if (!m) return [];
  const prefix = m[1].toLowerCase();
  const rest = m[2].toLowerCase().replace(/_/g, '-');
  const code = prefix + '-' + rest; // 例: cr-0885、mr-kr2391
  const flat = (prefix + rest).replace(/-/g, ''); // 例: oav463
  const pad = (i, n) => String(i).padStart(n, '0');
  const hunk = (dir, base) => (i) => `https://www.hunk-ch.com/video/img/${dir}/${base}/${base}_big${pad(i, 2)}.jpg`;
  const list = [
    // 同じ作品の置き場所の候補。最初に見つかった 1 つだけ使う
    { group: 'hunk', max: 30, at: hunk(prefix, code) },
    { group: 'hunk', max: 30, at: hunk(prefix, code + '_dl') },
    { group: 'hunk', max: 30, at: hunk('gv', 'gv-' + flat) },
    { group: 'hunk', max: 30, at: hunk('gv', 'gv-' + flat + '_dl') },
    { group: 'mensrush', max: 1, at: () => `https://img.mensrush.tv/goods/${code}_dl/${code}_dl.webp` },
  ];
  // ACCEED は存在しないと 160KB の HTML が返るので、ACCEED の品番だけ試す
  if (/^ac/.test(prefix)) {
    const up = flat.toUpperCase();
    list.push({ group: 'acceed', max: 48, at: (i) => `https://acceed.jp/pic_base/product/${up}/thumb/${up}_${pad(i, 3)}_b.jpg` });
  }
  return list;
}

async function loadPreviews(video, alive) {
  const list = previewSources(videoCode(video));
  if (!list.length) return [];
  // まず各候補の 1 枚目を同時に確かめ、グループごとに最初に見つかった候補を使う
  const firsts = await Promise.all(list.map((s) => probeImage(s.at(1))));
  const chosen = new Map();
  list.forEach((s, i) => { if (firsts[i] && !chosen.has(s.group)) chosen.set(s.group, s); });
  const results = await Promise.all([...chosen.values()].map(async (s) => {
    const urls = [s.at(1)];
    // 2 枚目以降は PREVIEW_CHUNK 枚ずつ確かめ、欠けが出たらそこで終わり
    for (let start = 2; start <= s.max; start += PREVIEW_CHUNK) {
      if (!alive()) break;
      const idx = [];
      for (let i = start; i < start + PREVIEW_CHUNK && i <= s.max; i++) idx.push(i);
      const ok = await Promise.all(idx.map((i) => probeImage(s.at(i))));
      idx.forEach((i, k) => { if (ok[k]) urls.push(s.at(i)); });
      if (ok.some((v) => !v)) break;
    }
    return urls;
  }));
  return results.flat();
}

// 画像として読めて、アイコンでない大きさなら true（ブラウザのキャッシュに載るので、表示するときは再取得しない）
function probeImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => { img.src = ''; resolve(false); }, 15000);
    img.referrerPolicy = 'no-referrer';
    img.onload = () => { clearTimeout(timer); resolve(img.naturalWidth >= 160 && img.naturalHeight >= 90); };
    img.onerror = () => { clearTimeout(timer); resolve(false); };
    img.src = url;
  });
}

// ───────────── まとめ ─────────────

function merge(video, otokoki, sources, previews = []) {
  // 説明文: otokoki → 各掲載元の順。すでに含まれている段落は省く
  const paras = [];
  let seen = normalizeTitle(video.title) + '|';
  const add = (text) => {
    for (const para of String(text || '').split(/\n{2,}/)) {
      const t = para.trim();
      const n = normalizeTitle(t);
      if (n.length < 4 || seen.includes(n)) continue;
      if (video.code && n === normalizeTitle(video.code)) continue;
      paras.push(t);
      seen += n + '|';
    }
  };
  if (otokoki) add(otokoki.description);
  for (const s of sources) add(s.description);

  // 画像: otokoki のアイキャッチ → 掲載元の画像 → レーベルのサンプル画像。上に大きく出ているサムネイルと同じものは省く
  const images = [];
  // 同じ画像が別サイトに別名で置かれていることが多い（GT-2810.jpg / gt-2810_dl.jpg / GT-2810-400x225.webp）ので、ファイル名で比べる
  const key = (u) => {
    const path = u.split(/[?#]/)[0];
    const base = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1)).toLowerCase()
      .replace(/\.(webp|jpe?g|png|gif|avif)$/, '')
      .replace(/-\d+x\d+$/, '').replace(/-scaled$/, '').replace(/[_-]dl$/, '');
    return base.length >= 5 ? base : path.toLowerCase();
  };
  const seenImg = new Set(video.thumb ? [key(video.thumb)] : []);
  const addImg = (u) => {
    if (!u || !/^https?:/.test(u) || JUNK_IMAGE.test(u)) return;
    const k = key(u);
    if (seenImg.has(k)) return;
    seenImg.add(k);
    images.push(u);
  };
  if (otokoki) addImg(otokoki.image);
  for (const s of sources) s.images.forEach(addImg);
  previews.forEach(addImg);

  // 一覧のタグと同じものはチップに出さない（詳細シートの下に既に出ている）
  const tagSet = new Set((video.tags || []).map(normalizeTitle));
  const groups = otokoki ? otokoki.groups
    .map((g) => ({ label: g.label, items: g.items.filter((n) => !tagSet.has(normalizeTitle(n))) }))
    .filter((g) => g.items.length) : [];

  // キャッシュ済みの古い結果にも効くよう、表示の直前でも http(s) 以外の URL を捨てる
  return { description: paras.join('\n\n'), images: images.map((u) => safeUrl(u)).filter(Boolean), groups, link: otokoki && safeUrl(otokoki.link) };
}

// ───────────── 描画 ─────────────

function skeletonHTML() {
  return `<div class="dt-skeleton" aria-hidden="true">
    <div class="dt-sk-shots"><div class="dt-sk-shot"></div><div class="dt-sk-shot"></div></div>
    <div class="dt-sk-line"></div><div class="dt-sk-line"></div><div class="dt-sk-line short"></div>
  </div>`;
}

const SHOTS_FOLDED = 8; // 画像がこれより多いときは、この枚数まで出して残りは「すべて表示」で広げる（css/details.css の nth-child(n+9) と合わせる）
const dropped = new WeakMap(); // container -> 読めなかった画像の URL（描き直しても出さない）

function render(container, video, info, { onTag, onStudio }) {
  const { description, images, groups, link } = info;
  const bad = dropped.get(container) || new Set();
  dropped.set(container, bad);
  const shown = images.filter((u) => !bad.has(u));
  if (!description && !shown.length && !groups.length && !link) {
    container.innerHTML = '';
    delete container.dataset.dtSig;
    return;
  }
  // 画像以外が前回と同じなら、グリッドに画像を足すだけにする（描き直してスクロール位置が飛ばないように）
  const sig = JSON.stringify([description, groups, link]);
  if (container.dataset.dtSig === sig && container.querySelector('.dt-shots')) {
    syncShots(container, shown);
    return;
  }
  const wasOpen = !!container.querySelector('.dt-desc.open');
  const wasExpanded = !!container.querySelector('.dt-shots.expanded');
  container.dataset.dtSig = sig;
  container.innerHTML = `
    <div class="dt-shots hidden${wasExpanded ? ' expanded' : ''}">
      <div class="dt-shots-grid" data-role="grid"></div>
      <button class="dt-all hidden" data-role="all"></button>
    </div>
    ${description ? `
      <div class="dt-desc" data-role="desc">${esc(description).replace(/\n/g, '<br>')}</div>
      <button class="dt-more hidden" data-role="more">続きを読む</button>` : ''}
    ${groups.map((g) => `
      <div class="dt-group">
        <div class="dt-label">${esc(g.label)}</div>
        <div class="dt-chips">${g.items.map((n) => `<button class="dt-chip" data-dt-chip="${esc(n)}" data-dt-group="${esc(g.label)}">${esc(n)}</button>`).join('')}</div>
      </div>`).join('')}
    ${link ? `<a class="dt-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">otokoki で見る ↗</a>` : ''}
  `;

  // 説明文が長いときだけ「続きを読む」を出す
  const desc = container.querySelector('[data-role="desc"]');
  const more = container.querySelector('[data-role="more"]');
  if (desc && more && desc.scrollHeight > desc.clientHeight + 4) more.classList.remove('hidden');
  if (desc && more && wasOpen) { // 掲載元の本文が届いて描き直したときも、開いた状態を保つ
    desc.classList.add('open');
    more.classList.remove('hidden');
    more.textContent = '閉じる';
  }

  syncShots(container, shown);

  container.onclick = (e) => {
    if (e.target.closest('[data-role="more"]')) {
      const open = desc.classList.toggle('open');
      more.textContent = open ? '閉じる' : '続きを読む';
      return;
    }
    if (e.target.closest('[data-role="all"]')) {
      container.querySelector('.dt-shots').classList.add('expanded');
      return refreshShots(container);
    }
    const shot = e.target.closest('[data-dt-shot]');
    if (shot) {
      // 折りたたんで隠れている分も含めて全画面で送れるようにする
      const urls = shotUrls(container);
      return openLightbox(urls, Math.max(0, urls.indexOf(shot.dataset.dtShot)));
    }
    const chip = e.target.closest('[data-dt-chip]');
    if (chip) {
      const name = chip.dataset.dtChip;
      const group = chip.dataset.dtGroup;
      if ((group === 'サイト' || group === 'レーベル') && onStudio) {
        const k = studioKey(name);
        if (state.studios.some((s) => s.key === k)) return onStudio(k);
      }
      if (onTag) onTag(group === '出演者' ? searchQuery(name) : tagQuery(name));
    }
  };
}

// ───────────── サンプル画像の一覧（2 列のグリッド） ─────────────

const shotUrls = (container) => [...container.querySelectorAll('[data-dt-shot]')].map((s) => s.dataset.dtShot);

// まだ無い画像をグリッドの末尾に足す（並びは merge の順。既にある画像は動かさないので描き直しで位置が飛ばない）
function syncShots(container, urls) {
  const grid = container.querySelector('[data-role="grid"]');
  if (!grid) return;
  const have = new Set(shotUrls(container));
  const bad = dropped.get(container);
  for (const u of urls) {
    if (have.has(u) || bad.has(u)) continue;
    const shot = document.createElement('button');
    shot.className = 'dt-shot';
    shot.dataset.dtShot = u;
    shot.setAttribute('aria-label', '画像を拡大');
    const img = document.createElement('img');
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    img.loading = 'lazy'; // 折りたたんで隠れている分は「すべて表示」を押すまで読まない
    // 小さすぎる画像（アイコン類）や読めない画像は一覧から外す
    const drop = () => {
      bad.add(u);
      shot.remove();
      refreshShots(container);
    };
    img.addEventListener('error', drop);
    img.addEventListener('load', () => { if (img.naturalWidth < 160 || img.naturalHeight < 90) drop(); });
    img.src = u;
    shot.appendChild(img);
    grid.appendChild(shot);
  }
  refreshShots(container);
}

// 枚数が変わったら、表示の有無と「すべて表示（N 枚）」を更新する
function refreshShots(container) {
  const box = container.querySelector('.dt-shots');
  if (!box) return;
  const n = shotUrls(container).length;
  box.classList.toggle('hidden', n === 0);
  box.classList.toggle('one', n === 1);
  const all = box.querySelector('[data-role="all"]');
  const folded = n > SHOTS_FOLDED && !box.classList.contains('expanded');
  all.classList.toggle('hidden', !folded);
  all.textContent = `すべて表示（${n} 枚）`;
}

// 一覧の検索（ui/list.js）と同じ判定で、その語に当たる動画の数を数える
// （全角/半角・大小文字を無視し、空白で区切った語をすべて含むもの）
function hitCount(q) {
  const words = q.normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  let n = 0;
  for (const v of state.videos) if (words.every((w) => v.hay.includes(w))) n++;
  return n;
}

// 出演者以外（体型・プレイ・シチュエーションなど）は、タグの文字列そのもので探す
// 例: 「ガッチリ・マッチョ」は「マッチョ」に縮めない。そのままでは 1 件も当たらないときだけ短い語にする
function tagQuery(name) {
  const q = name.trim();
  return hitCount(q) > 0 ? q : searchQuery(name);
}

// チップの名前から、一覧の検索でいちばん多く引っかかる言葉を選ぶ
// 例: 「コウダイ＝スリ筋ノンケ大学生」→「コウダイ」、「デカマラ潮吹き王子/GET-film」→「デカマラ潮吹き王子」
function searchQuery(name) {
  const parts = name.split(/[＝=／/（）()【】「」・&＆、,]+/).map((p) => p.trim()).filter((p) => p.length >= 2);
  // 「褐色肌のマッチョ大学生KOGA」のように説明＋英字名になっているものは、英字名も候補にする
  const latin = name.normalize('NFKC').match(/[A-Za-z][A-Za-z0-9.']{2,}/g) || [];
  // 「/GET-film」のような所属スタジオ名は、ほかに候補があれば使わない（スタジオの全作品が出てしまう）
  const studioKeys = new Set(state.studios.map((s) => s.key));
  const all = [...new Set([...parts, ...latin, name.trim()])];
  const candidates = all.filter((c) => !studioKeys.has(studioKey(c)));
  if (!candidates.length) return name.trim();
  let best = candidates[0];
  let bestCount = 0;
  for (const c of candidates) {
    const n = hitCount(c);
    if (n > bestCount) { best = c; bestCount = n; }
  }
  return best;
}

// 画像を全画面で表示する
//   横スワイプ、または画面の左右の端（各 25%）のタップで前後へ。
//   下スワイプ・下部中央の ✕・画像の外のタップ・ブラウザの戻る操作で閉じる（片手で届く位置だけで操作できるように）。
const EDGE = 0.25; // 左右の端としてタップを前後送りに使う幅（画面幅に対する割合）
const SWIPE_CLOSE = 90; // この距離（px）以上下へスワイプしたら閉じる

function openLightbox(urls, start) {
  const box = document.createElement('div');
  box.className = 'dt-lightbox';
  box.innerHTML = `
    <div class="dt-lb-track">${urls.map((u) => `<div class="dt-lb-item"><img src="${esc(u)}" referrerpolicy="no-referrer" alt=""></div>`).join('')}</div>
    ${urls.length > 1 ? `
      <button class="dt-lb-nav prev" data-dir="-1" aria-label="前の画像">‹</button>
      <button class="dt-lb-nav next" data-dir="1" aria-label="次の画像">›</button>
      <div class="dt-lb-count"><span data-role="n">${start + 1}</span> / ${urls.length}</div>` : ''}
    <button class="dt-lb-close" aria-label="閉じる">✕</button>`;
  document.body.appendChild(box);
  const track = box.querySelector('.dt-lb-track');
  track.scrollLeft = start * track.clientWidth;
  const counter = box.querySelector('[data-role="n"]');
  const index = () => Math.round(track.scrollLeft / track.clientWidth);
  track.addEventListener('scroll', () => {
    if (counter) counter.textContent = index() + 1;
  }, { passive: true });
  const go = (dir) => {
    const to = Math.min(urls.length - 1, Math.max(0, index() + dir));
    track.scrollTo({ left: to * track.clientWidth, behavior: 'smooth' });
  };

  // 開いたら履歴を 1 つ積む。戻る操作では拡大表示だけを閉じ、詳細シートは残す
  history.pushState({ sheet: true, lightbox: true }, '');
  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    removeEventListener('popstate', onPop);
    box.classList.remove('open');
    setTimeout(() => box.remove(), 200);
  };
  const onPop = () => { if (!(history.state && history.state.lightbox)) finish(); };
  // ✕・下スワイプ・外側のタップで閉じるときは履歴を戻す（popstate で finish される）
  const close = () => { if (closed) return; if (history.state && history.state.lightbox) history.back(); else finish(); };
  addEventListener('popstate', onPop);

  // 下スワイプで閉じる（指に合わせて画像を下げ、背景を薄くする。足りなければ元に戻す）
  // 横の動きは track のスクロール（touch-action: pan-x）に任せ、縦の動きだけここで扱う
  let drag = null; // { id, x, y, dy, vertical }
  let suppressClick = false;
  const setDrag = (dy) => {
    track.style.transform = dy ? `translateY(${dy}px)` : '';
    box.style.setProperty('--dt-lb-fade', String(Math.max(0, 1 - dy / 400)));
  };
  box.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary) { drag = null; box.classList.remove('dragging'); setDrag(0); return; } // 2 本目の指（ピンチ）
    if (closed || e.button > 0 || e.target.closest('button')) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, dy: 0, vertical: null };
  });
  box.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (drag.vertical === null && Math.hypot(dx, dy) > 8) drag.vertical = Math.abs(dy) > Math.abs(dx);
    if (!drag.vertical) return;
    drag.dy = Math.max(0, dy);
    box.classList.add('dragging');
    setDrag(drag.dy);
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { vertical, dy } = drag;
    drag = null;
    box.classList.remove('dragging');
    if (!vertical) return;
    suppressClick = true; // ドラッグの後に来る click で閉じたり送ったりしない
    setTimeout(() => { suppressClick = false; }, 300);
    if (e.type === 'pointerup' && dy >= SWIPE_CLOSE) {
      box.classList.add('dismiss');
      setDrag(dy);
      close();
    } else {
      setDrag(0);
    }
  };
  box.addEventListener('pointerup', endDrag);
  box.addEventListener('pointercancel', endDrag);

  box.addEventListener('click', (e) => {
    if (suppressClick) return;
    if (e.target.closest('.dt-lb-close')) return close();
    const nav = e.target.closest('.dt-lb-nav');
    if (nav) return go(Number(nav.dataset.dir));
    // 左右の端のタップは前後送り（画像の上でも）
    if (urls.length > 1) {
      const w = box.clientWidth;
      if (e.clientX < w * EDGE) return go(-1);
      if (e.clientX > w * (1 - EDGE)) return go(1);
    }
    if (!e.target.closest('img')) close();
  });
  requestAnimationFrame(() => box.classList.add('open'));
}
