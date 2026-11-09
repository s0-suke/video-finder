// 一覧（検索・チップ・無限スクロール）
//
// チップ: すべて / 新着 / ♥ お気に入り / 履歴 / 上位のスタジオ / スタジオ一覧…

import { $, esc, fmtDate } from '../util.js';
import { state, on, isNew } from '../data.js';
import { crawl } from '../crawler.js';
import { isFav, favAddedAt } from '../favorites.js';
import { viewedAt } from '../history.js';
import { normalizeCode } from '../matching.js';
import { isSheetOpen } from './sheet.js';
import { openDetail } from './detail.js';
import { openFilters } from './filters.js';

const PAGE = 40;
const CHIP_STUDIOS = 15;

// view: '' = すべて / 'new' = 新着 / 'fav' = お気に入り / 'history' = 履歴
const saved = (() => { try { return JSON.parse(localStorage.getItem('filters3') || '{}'); } catch { return {}; } })();
export const filters = { q: '', studio: '', site: '', sort: 'new', view: '', ...saved };
let filtered = [];
let shown = 0;

export function saveFilters() {
  try { localStorage.setItem('filters3', JSON.stringify(filters)); } catch {}
  $('#filter-btn').classList.toggle('active', !!(filters.site || filters.sort !== 'new'));
}

// 全角/半角・大文字/小文字・品番のハイフンの有無を気にせず探せるようにする
export const normalizeQuery = (s) => s.normalize('NFKC').toLowerCase();

function matches(v, words) {
  return words.every((w) => v.hay.includes(w) || (v.code && /\d/.test(w) && normalizeCode(v.code).toLowerCase().includes(w.replace(/-/g, ''))));
}

function applyFilters() {
  const words = normalizeQuery(filters.q).split(/\s+/).filter(Boolean);
  const siteId = filters.site ? +filters.site : null;
  const view = filters.view;
  filtered = state.videos.filter((v) =>
    (view !== 'fav' || isFav(v.key)) &&
    (view !== 'history' || viewedAt(v.key)) &&
    (view !== 'new' || isNew(v)) &&
    (!filters.studio || v.studioKey === filters.studio) &&
    (!siteId || v.siteIds.has(siteId)) &&
    matches(v, words));
  if (view === 'history') filtered.sort((a, b) => viewedAt(b.key) - viewedAt(a.key));
  else if (view === 'fav') filtered.sort((a, b) => favAddedAt(b.key) - favAddedAt(a.key));
  else if (filters.sort === 'old') filtered.reverse();
}

function cardHTML(v, i) {
  return `<button class="card" data-i="${i}">
    <div class="thumb">
      ${v.thumb ? `<img src="${esc(v.thumb)}" loading="lazy" referrerpolicy="no-referrer" alt="">` : `<div class="ph">${esc(v.studio || v.title.slice(0, 12))}</div>`}
      ${v.code ? `<span class="badge code">${esc(v.code)}</span>` : ''}
      ${isNew(v) ? '<span class="badge new">NEW</span>' : ''}
      ${isFav(v.key) ? '<span class="badge fav" aria-label="お気に入り">♥</span>' : ''}
    </div>
    <div class="title">${esc(v.title)}</div>
    <div class="sub">${esc(fmtDate(v.date))}${v.studio ? ' · ' + esc(v.studio) : ''}</div>
  </button>`;
}

const EMPTY = {
  fav: 'お気に入りはまだありません。動画の詳細で ♡ を押すと追加されます',
  history: '再生した動画がここに並びます',
  new: 'ここ数日で新しく見つかった動画はありません',
};

export function render(reset = true) {
  if (reset) {
    applyFilters();
    shown = 0;
    $('#grid').innerHTML = '';
    window.scrollTo(0, 0);
  }
  const next = filtered.slice(shown, shown + PAGE);
  $('#grid').insertAdjacentHTML('beforeend', next.map((v, k) => cardHTML(v, shown + k)).join(''));
  shown += next.length;
  $('#meta').textContent = `${filtered.length.toLocaleString()} 件`;
  $('#list-state').textContent = filtered.length
    ? ''
    : (!filters.q && !filters.studio && EMPTY[filters.view]) ? EMPTY[filters.view]
    : state.posts.size ? '該当する動画がありません'
    : crawl.running ? '収集中です。少し待つと表示されます…'
    : 'まだデータがありません。設定から収集してください';
}

