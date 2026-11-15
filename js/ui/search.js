// 検索タブ（#search）: 自分から動画を探すページ。上の検索欄 + 3 つの切り替え
//   スタジオ … 親子の入れ子の一覧（filters.js の mountStudioPicker）。選ぶと、そのスタジオの動画の一覧（#list）へ
//   出演者   … 出演者データベースの一覧（actors.js）。名前・別名・レーベル・身長・体重・年齢で絞れる。選ぶと出演者のページへ
//   動画     … キーワード検索（タイトル・品番・タグ）。結果をその場に出し、「すべて見る」で一覧（#list）へ
// 検索欄に打った文字は、いま見ている切り替えの中だけを絞る。
// 切り替えは localStorage の searchSeg に覚える。出演者の索引は、出演者の切り替えを開いたときに（なければ）取る。

import { $, esc } from '../util.js';
import { state, on } from '../data.js';
import { feature } from '../features.js';
import { isNew } from '../data.js';
import { allActors, syncIndex } from '../actors.js';
import { filters, saveFilters, renderChips, normalizeQuery, searchVideos } from './list.js';
import { mountStudioPicker } from './filters.js';
import { mountActorList } from './actors.js';
import { openDetail } from './detail.js';
import { track } from '../analytics.js';

const SEGS = ['studios', 'actors', 'videos'];
const SEG_KEY = 'searchSeg';
const VIDEO_PREVIEW = 48;

let seg = 'actors';
let built = false;
let actorList = null;
let studioPaint = null;
let videoResults = [];
let timer = 0;

const loadSeg = () => { try { const v = localStorage.getItem(SEG_KEY); return SEGS.includes(v) ? v : 'actors'; } catch { return 'actors'; } };
export const isSearchOpen = () => location.hash === '#search';

/** 結果の一覧（#list）へ移る */
function goList() {
  history.replaceState(history.state, '', `${location.pathname}${location.search}`);
  dispatchEvent(new HashChangeEvent('hashchange'));
  dispatchEvent(new Event('viewchange'));
}

/** スタジオを選んだ: そのスタジオの動画の一覧へ */
export function pickStudio(key) {
  Object.assign(filters, { studio: key, view: '', q: '', actor: '' });
  const q = $('#q'); if (q) q.value = '';
  saveFilters();
  renderChips();
  goList();
}

const query = () => $('#search-q').value.trim();

function showSeg() {
  for (const b of document.querySelectorAll('#search-seg button')) {
    const on = b.dataset.seg === seg;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  }
  for (const s of SEGS) $(`#search-pane-${s}`).classList.toggle('hidden', s !== seg);
  $('#search-q').placeholder = seg === 'studios' ? 'スタジオ名で探す' : seg === 'actors' ? '出演者の名前・特徴・身長・年齢で探す' : 'タイトル・品番・タグで検索';
  $('#search-sort').classList.toggle('hidden', seg !== 'actors');
}

function paintStudios() {
  if (!studioPaint) {
    const pane = $('#search-pane-studios');
    studioPaint = mountStudioPicker(pane, pickStudio, { search: () => query() });
  }
  studioPaint();
}

function paintActors() {
  if (!actorList) actorList = mountActorList($('#search-pane-actors'), { sort: $('#search-sort-sel').value, query: query(), minCount: 1 });
  else actorList.update({ query: query(), sort: $('#search-sort-sel').value });
  // 索引がなければ取る（初回だけ。取れたら一覧を作り直す）
  if (!allActors().length) {
    const note = $('#search-note');
    note.textContent = '出演者の一覧を取得しています…（初回だけ）';
    note.classList.remove('hidden');
    syncIndex({ onProgress: (n) => { note.textContent = `出演者の一覧を取得しています… ${n.toLocaleString()} 人`; } })
      .then(() => { note.classList.add('hidden'); if (seg === 'actors' && isSearchOpen()) actorList.update({ query: query() }); })
      .catch(() => { note.textContent = '通信できませんでした。あとでもう一度開いてください'; });
  } else {
    syncIndex().catch(() => {}); // 古ければ（7 日）裏で更新
  }
}

