// 画面下のタブバー（ホーム / 出演者 / 履歴 / お気に入り / 設定）と、ページの行き来
//
// ページは URL のハッシュで決まる: #home / #actors / #history / #favs / #settings / #actor/<id>（出演者の詳細。開いた元のタブの中として数える）
// - 選んでいるタブをもう一度押すと先頭へ（出演者の詳細にいるなら、そのタブの最初のページへ。ホームは先頭にいれば新着へ）
// タブの切り替えは履歴に積まない（戻る操作でページを往復しないように）。描画は hashchange の route に任せる。

import { $, $$, debounce } from '../util.js';
import { state, on, isNew } from '../data.js';
import { actorFrom } from './actors.js';
import { homeToTop } from './home.js';

const TABS = ['home', 'actors', 'history', 'favs', 'settings'];

/** いまのページ: 'home' | 'actors' | 'history' | 'favs' | 'settings' | 'actor' */
export function pageOf(hash = location.hash) {
  const h = hash.replace(/^#/, '');
  if (TABS.includes(h)) return h;
  if (/^actor\/\d+$/.test(h)) return 'actor';
  return 'home';
}

/** いま選ばれているタブ（出演者の詳細は、開いた元のタブ） */
const current = () => {
  const p = pageOf();
  return p === 'actor' ? pageOf(actorFrom) === 'actor' ? 'actors' : pageOf(actorFrom) : p;
};

export function switchHash(hash) {
  history.replaceState(history.state, '', location.pathname + location.search + hash);
  dispatchEvent(new HashChangeEvent('hashchange'));
}

export function renderTabs() {
  const cur = current();
  for (const b of $$('#tabbar button')) {
    b.classList.toggle('on', b.dataset.tab === cur);
    if (b.dataset.tab === cur) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  // 新着の数（ホームのタブのバッジ）
  let n = 0;
  for (const v of state.videos) if (isNew(v)) n++;
  const badge = $('#new-badge');
  badge.textContent = n > 99 ? '99+' : String(n);
  badge.classList.toggle('on', n > 0);
}

export function initTabbar() {
  $('#tabbar').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const tab = b.dataset.tab;
    if (tab === current()) {
      if (pageOf() === 'actor') return switchHash(`#${tab}`);
      if (tab === 'home') return homeToTop();
      return window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    switchHash(`#${tab}`);
  };
  addEventListener('hashchange', renderTabs);
  on('data', debounce(renderTabs, 500)); // 収集のたびに、数千本を数え直さない
  renderTabs();
}
