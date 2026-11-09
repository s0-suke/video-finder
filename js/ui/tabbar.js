// 画面下のタブバー（ホーム / 新着 / お気に入り / 履歴 / 設定）
//
// - 一覧系のタブは filters.view を切り替える（設定だけ #settings に移る）
// - いま開いているタブをもう一度押すと、一覧の先頭へ戻る（iOS の標準アプリと同じ）
// - キーボードが出ているときは、ドックをキーボードの上に持ち上げる

import { $, $$ } from '../util.js';
import { state, on, isNew } from '../data.js';
import { filters, setView, saveFilters } from './list.js';
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

function switchHash(hash) {
  history.replaceState(history.state, '', location.pathname + location.search + hash);
  dispatchEvent(new HashChangeEvent('hashchange'));
}

export function initTabbar() {
  $('#tabbar').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const tab = b.dataset.tab;
    if (tab === current()) return window.scrollTo({ top: 0, behavior: 'smooth' });
    // タブの切り替えは履歴に積まない（戻る操作で設定と一覧を往復しないように）。描画は hashchange の route に任せる
    if (tab === 'settings') return switchHash('#settings');
    if (location.hash === '#settings') {
      filters.view = tab;
      saveFilters();
      switchHash('');
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
      // 候補は検索欄の上に開くので、見えている範囲（キーボードを除く）からはみ出さない高さにする
      $('#suggest').style.maxHeight = Math.max(120, vv.height - $('#dock').offsetHeight - 24) + 'px';
    };
    vv.addEventListener('resize', lift);
    vv.addEventListener('scroll', lift);
  }
  renderTabs();
}
