// スタジオのページ（タブバーの「スタジオ」。#studios）
//
// レーベル・メーカーを親子の入れ子で一覧にし、選ぶとそのスタジオだけに絞ったホームの一覧へ移る。
// 一覧の作り（開閉・探す・お気に入りの印）は、絞り込みのシートと同じもの（filters.js の mountStudioPicker）。

import { $ } from '../util.js';
import { on } from '../data.js';
import { filters, saveFilters, renderChips } from './list.js';
import { mountStudioPicker } from './filters.js';

export const isStudiosOpen = () => location.hash === '#studios';

let paint = null;

/** ホームの一覧へ移る（タブの切り替えは履歴に積まない） */
function goHome() {
  history.replaceState(history.state, '', location.pathname + location.search);
  dispatchEvent(new HashChangeEvent('hashchange'));
}

/** ページを開いたとき（main.js の route から）。初回に作り、2 回目からは一覧だけ描き直す */
export function openStudios() {
  if (!paint) {
    paint = mountStudioPicker($('#view-studios'), (key) => {
      filters.studio = key;
      filters.view = '';
      saveFilters();
      renderChips();
      goHome();
      dispatchEvent(new Event('viewchange')); // タブバーの表示を合わせる
    });
    // 収集が進んで一覧が変わったら、開いている間は描き直す
    on('data', () => { if (isStudiosOpen()) paint(); });
  } else {
    paint();
  }
}
