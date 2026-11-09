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

import * as db from './db.js';
import { wpGet } from './wp.js';
import { loadContent } from './source.js';
import { state } from './data.js';
import { normalizeCode, normalizeTitle, stripCode, studioKey } from './matching.js';
import { esc, decodeEntities } from './util.js';

const OTOKOKI = 'https://otokoki.net/';
const CACHE_VERSION = 2; // 保存する形や探し方を変えたら上げる（古いキャッシュを取り直す）
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
  const update = () => {
    if (oto === undefined || (oto === null && src === undefined)) return;
    try {
      render(container, video, merge(video, oto, src || []), { onTag, onStudio });
    } catch (e) {
      console.warn('details:', e);
      container.innerHTML = '';
    }
  };
  getOtokoki(video).catch(() => null).then((v) => { oto = v; update(); });
  getSources(video).catch(() => []).then((v) => { src = v; update(); });
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
    return cached.otokoki || null;
  }
  const post = await findPost(video);
  const otokoki = post ? await buildOtokoki(post) : null;
  const row = { key: video.key, fetchedAt: Date.now(), version: CACHE_VERSION, found: !!otokoki, otokoki };
  try { await db.put('details', row); } catch {}
  return otokoki;
}

const SEARCH_FIELDS = 'id,link,title,content,featured_media,categories';

async function search(q) {
  const { data } = await wpGet(OTOKOKI, 'posts', { search: q, per_page: 5, _fields: SEARCH_FIELDS });
  return Array.isArray(data) ? data : [];
}

