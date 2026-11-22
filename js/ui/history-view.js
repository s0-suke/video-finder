// 履歴タブ（#history）: 再生した動画を、見た日の新しい順に並べる。日付ごとに区切り、検索欄でこの中だけを絞れる

import { $ } from '../util.js';
import { state, on } from '../data.js';
import { viewedAt, recentKeys } from '../history.js';
import { createFeed, bindSearch, videoMatcher } from './feed.js';
import { isSheetOpen } from './sheet.js';

let feed = null;
let query = '';
let dirty = true;

const DAY = 24 * 60 * 60 * 1000;
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

/** 見た日の見出し（今日 / 昨日 / 11月3日（月） / 2025年11月3日） */
function dayLabel(at) {
  const d = new Date(at), now = new Date();
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / DAY);
  if (days <= 0) return '今日';
  if (days === 1) return '昨日';
  const md = `${d.getMonth() + 1}月${d.getDate()}日（${WEEK[d.getDay()]}）`;
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}年${md}`;
}

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
  // 履歴タブを見ながら再生したら、詳細を閉じたときに並びを更新する
  on('sheetclose', () => { if (location.hash === '#history' && dirty && !isSheetOpen()) render(); });
  on('data', () => { dirty = true; });
}

export function openHistory() {
  if (!feed) init();
  if (dirty) render();
}
