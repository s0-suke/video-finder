// スタジオのタブ（#studios）
//
// スタジオごとに「名前 + 最新の動画のカルーセル」を縦に並べた、独立したページ。
// - お気に入りのスタジオを一番上に（ホームのチップと同じ順）、そのあとは動画の多い親（会社・メーカー）から
// - カルーセルは、そのスタジオ（親なら子のレーベルも含む）の新しい動画。カードを押すと詳細、名前や「すべて」を押すとそのスタジオのホーム
// - 上の検索欄でスタジオ名を探せる。「階層」で、親子の入れ子の一覧（絞り込みのシートと同じもの）も開ける
// - お気に入りは localStorage の vfFavStudios（{ スタジオの key: 名前 }）。アプリ（iOS）がホームのチップに出すのと同じもの。
//   変えたら window に vfFavsChanged を送る（アプリ側のスクリプトが受けて、ホームのチップの並びを合わせる）

import { $, esc, toast } from '../util.js';
import { state, on, isNew } from '../data.js';
import { descendantKeys } from '../studios.js';
import { feature } from '../features.js';
import { filters, saveFilters, renderChips } from './list.js';
import { openStudioPicker } from './filters.js';
import { openDetail } from './detail.js';

export const isStudiosOpen = () => location.hash === '#studios';

const FAV_KEY = 'vfFavStudios';
const PER_ROW = 12; // カルーセルの動画の数
const FIRST = 12; // 最初に作るスタジオの数（続きはスクロールで足す）
const MORE = 12;

const loadFavs = () => { try { return JSON.parse(localStorage.getItem(FAV_KEY) || '{}') || {}; } catch { return {}; } };
function saveFavs(favs) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); } catch { /* 保存できなくても動かす */ }
  dispatchEvent(new Event('vfFavsChanged'));
}

let order = []; // 並べるスタジオ（{ s（スタジオ）, fav }）
let shown = 0;
let built = false;

const SORT_KEY = 'studioSort';
const loadSort = () => { try { return localStorage.getItem(SORT_KEY) === 'new' ? 'new' : 'many'; } catch { return 'many'; } };

/** 親（根）のスタジオを、最新の動画が新しい順に並べた key の一覧。state.videos は新しい順なので、先頭から最初に出てきた順になる */
function rootsByNewest() {
  const byKey = new Map(state.studios.map((s) => [s.key, s]));
  const rootOf = new Map();
  const root = (k) => {
    if (rootOf.has(k)) return rootOf.get(k);
    let cur = k;
    const seen = new Set();
    for (let s = byKey.get(cur); s && s.parent && !seen.has(cur); s = byKey.get(cur)) { seen.add(cur); cur = s.parent; }
    rootOf.set(k, cur);
    return cur;
  };
  const wanted = state.studios.filter((s) => !s.parent && s.total > 0).length;
  const out = [];
  const seenRoot = new Set();
  for (const v of state.videos) {
    if (!v.studioKey) continue;
    const r = root(v.studioKey);
    if (!seenRoot.has(r)) { seenRoot.add(r); out.push(r); if (out.length >= wanted) break; }
  }
  return out;
}

/** 並べるスタジオ: 検索中は名前が当てはまるもの、そうでなければ お気に入り → 親（動画の多い順 / 最新の動画が新しい順） */
function buildOrder() {
  const favs = loadFavs();
  const byKey = new Map(state.studios.map((s) => [s.key, s]));
  const w = $('#studio-q').value.trim().normalize('NFKC').toLowerCase();
  if (w) {
    return state.studios.filter((s) => s.name.normalize('NFKC').toLowerCase().includes(w) && s.total > 0)
      .slice(0, 60).map((s) => ({ s, fav: s.key in favs }));
  }
  const out = [];
  const seen = new Set();
  for (const k of Object.keys(favs)) {
    const s = byKey.get(k);
    if (s && !seen.has(k)) { out.push({ s, fav: true }); seen.add(k); }
  }
  const roots = loadSort() === 'new'
    ? rootsByNewest().map((k) => byKey.get(k)).filter(Boolean)
    : state.studios.filter((s) => !s.parent && s.total > 0);
  for (const s of roots) if (!seen.has(s.key)) { out.push({ s, fav: false }); seen.add(s.key); }
  return out;
}

/** そのスタジオ（子を含む）の新しい動画。state.videos は新しい順なので、先頭から PER_ROW 件で止める */
function latestOf(s) {
  const keys = descendantKeys(state.studios, s.key);
  const out = [];
  for (const v of state.videos) {
    if (keys.has(v.studioKey)) { out.push(v); if (out.length >= PER_ROW) break; }
  }
  return out;
}

function cardHTML(v, i) {
  return `<button class="card" data-i="${i}">
    <div class="thumb">
      ${v.thumb ? `<img src="${esc(v.thumb)}" loading="lazy" referrerpolicy="no-referrer" alt="">` : `<div class="ph">${esc(v.studio || v.title.slice(0, 12))}</div>`}
      ${v.code ? `<span class="badge code">${esc(v.code)}</span>` : ''}
      ${feature('newBadge') && isNew(v) ? '<span class="badge new">NEW</span>' : ''}
    </div>
    <div class="title">${esc(v.title)}</div>
  </button>`;
}

