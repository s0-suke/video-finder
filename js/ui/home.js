// ホーム（#home）: 動画の一覧。新着がはじめの表示で、チップ・絞り込み・検索で自分の興味のある動画だけにできる
//
//   チップ: 新着 / すべて / ★お気に入りスタジオ / 上位のスタジオ… / スタジオ一覧…
//   絞り込みシート: 日付の基準・並び順・スタジオ・取得元サイト・サムネなし
//   検索欄: 動画のタイトル・品番・タグ・スタジオ名
// 条件は端末に覚える（検索語は覚えない）。一番上で下に引っ張ると新着を取りに行く。

import { $, esc, toast, debounce } from '../util.js';
import { state, on, isNew } from '../data.js';
import { crawl, collect } from '../crawler.js';
import { descendantKeys } from '../studios.js';
import { favStudioKeys, isFavStudio, toggleFavStudio } from '../studio-favs.js';
import { track, trackView } from '../analytics.js';
import { createFeed, bindSearch, videoMatcher } from './feed.js';
import { openFilters, openStudioPicker } from './filters.js';
import { isSheetOpen } from './sheet.js';

const CHIP_STUDIOS = 12;
const KEY = 'homeFilters';
const DEFAULTS = { view: 'new', studio: '', site: '', sort: 'new', dateBy: 'post', hideNoThumb: false };

const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } })();
// view: 'new' = 新着 / 'all' = すべて / 'fav' = お気に入りのスタジオ
export const filters = { ...DEFAULTS, ...saved, q: '' };
if (!['new', 'all', 'fav'].includes(filters.view)) filters.view = 'new';

let feed = null;
let search = null;
let dirty = true; // 隠れているあいだにデータが変わった（開いたときに作り直す）
let shuffleSeed = String(Math.random());

const save = () => { try { const { q, ...rest } = filters; localStorage.setItem(KEY, JSON.stringify(rest)); } catch { /* 保存できなくても動く */ } };

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ───────────── 並べる動画 ─────────────

function compute() {
  const match = videoMatcher(filters.q);
  const siteId = filters.site ? +filters.site : null;
  const studioSet = filters.studio ? descendantKeys(state.studios, filters.studio) : null;
  let favSet = null;
  if (filters.view === 'fav') {
    favSet = new Set();
    for (const k of favStudioKeys()) for (const x of descendantKeys(state.studios, k)) favSet.add(x);
  }
  let out = state.videos.filter((v) =>
    (filters.view !== 'new' || isNew(v)) &&
    (!favSet || favSet.has(v.studioKey)) &&
    (!studioSet || studioSet.has(v.studioKey)) &&
    (!siteId || v.siteIds.has(siteId)) &&
    (!filters.hideNoThumb || v.thumb) &&
    match(v));
  if (filters.sort === 'random') {
    const r = new Map(out.map((v) => [v.key, hash(v.key + shuffleSeed)]));
    out.sort((a, b) => r.get(a.key) - r.get(b.key));
  } else if (filters.dateBy === 'release') {
    // 発売日の分かるものだけを並べ替え、不明なものは（掲載日の順で）後ろに回す
    const known = out.filter((v) => v.release).sort((a, b) => (a.release < b.release ? 1 : a.release > b.release ? -1 : 0));
    if (filters.sort === 'old') known.reverse();
    out = [...known, ...out.filter((v) => !v.release)];
  } else if (filters.view === 'new' && filters.sort === 'new') {
    out.sort((a, b) => b.seenAt - a.seenAt); // 新着は、見つかった順
  } else if (filters.sort === 'old') out.reverse(); // state.videos は掲載日の新しい順
  return out;
}

// ───────────── 表示 ─────────────

const newCount = () => { let n = 0; for (const v of state.videos) if (isNew(v)) n++; return n; };

