// 一覧（検索・スタジオのチップ・無限スクロール）

import { $, esc, fmtDate } from '../util.js';
import { state, on } from '../data.js';
import { crawl } from '../crawler.js';
import { isFav } from '../favorites.js';
import { isSheetOpen } from './sheet.js';
import { openDetail } from './detail.js';
import { openFilters } from './filters.js';

const PAGE = 40;
const CHIP_STUDIOS = 15;

const saved = (() => { try { return JSON.parse(localStorage.getItem('filters2') || '{}'); } catch { return {}; } })();
export const filters = { q: '', studio: '', site: '', sort: 'new', fav: '', ...saved };
let filtered = [];
let shown = 0;

export function saveFilters() {
  try { localStorage.setItem('filters2', JSON.stringify(filters)); } catch {}
  $('#filter-btn').classList.toggle('active', !!(filters.site || filters.sort !== 'new'));
}

function applyFilters() {
  const words = filters.q.toLowerCase().split(/\s+/).filter(Boolean);
  const siteId = filters.site ? +filters.site : null;
  filtered = state.videos.filter((v) =>
    (!filters.fav || isFav(v.key)) &&
    (!filters.studio || v.studioKey === filters.studio) &&
    (!siteId || v.siteIds.has(siteId)) &&
    words.every((w) => v.hay.includes(w)));
  if (filters.sort === 'old') filtered.reverse();
}

function cardHTML(v, i) {
  return `<button class="card" data-i="${i}">
    <div class="thumb">
      ${v.thumb ? `<img src="${esc(v.thumb)}" loading="lazy" referrerpolicy="no-referrer" alt="">` : ''}
      ${v.code ? `<span class="badge code">${esc(v.code)}</span>` : ''}
      ${isFav(v.key) ? '<span class="badge fav" aria-label="お気に入り">♥</span>' : ''}
    </div>
    <div class="title">${esc(v.title)}</div>
    <div class="sub">${esc(fmtDate(v.date))}${v.studio ? ' · ' + esc(v.studio) : ''}</div>
  </button>`;
}

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
    : filters.fav ? 'お気に入りはまだありません。動画の詳細で ♡ を押すと追加されます'
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
  $('#chips').innerHTML =
    `<button class="chip ${!filters.studio && !filters.fav ? 'on' : ''}" data-chip="all">すべて</button>` +
    `<button class="chip ${filters.fav ? 'on' : ''}" data-chip="fav">♥ お気に入り</button>` +
    top.map((s) => `<button class="chip ${filters.studio === s.key ? 'on' : ''}" data-chip="studio" data-key="${esc(s.key)}">${esc(s.name)}</button>`).join('') +
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
  filters.fav = '';
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

  $('#chips').onclick = (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const kind = b.dataset.chip;
    if (kind === 'more') return openFilters();
    if (kind === 'all') { filters.studio = ''; filters.fav = ''; }
    if (kind === 'fav') { filters.fav = filters.fav ? '' : '1'; filters.studio = ''; }
    if (kind === 'studio') { filters.studio = filters.studio === b.dataset.key ? '' : b.dataset.key; filters.fav = ''; }
    saveFilters();
    renderChips();
    render();
    b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  };

  $('#grid').onclick = (e) => {
    const c = e.target.closest('.card');
    if (c) openDetail(filtered[+c.dataset.i]);
  };

  // 収集でデータが増えたとき：一覧の先頭を見ていれば描き直す
  on('data', () => {
    renderChips();
    if (location.hash !== '#settings' && !isSheetOpen() && window.scrollY < 300) render();
  });
  // お気に入りが変わったら、カードのハートとお気に入り表示を更新する
  on('favs', () => {
    if (location.hash === '#settings') return;
    if (filters.fav) render();
    else for (const card of $('#grid').querySelectorAll('.card')) {
      const v = filtered[+card.dataset.i];
      const has = !!card.querySelector('.badge.fav');
      if (v && has !== isFav(v.key)) card.outerHTML = cardHTML(v, +card.dataset.i);
    }
  });
}
