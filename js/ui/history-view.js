// 履歴タブ（#history）: 再生した動画を、見た日の新しい順に並べる。日付ごとに区切り、検索欄でこの中だけを絞れる

import { $ } from '../util.js';
import { state, on } from '../data.js';
import { viewedAt, recentKeys } from '../history.js';
import { createFeed, bindSearch, videoMatcher } from './feed.js';
import { dayLabel } from '../list-core.js';

let feed = null;
let query = '';
let dirty = true;

function render() {
  dirty = false;
  const match = videoMatcher(query);
  const list = recentKeys().map((k) => state.byKey.get(k)).filter((v) => v && match(v));
  feed.setList(list);
  $('#history-meta').textContent = `${list.length.toLocaleString()} 本${query ? '（検索中）' : ''}`;
}

function init() {
  feed = createFeed({
    grid: $('#history-grid'),
    sentinel: $('#history-sentinel'),
    stateEl: $('#history-state'),
    group: (v) => dayLabel(viewedAt(v.key)),
    empty: () => (query ? '該当する動画がありません' : '再生した動画がここに並びます'),
  });
  bindSearch($('#hq'), $('#hq-clear'), (q) => { query = q; render(); });
  on('history', () => { dirty = true; });
  on('data', () => { dirty = true; });
}

export function openHistory() {
  if (!feed) init();
  if (dirty) render();
}