function renderChips() {
  const roots = state.studios.filter((s) => !s.parent);
  const top = roots.slice(0, CHIP_STUDIOS);
  // 選んでいるスタジオが上位に入っていなくても（子のスタジオでも）チップに出す
  if (filters.studio && !top.some((s) => s.key === filters.studio)) {
    const cur = state.studios.find((s) => s.key === filters.studio);
    if (cur) top.unshift(cur);
  }
  const chip = (on, attrs, label) => `<button class="chip ${on ? 'on' : ''}" ${attrs}>${label}</button>`;
  const n = newCount();
  $('#home-chips').innerHTML =
    chip(filters.view === 'new', 'data-view="new"', `新着${n ? ` <span class="count">${n > 99 ? '99+' : n}</span>` : ''}`) +
    chip(filters.view === 'all', 'data-view="all"', 'すべて') +
    chip(filters.view === 'fav', 'data-view="fav"', '★ お気に入りスタジオ') +
    top.map((s) => chip(filters.studio === s.key, `data-studio="${esc(s.key)}"`, esc(s.name))).join('') +
    (state.studios.length ? '<button class="chip more" data-more>スタジオ一覧…</button>' : '');
  $('#filter-btn').classList.toggle('active', !!(filters.site || filters.sort !== 'new' || filters.dateBy !== 'post' || filters.hideNoThumb));
  const on = $('#home-chips .chip.on:not([data-view])');
  if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' });
}

// 効いている条件（view 以外）。件数の横に × 付きで出し、押すと外せる
function conditions() {
  const c = [];
  if (filters.dateBy === 'release') c.push({ id: 'dateBy', label: '発売日順' });
  if (filters.sort === 'old') c.push({ id: 'sort', label: '古い順' });
  if (filters.sort === 'random') c.push({ id: 'sort', label: 'ランダム' });
  if (filters.site) c.push({ id: 'site', label: (state.sites.find((s) => String(s.id) === String(filters.site)) || {}).name || 'サイト' });
  if (filters.hideNoThumb) c.push({ id: 'hideNoThumb', label: 'サムネなし除外' });
  if (filters.studio) c.push({ id: 'studio', label: (state.studios.find((x) => x.key === filters.studio) || {}).name || 'スタジオ' });
  return c;
}

function renderMeta(count) {
  const star = filters.studio
    ? `<button class="cond star ${isFavStudio(filters.studio) ? 'on' : ''}" data-favstudio aria-pressed="${isFavStudio(filters.studio)}">${isFavStudio(filters.studio) ? '★ お気に入り中' : '☆ お気に入りにする'}</button>`
    : '';
  $('#home-meta').innerHTML = `<span>${count.toLocaleString()} 件</span>` +
    conditions().map((c) => `<button class="cond" data-clear="${c.id}" aria-label="${esc(c.label)}を外す">${esc(c.label)} <b>×</b></button>`).join('') + star;
}

const emptyText = () => {
  if (!state.posts.size) return crawl.running ? '収集中です。少し待つと表示されます…' : 'まだデータがありません。設定から収集してください';
  if (filters.view === 'fav' && !favStudioKeys().length) return 'お気に入りのスタジオがありません。「スタジオ一覧…」の ☆ で追加できます';
  if (filters.q || filters.studio || filters.site || filters.hideNoThumb) {
    return '該当する動画がありません<div class="btn-row" style="justify-content:center"><button class="btn" data-clear="all">すべての条件を外す</button></div>';
  }
  if (filters.view === 'new') return '新着はありません（3 日以内に見つかった動画がここに並びます）<div class="btn-row" style="justify-content:center"><button class="btn" data-view="all">すべての動画を見る</button></div>';
  return '該当する動画がありません';
};

/** 一覧を作り直す。keepScroll: いまの位置を保つ（収集で増えたとき） */
function render({ keepScroll = false } = {}) {
  dirty = false;
  const y = window.scrollY;
  const list = compute();
  feed.setList(list);
  renderMeta(list.length);
  renderChips();
  if (keepScroll) window.scrollTo(0, y); else window.scrollTo(0, 0);
}

const commit = () => { save(); trackView(`home:${filters.view}`); render(); };

// ───────────── 外から ─────────────

/** ホームを、検索語・スタジオを指定して開く（詳細のタグ・スタジオから）。タブの切り替えは main.js のハッシュで行う */
export function showHome({ q = '', studio = '' } = {}) {
  Object.assign(filters, { view: 'all', studio, site: '', hideNoThumb: false, sort: 'new', dateBy: 'post' });
  save();
  filters.q = q;
  if (search) search.put(q); // 描き直しは、ページを移したあとの route が 1 回だけ行う
  dirty = true;
  history.replaceState(history.state, '', `${location.pathname}${location.search}#home`);
  dispatchEvent(new HashChangeEvent('hashchange'));
}

/** タブバーのホームをもう一度押したとき: 先頭へ。先頭なら新着へ */
export function homeToTop() {
  if (window.scrollY > 60) return window.scrollTo({ top: 0, behavior: 'smooth' });
  if (filters.view !== 'new' || filters.studio || filters.q) {
    Object.assign(filters, { view: 'new', studio: '' });
    if (search) search.set(''); else filters.q = '';
    commit();
  }
}

