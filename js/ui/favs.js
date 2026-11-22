// お気に入りタブ（#favs）: 動画 / 出演者 の切り替え。検索欄は、いま見ている切り替えの中だけを絞る（スタジオは持たない）

import { $ } from '../util.js';
import { state, on } from '../data.js';
import { favKeys } from '../favorites.js';
import { favActorIds, getActor, searchActors, isFavActor } from '../actors.js';
import { createFeed, bindSearch, videoMatcher } from './feed.js';
import { mountActorGrid } from './actors.js';
import { track } from '../analytics.js';

const SEG_KEY = 'favSeg';
let seg = 'videos';
let feed = null;
let grid = null;
let query = '';
let dirty = true;

const loadSeg = () => { try { return localStorage.getItem(SEG_KEY) === 'actors' ? 'actors' : 'videos'; } catch { return 'videos'; } };
export const favSegment = () => seg;

function render() {
  dirty = false;
  for (const b of document.querySelectorAll('#favs-seg button')) {
    const f = b.dataset.seg === seg;
    b.classList.toggle('on', f);
    b.setAttribute('aria-selected', String(f));
  }
  $('#favs-videos').classList.toggle('hidden', seg !== 'videos');
  $('#favs-actors').classList.toggle('hidden', seg !== 'actors');
  $('#fq').placeholder = seg === 'videos' ? 'お気に入りの動画を検索' : 'お気に入りの出演者を検索';
  if (seg === 'videos') {
    const match = videoMatcher(query);
    const list = favKeys().map((k) => state.byKey.get(k)).filter((v) => v && match(v));
    feed.setList(list);
    $('#favs-meta').textContent = `${list.length.toLocaleString()} 本${query ? '（検索中）' : ''}`;
  } else {
    const ids = new Set(favActorIds());
    const rows = (query ? searchActors(query, { minCount: 0 }) : [...ids].map(getActor).filter(Boolean)).filter((a) => isFavActor(a.id));
    if (!query) rows.sort((a, b) => a.display.localeCompare(b.display, 'ja'));
    grid.setRows(rows, query ? '該当する出演者がいません' : 'お気に入りの出演者はまだいません。出演者の ♡ を押すと追加されます');
    $('#favs-meta').textContent = `${rows.length.toLocaleString()} 人${query ? '（検索中）' : ''}`;
  }
}

function init() {
  seg = loadSeg();
  feed = createFeed({
    grid: $('#favs-grid'), sentinel: $('#favs-sentinel'), stateEl: $('#favs-state'),
    empty: () => (query ? '該当する動画がありません' : 'お気に入りの動画はまだありません。カードのハートか、動画の詳細の ♡ で追加できます'),
  });
  grid = mountActorGrid($('#favs-actors-list'));
  bindSearch($('#fq'), $('#fq-clear'), (q) => {
    query = q;
    render();
    if (q) setTimeout(() => { if (query === q) track('search', { len: q.length, n: seg === 'videos' ? feed.list().length : grid.count(), at: `favs:${seg}` }); }, 1200);
  });
  $('#favs-seg').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.dataset.seg === seg) return;
    seg = b.dataset.seg;
    try { localStorage.setItem(SEG_KEY, seg); } catch { /* 保存できなくても動く */ }
    window.scrollTo(0, 0);
    render();
  };
  on('favs', () => { dirty = true; });
  on('favactors', () => { dirty = true; });
  on('data', () => { dirty = true; });
}

/** タブを開いたとき（route から）。お気に入りが変わっていれば作り直す */
export function openFavs() {
  if (!feed) init();
  if (dirty) render();
}