const cardHTML = (v, i) => `<button class="card" data-i="${i}">
  <div class="thumb">
    ${v.thumb ? `<img src="${esc(v.thumb)}" loading="lazy" referrerpolicy="no-referrer" alt="">` : `<div class="ph">${esc(v.studio || v.title.slice(0, 12))}</div>`}
    ${v.code ? `<span class="badge code">${esc(v.code)}</span>` : ''}
    ${feature('newBadge') && isNew(v) ? '<span class="badge new">NEW</span>' : ''}
  </div>
  <div class="title">${esc(v.title)}</div>
</button>`;

function paintVideos() {
  const q = query();
  const grid = $('#search-videos-grid');
  const more = $('#search-videos-more');
  const note = $('#search-videos-note');
  if (!q) {
    videoResults = [];
    grid.innerHTML = '';
    more.classList.add('hidden');
    note.textContent = 'タイトル・品番・タグで探せます。出演者の名前・スタジオ名でも当たります';
    note.classList.remove('hidden');
    return;
  }
  videoResults = searchVideos(q);
  grid.innerHTML = videoResults.slice(0, VIDEO_PREVIEW).map(cardHTML).join('');
  note.textContent = videoResults.length ? `${videoResults.length.toLocaleString()} 件` : '該当する動画がありません';
  note.classList.remove('hidden');
  more.classList.toggle('hidden', videoResults.length <= VIDEO_PREVIEW);
  more.textContent = `${videoResults.length.toLocaleString()} 件すべて見る ›`;
}

let searchTimer = 0;
function noteSearch() {
  clearTimeout(searchTimer);
  const q = query();
  if (!q) return;
  searchTimer = setTimeout(() => track('search', { len: q.length, n: seg === 'videos' ? videoResults.length : -1, at: `search:${seg}` }), 1200);
}

function paint() {
  showSeg();
  noteSearch();
  if (seg === 'studios') paintStudios();
  else if (seg === 'actors') paintActors();
  else paintVideos();
}

function init() {
  built = true;
  seg = loadSeg();
  $('#search-seg').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.dataset.seg === seg) return;
    seg = b.dataset.seg;
    try { localStorage.setItem(SEG_KEY, seg); } catch { /* 保存できなくても動く */ }
    window.scrollTo(0, 0);
    paint();
  };
  $('#search-q').addEventListener('input', () => {
    $('#search-clear').style.display = $('#search-q').value ? 'block' : 'none';
    clearTimeout(timer);
    timer = setTimeout(paint, 150);
  });
  $('#search-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#search-q').blur(); } });
  $('#search-clear').onclick = () => { $('#search-q').value = ''; $('#search-clear').style.display = 'none'; paint(); $('#search-q').focus(); };
  $('#search-sort-sel').onchange = () => { if (seg === 'actors') paintActors(); };
  $('#search-videos-grid').addEventListener('click', (e) => {
    const c = e.target.closest('.card');
    if (c) openDetail(videoResults[+c.dataset.i], { list: videoResults, index: +c.dataset.i });
  });
  $('#search-videos-more').onclick = () => {
    Object.assign(filters, { q: query(), studio: '', actor: '', view: '' });
    const q = $('#q'); if (q) q.value = filters.q;
    const clear = $('#q-clear'); if (clear) clear.style.display = filters.q ? 'block' : 'none';
    saveFilters();
    renderChips();
    goList();
  };
  // 収集が進んで一覧が変わったら、動画の結果を更新する（入力中でなければ）
  on('data', () => { if (isSearchOpen() && seg === 'videos') paintVideos(); });
}

/** ページを開いたとき（route から）。arg: { seg?, q? } で切り替えと検索語を指定できる（アプリの「検索」から） */
export function openSearch(arg = {}) {
  if (!built) init();
  if (arg.seg && SEGS.includes(arg.seg)) seg = arg.seg;
  if (typeof arg.q === 'string') { $('#search-q').value = arg.q; $('#search-clear').style.display = arg.q ? 'block' : 'none'; }
  paint();
}

export const searchSegment = () => seg;
export { normalizeQuery };