function clearCondition(id) {
  if (id === 'all') { Object.assign(filters, { studio: '', site: '', hideNoThumb: false }); if (search) search.set(''); else filters.q = ''; }
  else filters[id] = DEFAULTS[id];
  if (id === 'sort') shuffleSeed = String(Math.random());
  commit();
}

// ───────────── 起動 ─────────────

function init() {
  feed = createFeed({ grid: $('#home-grid'), sentinel: $('#home-sentinel'), stateEl: $('#home-state'), empty: emptyText, dateBy: () => filters.dateBy });
  $('#q').value = filters.q;
  search = bindSearch($('#q'), $('#q-clear'), (q) => {
    filters.q = q;
    render();
    if (q) setTimeout(() => { if (filters.q === q) track('search', { len: q.length, n: feed.list().length, at: 'home' }); }, 1200);
  });

  $('#home-chips').onclick = (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    if (b.dataset.more !== undefined) return openStudioPicker({ current: filters.studio, onPick: (key) => { filters.studio = key; commit(); } });
    if (b.dataset.view) { filters.view = b.dataset.view; return commit(); }
    if (b.dataset.studio) { filters.studio = filters.studio === b.dataset.studio ? '' : b.dataset.studio; commit(); }
  };
  $('#filter-btn').onclick = () => openFilters(filters, (v) => { if (v.sort === 'random') shuffleSeed = String(Math.random()); Object.assign(filters, v); commit(); });
  const onClick = (e) => {
    const c = e.target.closest('[data-clear]');
    if (c) return clearCondition(c.dataset.clear);
    const v = e.target.closest('[data-view]');
    if (v) { filters.view = v.dataset.view; return commit(); }
    if (e.target.closest('[data-favstudio]')) {
      const s = state.studios.find((x) => x.key === filters.studio);
      const added = toggleFavStudio(filters.studio, s ? s.name : filters.studio);
      toast(added ? `★ ${s ? s.name : ''} をお気に入りにしました` : `${s ? s.name : ''} をお気に入りから外しました`);
      renderMeta(feed.list().length);
    }
  };
  $('#home-meta').addEventListener('click', onClick);
  $('#home-state').addEventListener('click', onClick);

  // 一番上で下に引っ張ると新着を取りに行く（ホーム画面アプリには標準の引っ張って更新がないため）
  const ptr = $('#ptr');
  let pullStart = null, pulled = 0;
  addEventListener('touchstart', (e) => {
    pullStart = location.hash === '#home' && !e.target.closest('#dock, input') && window.scrollY <= 0 && !isSheetOpen() ? e.touches[0].clientY : null;
  }, { passive: true });
  addEventListener('touchmove', (e) => {
    if (pullStart == null) return;
    pulled = Math.max(0, e.touches[0].clientY - pullStart);
    ptr.style.height = Math.min(pulled * 0.5, 60) + 'px';
    ptr.textContent = pulled > 110 ? '離すと新着を確認' : '引っ張って新着を確認';
  }, { passive: true });
  const endPull = () => { pullStart = null; pulled = 0; ptr.style.height = '0px'; };
  addEventListener('touchcancel', endPull);
  addEventListener('touchend', () => {
    if (pullStart == null) return;
    if (pulled > 110) {
      if (crawl.running) toast('収集中です');
      else { toast('新着を確認しています…'); collect(); }
    }
    endPull();
  });

  // データが増えたら、先頭付近を見ているときだけ作り直す（読み進めている途中で入れ替わらないように）
  const onData = debounce(() => {
    if (location.hash !== '#home') { dirty = true; return; }
    if (window.scrollY < 300 && !isSheetOpen()) render({ keepScroll: true }); else renderChips();
  });
  on('data', () => { if (location.hash !== '#home') dirty = true; else onData(); });
  let favDirty = false;
  on('favstudios', () => { if (filters.view === 'fav') { dirty = true; favDirty = true; } if (location.hash === '#home') renderMeta(feed.list().length); });
  on('sheetclose', () => { if (favDirty && location.hash === '#home') { favDirty = false; render({ keepScroll: true }); } });
}

/** ページを開いたとき（route から）。作ってあって変わっていなければ、そのまま見せる */
export function openHome() {
  if (!feed) init();
  if (dirty || !feed.list().length) render({ keepScroll: true }); else renderChips();
}
