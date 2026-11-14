// 画面下のタブバー（ホーム / お気に入り / 検索 / 設定）と、ページの行き来
//
// ページは URL のハッシュで決まる: #home（ホーム）/ #search（検索）/ #actor/<id>（出演者）/ #favactors（お気に入りの出演者）/ #settings（設定）/ 空（一覧）
// 一覧（空のハッシュ）は、検索・スタジオ・出演者の結果と、お気に入り（動画）・履歴を出すページ。
// - ホーム: #home。もう一度押すと先頭へ（先頭ならおすすめへ）
// - お気に入り: 動画 / 出演者 / 履歴 の切り替え（一覧の上の #lib-seg）。最後に見ていたものを開く
// - 検索: #search。結果の一覧・出演者のページも、検索のタブの中として数える。もう一度押すと検索のページへ戻る
// - 設定: #settings
// タブの切り替えは履歴に積まない（戻る操作でページを往復しないように）。描画は hashchange の route に任せる。

import { $, $$ } from '../util.js';
import { state, on, isNew } from '../data.js';
import { filters, setView, saveFilters, renderChips } from './list.js';
import { feature } from '../features.js';
import { actorFrom } from './actors.js';
import { homeToTop } from './home.js';

const LIB_KEY = 'lastLib';
// お気に入りのタブを押したときに開くもの: 'fav'（動画）/ 'actors'（出演者）/ 'history'（履歴）
let lastLib = (() => { try { const v = localStorage.getItem(LIB_KEY); return ['fav', 'actors', 'history'].includes(v) ? v : 'fav'; } catch { return 'fav'; } })();
const rememberLib = (v) => { lastLib = v; try { localStorage.setItem(LIB_KEY, v); } catch { /* 保存できなくても動く */ } };

/** いまのページ: 'home' | 'search' | 'actor' | 'favactors' | 'settings' | 'list' */
export function pageOf(hash = location.hash) {
  if (hash === '#settings') return 'settings';
  if (hash === '#home') return 'home';
  if (hash === '#search') return 'search';
  if (hash === '#favactors') return 'favactors';
  if (/^#actor\/\d+$/.test(hash)) return 'actor';
  return 'list';
}

/** いま選ばれているタブ */
const current = () => {
  const p = pageOf();
  if (p === 'settings') return 'settings';
  if (p === 'home') return 'home';
  if (p === 'search') return 'search';
  if (p === 'favactors') return 'fav';
  if (p === 'actor') return actorFrom === '#favactors' ? 'fav' : actorFrom === '#home' ? 'home' : 'search';
  // 一覧: お気に入り（動画）・履歴ならお気に入り、それ以外（検索・スタジオ・出演者の結果）は検索
  return filters.view === 'fav' || filters.view === 'history' ? 'fav' : 'search';
};

export function switchHash(hash) {
  history.replaceState(history.state, '', location.pathname + location.search + hash);
  dispatchEvent(new HashChangeEvent('hashchange'));
}

/** 一覧（お気に入り・履歴）を開く。前の検索・スタジオの絞り込みが残っていると、お気に入りが絞られてしまうので外す */
function openLib(view) {
  Object.assign(filters, { view, q: '', studio: '', actor: '', site: '' });
  const q = $('#q'); if (q) q.value = '';
  const clear = $('#q-clear'); if (clear) clear.style.display = 'none';
  saveFilters();
  renderChips();
  if (location.hash) switchHash(''); else setView(view);
  dispatchEvent(new Event('viewchange'));
}

export function openLibrary(which = lastLib) {
  rememberLib(which);
  if (which === 'actors') return switchHash('#favactors');
  return openLib(which === 'history' && feature('history') ? 'history' : 'fav');
}

export function renderTabs() {
  const p = pageOf();
  // 履歴をオフにしたら、履歴を開いていたらお気に入りに戻す
  const histOn = feature('history');
  if (!histOn && filters.view === 'history') setView('fav');
  if (filters.view === 'fav' && p === 'list') rememberLib('fav');
  if (filters.view === 'history' && p === 'list') rememberLib('history');
  // お気に入りの切り替え（動画 / 出演者 / 履歴）: お気に入りの一覧と、お気に入りの出演者のページに出す
  const showSeg = p === 'favactors' || (p === 'list' && (filters.view === 'fav' || filters.view === 'history'));
  const activeLib = p === 'favactors' ? 'actors' : filters.view === 'history' ? 'history' : 'fav';
  for (const seg of [$('#lib-seg'), $('#lib-seg2')]) {
    seg.classList.toggle('hidden', !showSeg);
    for (const b of seg.querySelectorAll('button')) {
      b.hidden = b.dataset.lib === 'history' && !histOn;
      b.classList.toggle('on', b.dataset.lib === activeLib);
      b.setAttribute('aria-selected', String(b.dataset.lib === activeLib));
    }
  }
  // 一覧の「戻る」: お気に入り以外（検索・スタジオ・出演者の結果）のとき
  $('#list-nav').classList.toggle('hidden', !(p === 'list' && filters.view !== 'fav' && filters.view !== 'history'));
  const cur = current();
  for (const b of $$('#tabbar button')) {
    b.classList.toggle('on', b.dataset.tab === cur);
    if (b.dataset.tab === cur) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  // 新着の数（ホームのタブのバッジ）
  const n = feature('newBadge') ? state.videos.reduce((c, v) => c + (isNew(v) ? 1 : 0), 0) : 0;
  const badge = $('#new-badge');
  badge.textContent = n > 99 ? '99+' : String(n);
  badge.classList.toggle('on', n > 0);
}

// 結果の一覧・出演者のページから戻る先（直前に見ていた、ホーム・検索・お気に入りの出演者）
let backTo = '#search';
export function rememberBack(hash) { if (hash && pageOf(hash) !== 'list' && pageOf(hash) !== 'actor' && pageOf(hash) !== 'settings') backTo = hash; }
export const goBack = () => switchHash(backTo);

export function initTabbar() {
  $('#tabbar').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const tab = b.dataset.tab;
    if (tab === current()) {
      // いま開いているタブをもう一度押した: 先頭へ。奥のページ（結果・出演者）にいるなら、そのタブの最初のページへ
      if (tab === 'home') return homeToTop();
      if (tab === 'search' && pageOf() !== 'search') return switchHash('#search');
      if (tab === 'fav' && pageOf() === 'actor') return switchHash('#favactors');
      return window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    if (tab === 'home') return switchHash('#home');
    if (tab === 'search') return switchHash('#search');
    if (tab === 'settings') return switchHash('#settings');
    if (tab === 'fav') return openLibrary(lastLib);
  };
  // お気に入りの切り替え（2 か所）
  for (const seg of [$('#lib-seg'), $('#lib-seg2')]) {
    seg.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const which = b.dataset.lib;
      const cur = pageOf() === 'favactors' ? 'actors' : filters.view === 'history' ? 'history' : 'fav';
      if (which !== cur) openLibrary(which);
    };
  }
  $('#list-back').onclick = goBack;
  addEventListener('hashchange', renderTabs);
  addEventListener('viewchange', renderTabs); // 一覧側で切り替えたとき（list.js の setView / setActor など）
  on('data', renderTabs);
  on('features', renderTabs);

  renderTabs();
}
