// 画面下のタブバー（ホーム / 新着 / お気に入り / 履歴 / 設定）
//
// - 一覧系のタブは filters.view を切り替える（設定だけ #settings に移る）
// - いま開いているタブをもう一度押すと、一覧の先頭へ戻る（iOS の標準アプリと同じ）
// - キーボードが出ているときは、ドックをキーボードの上に持ち上げる

import { $, $$ } from '../util.js';
import { state, on, isNew } from '../data.js';
import { filters, setView } from './list.js';
import { feature } from '../features.js';

const current = () => (location.hash === '#settings' ? 'settings' : filters.view || '');

export function renderTabs() {
  // オフにした機能のタブは隠す。開いていたら ホーム に戻す
  const hiddenTabs = { new: !feature('newBadge'), history: !feature('history') };
  if (hiddenTabs[filters.view]) setView('');
  for (const b of $$('#tabbar button')) b.hidden = !!hiddenTabs[b.dataset.tab];
  const cur = current();
  for (const b of $$('#tabbar button')) b.classList.toggle('on', b.dataset.tab === cur);
  $('#dock').classList.toggle('no-search', cur === 'settings');
  const n = state.videos.reduce((c, v) => c + (isNew(v) ? 1 : 0), 0);
  const badge = $('#new-badge');
  badge.textContent = n > 99 ? '99+' : String(n);
  badge.classList.toggle('on', n > 0);
}

export function initTabbar() {
  $('#tabbar').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const tab = b.dataset.tab;
    if (tab === current()) return window.scrollTo({ top: 0, behavior: 'smooth' });
    if (tab === 'settings') { location.hash = '#settings'; return; }
    if (location.hash === '#settings') {
      // 設定から一覧へ: 表示を切り替えてから hash を外す（hashchange で一覧が描かれる）
      filters.view = tab;
      setView(tab);
      location.hash = '';
    } else {
      setView(tab);
    }
    renderTabs();
  };
  addEventListener('hashchange', renderTabs);
  on('data', renderTabs);
  on('features', renderTabs);

  // iOS ではキーボードが出ても fixed の要素が隠れることがあるので、表示領域の変化に合わせて持ち上げる
  const vv = window.visualViewport;
  if (vv) {
    const lift = () => {
      const hidden = window.innerHeight - vv.height - vv.offsetTop;
      $('#dock').style.transform = hidden > 80 ? `translateY(${-hidden}px)` : '';
    };
    vv.addEventListener('resize', lift);
    vv.addEventListener('scroll', lift);
  }
  renderTabs();
}