function sectionHTML({ s, fav }) {
  const vids = latestOf(s);
  const kids = s.children.length;
  return `<section class="sf" data-key="${esc(s.key)}">
    <div class="sf-head">
      <button class="sf-star ${fav ? 'on' : ''}" data-fav="${esc(s.key)}" aria-label="${fav ? 'お気に入りから外す' : 'お気に入りにする'}">${fav ? '★' : '☆'}</button>
      <button class="sf-title" data-open="${esc(s.key)}"><span class="sf-name">${esc(s.name)}</span><small>${s.total.toLocaleString()} 本${kids ? ` · ${kids} レーベル` : ''}</small></button>
      <button class="sf-all" data-open="${esc(s.key)}" aria-label="${esc(s.name)}をすべて見る">すべて ›</button>
    </div>
    <div class="sf-row">${vids.map(cardHTML).join('')}${s.total > vids.length ? `<button class="sf-more" data-open="${esc(s.key)}" aria-label="${esc(s.name)}をすべて見る"><span>すべて見る</span><b>${s.total.toLocaleString()} 本 ›</b></button>` : ''}</div>
  </section>`;
}

function paint(reset = true) {
  const feed = $('#studio-feed');
  if (reset) { order = buildOrder(); shown = 0; feed.innerHTML = ''; }
  const next = order.slice(shown, shown + (shown ? MORE : FIRST));
  feed.insertAdjacentHTML('beforeend', next.map(sectionHTML).join(''));
  shown += next.length;
  $('#studio-empty').classList.toggle('hidden', order.length > 0);
}

/** 作り直す。いまのスクロール位置と、ここまでに作った数を保つ（収集が進むたびに呼ばれても、位置が飛ばないように） */
function repaint() {
  const y = window.scrollY;
  const keep = Math.max(shown, FIRST);
  paint();
  while (shown < keep && shown < order.length) paint(false);
  window.scrollTo(0, y);
}

/** ☆ の表示だけを更新する（並べ替えは、次に開いたときに反映する。押した行が画面から消えないように） */
function markStar(key, on) {
  const star = $(`#studio-feed .sf[data-key="${CSS.escape(key)}"] .sf-star`);
  if (!star) return;
  star.classList.toggle('on', on);
  star.textContent = on ? '★' : '☆';
  star.setAttribute('aria-label', on ? 'お気に入りから外す' : 'お気に入りにする');
}

/** ホームの一覧へ移る（タブの切り替えは履歴に積まない） */
function goHomeWith(key) {
  filters.studio = key;
  filters.view = '';
  saveFilters();
  renderChips();
  history.replaceState(history.state, '', location.pathname + location.search);
  dispatchEvent(new HashChangeEvent('hashchange'));
  dispatchEvent(new Event('viewchange')); // タブバーの表示を合わせる
}

function init() {
  built = true;
  const q = $('#studio-q');
  let timer = 0;
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => paint(), 150); });
  $('#studio-tree').onclick = openStudioPicker; // 親子の入れ子の一覧（選ぶと、そのスタジオのホーム）
  // 並び順: 動画の多い順 / 最新の動画が新しい順（お気に入りは、どちらでも先頭）
  const paintSort = () => { for (const b of document.querySelectorAll('#studio-sort button')) { const on = b.dataset.sort === loadSort(); b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); } };
  paintSort();
  $('#studio-sort').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.dataset.sort === loadSort()) return;
    try { localStorage.setItem(SORT_KEY, b.dataset.sort); } catch { /* 保存できなくても、このあいだは効く */ }
    paintSort();
    window.scrollTo(0, 0);
    paint();
  };
  new IntersectionObserver((e) => { if (e[0].isIntersecting && isStudiosOpen() && shown < order.length) paint(false); }, { rootMargin: '600px' })
    .observe($('#studio-sentinel'));
  $('#studio-feed').addEventListener('click', (e) => {
    const star = e.target.closest('[data-fav]');
    if (star) {
      const favs = loadFavs();
      const key = star.dataset.fav;
      const s = state.studios.find((x) => x.key === key);
      if (key in favs) delete favs[key]; else favs[key] = s ? s.name : key;
      saveFavs(favs);
      toast(key in favs ? `★ ${favs[key]} をお気に入りにしました` : `${s ? s.name : key} をお気に入りから外しました`);
      markStar(key, key in favs);
      return;
    }
    const open = e.target.closest('[data-open]');
    if (open) return goHomeWith(open.dataset.open);
    const card = e.target.closest('.card');
    if (card) {
      const sec = card.closest('.sf');
      const s = state.studios.find((x) => x.key === sec.dataset.key);
      const vids = s ? latestOf(s) : [];
      openDetail(vids[+card.dataset.i], { list: vids, index: +card.dataset.i });
    }
  });
  // 収集が進んだら、開いている間は描き直す（スクロール位置は保つ）
  on('data', () => { if (isStudiosOpen()) repaint(); });
}

/** ページを開いたとき（main.js の route から） */
export function openStudios() {
  if (!built) init();
  paint();
}
