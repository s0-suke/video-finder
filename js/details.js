// 外部サイトから取る詳細情報（説明文・画像・出演者/ジャンルなど）
//
// 公開する関数（detail.js / main.js から使う。名前と引数は変えないこと）
//   init()                                        起動時に 1 回呼ばれる
//   mountDetails(container, video, { onTag, onStudio, onActor })
//       詳細シートの container に、説明文・画像・出演者/ジャンルなどを非同期で描画する。
//       タグ的なものを押したら onTag(文字列) を、スタジオを押したら onStudio(studioKey) を、
//       出演者を押したら onActor(名前, 名前で検索するときの語) を呼ぶ（なければ onTag）。
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

// 構成: details/otokoki.js（otokoki の検索と照合）/ details/previews.js（レーベル公式のサンプル画像）/
//       details/lightbox.js（全画面表示）。このファイルは取得結果のまとめと描画。

import { loadContent } from './source.js';
import { state } from './data.js';
import { normalizeTitle, studioKey, safeUrl } from './matching.js';
import { esc } from './util.js';
import { getOtokoki } from './details/otokoki.js';
import { getPreviews } from './details/previews.js';
import { openLightbox } from './details/lightbox.js';

const JUNK_IMAGE = /favicon|vidara|firestream|dood|streamtape|mixdrop|filemoon|\/voe[-_.]|avatar|\/ads?\//i;

export function init() {}

export function mountDetails(container, video, { onTag, onStudio, onActor } = {}) {
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
      render(container, video, merge(video, oto, src || [], pre), { onTag, onStudio, onActor });
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


// ───────────── 掲載元の本文 ─────────────

// 詳細シート側（ui/detail.js）も同じ source の loadContent を呼ぶが、取得中の Promise を共有するので通信は 1 回で済む
async function getSources(video) {
  const results = await Promise.allSettled(video.sources.map(async (s) => {
    const p = await loadContent(s);
    return { siteName: s.siteName, link: s.link, description: p.description || '', images: p.images || [] };
  }));
  return results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
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

function render(container, video, info, { onTag, onStudio, onActor }) {
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
      if (group === '出演者' && onActor) return onActor(name, searchQuery(name));
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