// 品番 → タイトルの順に探す。どちらも一致を確かめたものだけ返す
async function findPost(video) {
  // 品番として抽出されていなくても、タイトル先頭の「OAV463 – 」「ACST435 – 」のような英字＋数字は品番として試す
  const loose = !video.code && (decodeEntities(video.title).match(/^\s*([A-Z]{2,8}\d{3,8})(?=[_\s–\-:])/) || [])[1];
  const code = video.code || loose;
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

// 品番の前後が英数字で続いていない箇所だけを一致とみなす（GT-272 が GT-2720 に一致しないように）
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
    link: post.link,
    title: decodeEntities(post.title.rendered),
    description: otokokiDescription(post.content.rendered),
    image: image || null,
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

// 詳細シート側（ui/detail.js）も同じ source の loadContent を呼んでいる。
// 先に始まった取得が終わるのを少し待ち、同じ投稿を 2 回取りに行かないようにする
async function getSources(video) {
  const results = await Promise.allSettled(video.sources.map(async (s) => {
    for (let i = 0; i < 20 && s.description === undefined; i++) await new Promise((r) => setTimeout(r, 250));
    const p = await loadContent(s);
    return { siteName: s.siteName, link: s.link, description: p.description || '', images: p.images || [] };
  }));
  return results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
}

// ───────────── まとめ ─────────────

function merge(video, otokoki, sources) {
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

  // 画像: otokoki のアイキャッチ → 掲載元の画像。上に大きく出ているサムネイルと同じものは省く
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

  // 一覧のタグと同じものはチップに出さない（詳細シートの下に既に出ている）
  const tagSet = new Set((video.tags || []).map(normalizeTitle));
  const groups = otokoki ? otokoki.groups
    .map((g) => ({ label: g.label, items: g.items.filter((n) => !tagSet.has(normalizeTitle(n))) }))
    .filter((g) => g.items.length) : [];

  return { description: paras.join('\n\n'), images, groups, link: otokoki && otokoki.link };
}

// ───────────── 描画 ─────────────

function skeletonHTML() {
  return `<div class="dt-skeleton" aria-hidden="true">
    <div class="dt-sk-line"></div><div class="dt-sk-line"></div><div class="dt-sk-line short"></div>
    <div class="dt-sk-gallery"><div></div><div></div><div></div></div>
  </div>`;
}

function render(container, video, info, { onTag, onStudio }) {
  const { description, images, groups, link } = info;
  if (!description && !images.length && !groups.length && !link) {
    container.innerHTML = '';
    return;
  }
  const wasOpen = !!container.querySelector('.dt-desc.open');
  container.innerHTML = `
    ${description ? `
      <div class="dt-desc" data-role="desc">${esc(description).replace(/\n/g, '<br>')}</div>
      <button class="dt-more hidden" data-role="more">続きを読む</button>` : ''}
    ${images.length ? `
      <div class="dt-gallery">${images.map((u, i) => `
        <button class="dt-shot" data-dt-shot="${i}"><img src="${esc(u)}" loading="lazy" referrerpolicy="no-referrer" alt=""></button>`).join('')}
      </div>` : ''}
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

  // 小さすぎる画像（アイコン類）や読めない画像はギャラリーから外す
  container.querySelectorAll('.dt-shot img').forEach((img) => {
    const drop = () => {
      img.parentElement.remove();
      const g = container.querySelector('.dt-gallery');
      if (g && !g.children.length) g.remove();
    };
    img.addEventListener('error', drop);
    img.addEventListener('load', () => { if (img.naturalWidth < 160 || img.naturalHeight < 90) drop(); });
  });

  container.onclick = (e) => {
    if (e.target.closest('[data-role="more"]')) {
      const open = desc.classList.toggle('open');
      more.textContent = open ? '閉じる' : '続きを読む';
      return;
    }
    const shot = e.target.closest('[data-dt-shot]');
    if (shot) {
      const urls = [...container.querySelectorAll('.dt-shot img')].map((img) => img.getAttribute('src'));
      const i = urls.indexOf(shot.querySelector('img').getAttribute('src'));
      return openLightbox(urls, Math.max(0, i));
    }
    const chip = e.target.closest('[data-dt-chip]');
    if (chip) {
      const name = chip.dataset.dtChip;
      const group = chip.dataset.dtGroup;
      if ((group === 'サイト' || group === 'レーベル') && onStudio) {
        const k = studioKey(name);
        if (state.studios.some((s) => s.key === k)) return onStudio(k);
      }
      if (onTag) onTag(searchQuery(name));
    }
  };
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
    const w = c.toLowerCase();
    let n = 0;
    for (const v of state.videos) if (v.hay.includes(w)) n++;
    if (n > bestCount) { best = c; bestCount = n; }
  }
  return best;
}

// 画像を全画面で表示する（横スワイプで前後へ。タップか ✕ で閉じる）
function openLightbox(urls, start) {
  const box = document.createElement('div');
  box.className = 'dt-lightbox';
  box.innerHTML = `
    <div class="dt-lb-track">${urls.map((u) => `<div class="dt-lb-item"><img src="${esc(u)}" referrerpolicy="no-referrer" alt=""></div>`).join('')}</div>
    <button class="dt-lb-close" aria-label="閉じる">✕</button>
    ${urls.length > 1 ? `<div class="dt-lb-count"><span data-role="n">${start + 1}</span> / ${urls.length}</div>` : ''}`;
  document.body.appendChild(box);
  const track = box.querySelector('.dt-lb-track');
  track.scrollLeft = start * track.clientWidth;
  const counter = box.querySelector('[data-role="n"]');
  track.addEventListener('scroll', () => {
    if (counter) counter.textContent = Math.round(track.scrollLeft / track.clientWidth) + 1;
  }, { passive: true });

  const close = () => {
    removeEventListener('popstate', close);
    box.classList.remove('open');
    setTimeout(() => box.remove(), 200);
  };
  // 戻る操作でシートごと閉じたときも一緒に消す
  addEventListener('popstate', close);
  box.addEventListener('click', (e) => {
    if (e.target.closest('.dt-lb-close') || !e.target.closest('img')) close();
  });
  requestAnimationFrame(() => box.classList.add('open'));
}
