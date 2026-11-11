// 画面下のタブバー（ホーム / 新着 / スタジオ / お気に入り / 設定）
//
// - 一覧系のタブ（ホーム・新着・お気に入り）は filters.view を切り替える。スタジオは #studios、設定は #settings のページへ移る
// - 履歴は「お気に入り」のタブの中の切り替え（お気に入り｜履歴。一覧の上の #lib-seg）。お気に入りのタブは、最後に見ていたほうを開く
// - いま開いているタブをもう一度押すと、一覧の先頭へ戻る（iOS の標準アプリと同じ）

import { $, $$ } from '../util.js';
import { state, on, isNew } from '../data.js';
import { filters, setView, saveFilters, renderChips } from './list.js';
import { feature } from '../features.js';

// いま選ばれているタブ。履歴は「お気に入り」のタブの中なので、お気に入りとして数える
const current = () => {
  if (location.hash === '#settings') return 'settings';
  if (location.hash === '#studios') return 'studios';
  return filters.view === 'history' ? 'fav' : filters.view || '';
};

// お気に入りのタブを押したときに開くほう（最後に見ていたほう）
let lastLib = filters.view === 'history' ? 'history' : 'fav';

export function renderTabs() {
  // オフにした機能のタブは隠す。開いていたら ホーム に戻す
  const hiddenTabs = { new: !feature('newBadge') };
  if (hiddenTabs[filters.view]) setView('');
  for (const b of $$('#tabbar button')) b.hidden = !!hiddenTabs[b.dataset.tab];
  // 履歴をオフにしたら、切り替えから履歴を外し、履歴を開いていたらお気に入りに戻す
  const histOn = feature('history');
  if (!histOn && filters.view === 'history') setView('fav');
  if (filters.view === 'fav' || filters.view === 'history') lastLib = filters.view;
  const seg = $('#lib-seg');
  seg.classList.toggle('hidden', !((filters.view === 'fav' || filters.view === 'history') && !location.hash && histOn));
  for (const b of $$('#lib-seg button')) {
    b.classList.toggle('on', b.dataset.view === filters.view);
    b.setAttribute('aria-selected', String(b.dataset.view === filters.view));
  }
  const cur = current();
  for (const b of $$('#tabbar button')) b.classList.toggle('on', b.dataset.tab === cur);
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
    // タブの切り替えは履歴に積まない（戻る操作でページと一覧を往復しないように）。描画は hashchange の route に任せる
    if (tab === 'settings' || tab === 'studios') return switchHash(`#${tab}`);
    const view = tab === 'fav' ? lastLib : tab;
    if (location.hash) {
      filters.view = view;
      saveFilters();
      renderChips();
      switchHash('');
    } else {
      setView(view);
    }
    renderTabs();
  };
  // お気に入り｜履歴 の切り替え
  $('#lib-seg').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.dataset.view === filters.view) return;
    setView(b.dataset.view);
  };
  addEventListener('hashchange', renderTabs);
  addEventListener('viewchange', renderTabs); // 一覧側でタブを切り替えたとき（list.js の setView / setActor）
  on('data', renderTabs);
  on('features', renderTabs);

  renderTabs();
}