export function renderChips() {
  const top = state.studios.slice(0, CHIP_STUDIOS);
  // 選択中のスタジオが上位に入っていなくてもチップに出す
  if (filters.studio && !top.some((s) => s.key === filters.studio)) {
    const cur = state.studios.find((s) => s.key === filters.studio);
    if (cur) top.unshift(cur);
  }
  const newCount = state.videos.reduce((n, v) => n + (isNew(v) ? 1 : 0), 0);
  const chip = (on, attrs, label) => `<button class="chip ${on ? 'on' : ''}" ${attrs}>${label}</button>`;
  $('#chips').innerHTML =
    chip(!filters.studio && !filters.view, 'data-chip="all"', 'すべて') +
    (newCount ? chip(filters.view === 'new', 'data-chip="view" data-view="new"', `新着 <span class="count">${newCount.toLocaleString()}</span>`) : '') +
    chip(filters.view === 'fav', 'data-chip="view" data-view="fav"', '♥ お気に入り') +
    chip(filters.view === 'history', 'data-chip="view" data-view="history"', '履歴') +
    top.map((s) => chip(filters.studio === s.key, `data-chip="studio" data-key="${esc(s.key)}"`, esc(s.name))).join('') +
    (state.studios.length > CHIP_STUDIOS ? '<button class="chip more" data-chip="more">スタジオ一覧…</button>' : '');
}

export function setQuery(q) {
  $('#q').value = q;
  filters.q = q;
  saveFilters();
  $('#q-clear').style.display = q ? 'block' : 'none';
  render();
}

export function setStudio(key) {
  filters.studio = key;
  saveFilters();
  renderChips();
  render();
}

export function initList() {
  new IntersectionObserver((e) => { if (e[0].isIntersecting && shown < filtered.length) render(false); }, { rootMargin: '800px' })
    .observe($('#sentinel'));

  let qTimer;
  $('#q').value = filters.q;
  $('#q-clear').style.display = filters.q ? 'block' : 'none';
  $('#q').addEventListener('input', () => {
    $('#q-clear').style.display = $('#q').value ? 'block' : 'none';
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { filters.q = $('#q').value.trim(); saveFilters(); render(); }, 250);
  });
  $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#q').blur(); });
  $('#q-clear').onclick = () => { $('#q').value = ''; $('#q').dispatchEvent(new Event('input')); };

  // 表示の切り替え（新着・お気に入り・履歴）とスタジオは組み合わせられる
  $('#chips').onclick = (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const kind = b.dataset.chip;
    if (kind === 'more') return openFilters();
    if (kind === 'all') { filters.studio = ''; filters.view = ''; }
    if (kind === 'view') filters.view = filters.view === b.dataset.view ? '' : b.dataset.view;
    if (kind === 'studio') filters.studio = filters.studio === b.dataset.key ? '' : b.dataset.key;
    saveFilters();
    renderChips();
    render();
    $(`#chips [data-chip="${kind}"]${b.dataset.key ? `[data-key="${CSS.escape(b.dataset.key)}"]` : ''}${b.dataset.view ? `[data-view="${b.dataset.view}"]` : ''}`)
      ?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  };

  $('#grid').onclick = (e) => {
    const c = e.target.closest('.card');
    if (c) openDetail(filtered[+c.dataset.i]);
  };

  // 先頭へ戻るボタン
  const top = $('#to-top');
  addEventListener('scroll', () => top.classList.toggle('on', window.scrollY > 1500), { passive: true });
  top.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  // 収集でデータが増えたとき：一覧の先頭を見ていれば描き直す
  on('data', () => {
    renderChips();
    if (location.hash !== '#settings' && !isSheetOpen() && window.scrollY < 300) render();
  });
  // お気に入り・履歴が変わったら、絞り込み中なら描き直し、そうでなければ該当カードだけ更新する
  const refresh = (view) => () => {
    if (location.hash === '#settings') return;
    if (filters.view === view) return render();
    for (const card of $('#grid').querySelectorAll('.card')) {
      const v = filtered[+card.dataset.i];
      const has = !!card.querySelector('.badge.fav');
      if (v && has !== isFav(v.key)) card.outerHTML = cardHTML(v, +card.dataset.i);
    }
  };
  on('favs', refresh('fav'));
  on('history', () => { if (filters.view === 'history' && !isSheetOpen()) render(); });
}
