// ホーム（#home）: 受動的に見つけるためのページ。上の切り替えを、左右のスワイプでも行き来できる
//   新着     … 前回開いてから増えた動画を先頭に（区切り線つき）。カードのハートで、開かずにお気に入りにできる。最初に開くパネル
//   続き     … 最近見た動画・お気に入りの動画・最近見たスタジオの他の動画（過去の動画を見返す・漁る入口）
//   おすすめ … 横に並べた行（続きを見る / お気に入りのスタジオの新作 / お気に入りの出演者の新作 / 新着 / 今日の発見 / 人気のスタジオ）
//   新着     … 新しく見つかった動画（新しい順）。無限スクロール
//   スタジオ … スタジオごとの最新動画のカルーセル（ui/studios.js）
//   出演者   … お気に入りの出演者と、人気の出演者（代表画像つき）
// 検索（自分から探す）は検索タブ（ui/search.js）。ここには検索欄を置かない。

import { $, esc, toast } from '../util.js';
import { state, on, isNew } from '../data.js';
import { isFav, toggleFav, favKeys } from '../favorites.js';
import { track, trackView } from '../analytics.js';
import { descendantKeys } from '../studios.js';
import { recentKeys } from '../history.js';
import { feature } from '../features.js';
import { allActors, getActor, enrich, videosOf, favActorIds, syncIndex } from '../actors.js';
import { filters, saveFilters, renderChips } from './list.js';
import { openDetail } from './detail.js';
import { gotoActor } from './actors.js';
import { openStudios } from './studios.js';
import { miniPlayer } from './sheet.js';

const PANELS = ['new', 'cont', 'rec', 'studios', 'actors'];
const ROW = 12;
const NEW_PAGE = 30;

let panel = 'new';
let built = false;
const scrollAt = {}; // パネルごとのスクロール位置
let newShown = 0;
let newList = [];

export const isHomeOpen = () => location.hash === '#home';
export const homePanel = () => panel;

// ───────────── 部品 ─────────────

/** カードのハートの見た目を、お気に入りの状態に合わせる（el を渡さなければ探す） */
function paintQfav(key, el) {
  const on = isFav(key);
  for (const q of el ? [el] : document.querySelectorAll(`#view-home [data-qfav="${CSS.escape(key)}"]`)) {
    q.classList.toggle('on', on);
    q.setAttribute('aria-pressed', String(on));
    q.textContent = on ? '♥' : '♡';
  }
}

const thumbCard = (v) => `<button class="card" data-key="${esc(v.key)}">
  <div class="thumb">
    ${v.thumb ? `<img src="${esc(v.thumb)}" loading="lazy" referrerpolicy="no-referrer" alt="">` : `<div class="ph">${esc(v.studio || v.title.slice(0, 12))}</div>`}
    ${v.code ? `<span class="badge code">${esc(v.code)}</span>` : ''}
    ${feature('newBadge') && isNew(v) ? '<span class="badge new">NEW</span>' : ''}
    ${miniPlayer() && miniPlayer().dataset.key === v.key ? '<span class="continue-now">再生中</span>' : ''}
    <span class="qfav${isFav(v.key) ? ' on' : ''}" role="button" aria-label="お気に入り" aria-pressed="${isFav(v.key)}" data-qfav="${esc(v.key)}">${isFav(v.key) ? '♥' : '♡'}</span>
  </div>
  <div class="title">${esc(v.title)}</div>
  ${v.studio ? `<div class="sub">${esc(v.studio)}</div>` : ''}
</button>`;

/** 横に並べた 1 行。items は動画の配列。act は右上の「すべて ›」の動き（'studio:KEY' / 'new' / 'history'）。省略可 */
function rowHTML(title, items, { act = '', sub = '' } = {}) {
  if (!items.length) return '';
  return `<section class="sf hrow" data-row>
    <div class="sf-head">
      <div class="hrow-title"><span class="sf-name">${esc(title)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</div>
      ${act ? `<button class="sf-all" data-act="${esc(act)}">すべて ›</button>` : ''}
    </div>
    <div class="sf-row">${items.map(thumbCard).join('')}</div>
  </section>`;
}

function actorsRowHTML(title, list, { note = '' } = {}) {
  if (!list.length) return '';
  return `<section class="sf hrow">
    <div class="sf-head"><div class="hrow-title"><span class="sf-name">${esc(title)}</span>${note ? `<small>${esc(note)}</small>` : ''}</div><button class="sf-all" data-act="actors-all">すべて ›</button></div>
    <div class="sf-row av-row">${list.map((a) => `<button class="av-card" data-actor="${a.id}">
      <span class="av av-md" data-av="${a.id}">${a.profile && a.profile.photo ? `<img src="${esc(a.profile.photo)}" loading="lazy" referrerpolicy="no-referrer" alt="">` : `<span class="av-ph">${esc((a.display || '?').slice(0, 1))}</span>`}</span>
      <span class="av-name">${esc(a.display)}</span>
    </button>`).join('')}</div>
  </section>`;
}

// ───────────── おすすめ ─────────────

const loadStudioFavs = () => { try { return JSON.parse(localStorage.getItem('vfFavStudios') || '{}') || {}; } catch { return {}; } };

/** そのスタジオ（子を含む）の新しい動画 */
function latestOfStudio(key, n = ROW) {
  const keys = descendantKeys(state.studios, key);
  const out = [];
  for (const v of state.videos) { if (keys.has(v.studioKey)) { out.push(v); if (out.length >= n) break; } }
  return out;
}

// 日替わりで変わる並び（同じ日のあいだは同じ。毎回開くたびに変わらない）
const daySeed = () => { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
function seededShuffle(arr, seed) {
  const a = [...arr];
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const rowVideos = new Map(); // パネル内のカード → その行の動画（詳細で前後に移れるように）

function buildRec() {
  const parts = [];
  // 1. 続きを見る
  if (feature('continueRow') && feature('history')) {
    const items = recentKeys().map((k) => state.byKey.get(k)).filter(Boolean).slice(0, ROW);
    parts.push(rowHTML('続きを見る', items, { act: 'history' }));
  }
  // 2. お気に入りのスタジオの新作
  const favs = Object.entries(loadStudioFavs()).filter(([k]) => state.studios.some((s) => s.key === k));
  for (const [k, name] of favs.slice(0, 4)) parts.push(rowHTML(`${name} の新作`, latestOfStudio(k), { act: `studio:${k}`, sub: '★ お気に入り' }));
  // 3. お気に入りの出演者の新作（出演作の照合ができた人だけ。まだなら取りに行く）
  const favIds = favActorIds().filter((id) => getActor(id));
  for (const id of favIds.slice(0, 4)) {
    const a = getActor(id);
    const vids = videosOf(a).slice(0, ROW);
    if (vids.length) parts.push(rowHTML(`${a.display} の出演作`, vids, { act: `actor:${a.id}`, sub: '♥ お気に入り' }));
  }
  // 4. 新着
  const fresh = state.videos.filter(isNew);
  if (feature('newBadge') && fresh.length) parts.push(rowHTML('新着', fresh.slice(0, ROW), { act: 'panel:new', sub: `${fresh.length.toLocaleString()} 本` }));
  // 5. 今日の発見（サムネイルのある動画から、日替わり）
  const pool = state.videos.filter((v) => v.thumb).slice(0, 4000);
  if (pool.length) parts.push(rowHTML('今日の発見', seededShuffle(pool, daySeed()).slice(0, ROW), { sub: '日替わり' }));
  // 6. お気に入りのスタジオがなければ、人気のスタジオ
  if (!favs.length) {
    for (const s of state.studios.filter((x) => !x.parent && x.total > 0).slice(0, 3)) parts.push(rowHTML(s.name, latestOfStudio(s.key), { act: `studio:${s.key}`, sub: `${s.total.toLocaleString()} 本` }));
  }
  // 7. お気に入りの出演者の顔ぶれ
  const favActors = favIds.map(getActor).filter(Boolean);
  if (favActors.length) parts.push(actorsRowHTML('お気に入りの出演者', favActors));
  const html = parts.filter(Boolean).join('');
  $('#hp-rec').innerHTML = html || (state.posts.size
    ? '<div class="state">まだおすすめがありません。動画を見たり、スタジオ・出演者をお気に入りにすると、ここに並びます</div>'
    : '<div class="state">まだデータがありません。設定から収集してください</div>');
  // お気に入りの出演者の出演作は、照合の材料が要る。まだのものは取って、取れたら描き直す
  for (const id of favIds.slice(0, 4)) {
    const a = getActor(id);
    if (!a.profile || !a.profile.full) enrich(id, 'full').then(() => { if (isHomeOpen() && panel === 'rec') buildRec(); }).catch(() => {});
  }
  rowVideos.clear();
  // 各行の動画（クリックで詳細。前後の移動はその行の中）
  for (const sec of $('#hp-rec').querySelectorAll('[data-row]')) {
    const keys = [...sec.querySelectorAll('.card')].map((c) => c.dataset.key);
    rowVideos.set(sec, keys.map((k) => state.byKey.get(k)).filter(Boolean));
  }
}

// ───────────── 新着 ─────────────

// 前回ホームを開いた（アプリを閉じた）時刻。これより後に見つかった動画を「前回から」の新着とする
const SEEN_KEY = 'homeLastSeen';
const DAY = 24 * 60 * 60 * 1000;
const readSeen = () => { try { return +localStorage.getItem(SEEN_KEY) || 0; } catch { return 0; } };
let prevVisit = readSeen();
let dividerDone = false;
let sinceCount = 0;
const touchSeen = () => { try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch { /* 保存できなくても動く */ } };
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') touchSeen();
  else if (Date.now() - readSeen() > 30 * 60 * 1000) { prevVisit = readSeen(); if (isHomeOpen() && panel === 'new') buildNew(); }
});
addEventListener('pagehide', touchSeen);

const fmtSince = (t) => {
  const d = new Date(t), now = new Date();
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const days = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / DAY);
  return days <= 0 ? `今日 ${hm}` : days === 1 ? `昨日 ${hm}` : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
};

function buildNew() {
  // 前回から（なければ直近 3 日）に見つかった動画を、見つかった順に。長く開かなかったときも取りこぼさない（最大 14 日）
  const now = Date.now();
  const cutoff = prevVisit ? Math.max(Math.min(prevVisit, now - 3 * DAY), now - 14 * DAY) : now - 3 * DAY;
  newList = state.videos.filter((v) => v.seenAt > cutoff).sort((a, b) => b.seenAt - a.seenAt);
  sinceCount = prevVisit ? newList.filter((v) => v.seenAt > prevVisit).length : 0;
  const fresh = newList.length;
  // 新着の印がまだ付かない（はじめての全件取得の分など）ときは、掲載日の新しい順に出す
  if (!fresh) newList = state.videos.slice(0, 300);
  newShown = 0;
  dividerDone = !prevVisit || !fresh;
  $('#hp-new-grid').innerHTML = '';
  $('#hp-new-meta').innerHTML = !fresh
    ? '新着の印の付いた動画はありません。掲載日の新しい順に出します'
    : !prevVisit
      ? `${fresh.toLocaleString()} 本の新着`
      : sinceCount
        ? `<b>前回（${esc(fmtSince(prevVisit))}）から ${sinceCount.toLocaleString()} 本</b>の新着`
        : `前回（${esc(fmtSince(prevVisit))}）から新しい動画はありません。それ以前の ${fresh.toLocaleString()} 本を出します`;
  moreNew();
}

const dividerHTML = () => `<div class="new-divider"><span>${sinceCount ? '前回見たところ' : '前回より前'}</span></div>`;

function moreNew() {
  const next = newList.slice(newShown, newShown + NEW_PAGE);
  if (!next.length) return;
  let html = '';
  next.forEach((v, i) => {
    // 「前回から」と「それ以前」の区切り（前回から新しい動画があるときだけ。先頭には入れない）
    if (!dividerDone && v.seenAt <= prevVisit) { if (newShown + i > 0) html += dividerHTML(); dividerDone = true; }
    html += thumbCard(v);
  });
  $('#hp-new-grid').insertAdjacentHTML('beforeend', html);
  newShown += next.length;
}

// ───────────── 続き（見返す・たどる） ─────────────

function buildCont() {
  const parts = [];
  const hist = recentKeys().map((k) => state.byKey.get(k)).filter(Boolean);
  const favs = favKeys().map((k) => state.byKey.get(k)).filter(Boolean);
  // 続きを見る: 最後に見た 1 本を大きく
  if (hist[0]) {
    const v = hist[0];
    parts.push(`<section class="cont-hero"><button class="card" data-key="${esc(v.key)}" data-hero="1">
      <div class="thumb">${v.thumb ? `<img src="${esc(v.thumb)}" loading="lazy" referrerpolicy="no-referrer" alt="">` : `<div class="ph">${esc(v.studio || v.title.slice(0, 12))}</div>`}
        <span class="cont-play">▶ 続きを見る</span></div>
      <div class="title">${esc(v.title)}</div>${v.studio ? `<div class="sub">${esc(v.studio)}</div>` : ''}</button></section>`);
  }
  parts.push(rowHTML('最近見た動画', hist.slice(1, ROW + 1), { act: 'history' }));
  parts.push(rowHTML('お気に入りの動画', favs.slice(0, ROW), { act: 'favs', sub: `${favs.length.toLocaleString()} 本` }));
  // たどる: 最近見た動画のスタジオの、ほかの動画（見た動画は除く）
  const seen = new Set(hist.map((v) => v.key));
  const studios = [];
  for (const v of hist.slice(0, 12)) if (v.studioKey && !studios.some((s) => s.key === v.studioKey)) studios.push({ key: v.studioKey, name: v.studio });
  for (const s of studios.slice(0, 3)) {
    const items = latestOfStudio(s.key, ROW * 2).filter((x) => !seen.has(x.key)).slice(0, ROW);
    parts.push(rowHTML(`${s.name} のほかの動画`, items, { act: `studio:${s.key}`, sub: '最近見たスタジオ' }));
  }
  const html = parts.filter(Boolean).join('');
  $('#hp-cont').innerHTML = html || '<div class="state">まだ見た動画がありません。動画を再生したりお気に入りにすると、ここに並びます</div>';
  rowVideos.clear();
  for (const sec of $('#hp-cont').querySelectorAll('[data-row]')) {
    const keys = [...sec.querySelectorAll('.card')].map((c) => c.dataset.key);
    rowVideos.set(sec, keys.map((k) => state.byKey.get(k)).filter(Boolean));
  }
}

// ───────────── 出演者 ─────────────

let actorsMounted = false;
function buildActors() {
  const favs = favActorIds().map(getActor).filter(Boolean);
  const all = allActors();
  const popular = all.slice(0, 40);
  const box = $('#hp-actors');
  if (!all.length) {
    box.innerHTML = '<div class="state" id="hp-actors-wait">出演者の一覧を取得しています…（初回だけ）</div>';
    syncIndex().then(() => { if (isHomeOpen() && panel === 'actors') buildActors(); }).catch(() => { const w = $('#hp-actors-wait'); if (w) w.textContent = '通信できませんでした。あとでもう一度開いてください'; });
    return;
  }
  box.innerHTML = actorsRowHTML('お気に入りの出演者', favs) +
    actorsRowHTML('人気の出演者', popular.slice(0, 20), { note: '出演作が多い順' }) +
    '<div class="section-title" style="padding:0 12px">出演者を探す</div><div class="note" style="padding:0 12px 8px">検索タブの「出演者」で、名前・特徴・身長・年齢から探せます。</div>' +
    '<div style="padding:0 12px 24px"><button class="btn primary" data-act="actors-all" type="button">出演者を探す</button></div>';
  // 代表画像を、見えている先頭の数人から取る（一覧に出てきた順）
  for (const a of [...favs, ...popular.slice(0, 20)].slice(0, 14)) {
    if (!a.profile) enrich(a.id, 'brief').then((cur) => { const el = box.querySelector(`.av[data-av="${a.id}"]`); if (el && cur && cur.profile && cur.profile.photo && !el.querySelector('img')) el.innerHTML = `<img src="${esc(cur.profile.photo)}" loading="lazy" referrerpolicy="no-referrer" alt="">`; }).catch(() => {});
  }
}

// ───────────── パネルの切り替え・スワイプ ─────────────

function showPanel(next, { animate = '' } = {}) {
  const prev = panel;
  scrollAt[prev] = window.scrollY;
  panel = next;
  trackView(`home:${panel}`);
  for (const p of PANELS) {
    const el = $(`#hp-${p}-wrap`);
    el.classList.toggle('hidden', p !== panel);
    el.classList.remove('slide-l', 'slide-r');
    if (p === panel && animate) { void el.offsetWidth; el.classList.add(animate); }
  }
  for (const b of document.querySelectorAll('#home-tabs button')) {
    const on = b.dataset.p === panel;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  }
  render();
  window.scrollTo(0, scrollAt[panel] || 0);
}

function render() {
  if (panel === 'cont') buildCont();
  else if (panel === 'rec') buildRec();
  else if (panel === 'new') buildNew();
  else if (panel === 'studios') openStudios();
  else if (panel === 'actors') buildActors();
}

/** タブバーのホームをもう一度押したとき: 先頭へ。先頭にいればおすすめへ */
export function homeToTop() {
  if (window.scrollY > 60) return window.scrollTo({ top: 0, behavior: 'smooth' });
  if (panel !== 'new') showPanel('new');
}

function swipeTo(dir) {
  const i = PANELS.indexOf(panel) + dir;
  if (i < 0 || i >= PANELS.length) return;
  showPanel(PANELS[i], { animate: dir > 0 ? 'slide-l' : 'slide-r' });
}

function init() {
  built = true;
  panel = 'new'; // 起動したらまず新着（前回の続きのパネルは覚えない）
  $('#home-tabs').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.dataset.p === panel) return;
    const dir = PANELS.indexOf(b.dataset.p) > PANELS.indexOf(panel) ? 'slide-l' : 'slide-r';
    showPanel(b.dataset.p, { animate: dir });
  };
  // 左右のスワイプ（縦のスクロール・横に並んだ行・シートの上では切り替えない）
  let sx = 0, sy = 0, t0 = 0, track = false;
  const root = $('#view-home');
  root.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { track = false; return; }
    track = !e.target.closest('.sf-row, .av-row, input, select, textarea');
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; t0 = Date.now();
  }, { passive: true });
  root.addEventListener('touchend', (e) => {
    if (!track) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    track = false;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8 && Date.now() - t0 < 700) swipeTo(dx < 0 ? 1 : -1);
  }, { passive: true });

  // カード・行の操作
  root.addEventListener('click', (e) => {
    const q = e.target.closest('[data-qfav]');
    if (q) { // 開かずにお気に入りを付け外し
      e.stopPropagation();
      const v = state.byKey.get(q.dataset.qfav);
      if (v) toggleFav(v).then((on) => { paintQfav(q.dataset.qfav); toast(on ? 'お気に入りに追加しました' : 'お気に入りから外しました'); }).catch(() => {});
      return;
    }
    const card = e.target.closest('.card');
    if (card && card.dataset.key && !card.closest('#hp-studios')) {
      const v = state.byKey.get(card.dataset.key);
      const sec = card.closest('[data-row]');
      const list = sec ? rowVideos.get(sec) : (card.closest('#hp-new-grid') ? newList : [v]);
      return openDetail(v, { list, index: Math.max(0, list.indexOf(v)), src: card.dataset.hero ? 'home:cont-hero' : undefined });
    }
    const act = e.target.closest('[data-act]');
    if (act) return onAct(act.dataset.act);
    const av = e.target.closest('[data-actor]');
    if (av) return gotoActor(+av.dataset.actor);
  });
  new IntersectionObserver((es) => { if (es[0].isIntersecting && isHomeOpen() && panel === 'new') moreNew(); }, { rootMargin: '600px' }).observe($('#hp-new-sentinel'));
  on('data', () => { if (isHomeOpen() && panel === 'rec' && window.scrollY < 200) buildRec(); });
  on('favactors', () => { if (isHomeOpen() && panel === 'actors') buildActors(); });
  on('history', () => { if (isHomeOpen() && panel === 'rec' && window.scrollY < 200) buildRec(); if (isHomeOpen() && panel === 'cont' && window.scrollY < 200) buildCont(); });
  on('favs', () => { for (const el of document.querySelectorAll('#view-home [data-qfav]')) paintQfav(el.dataset.qfav, el); if (isHomeOpen() && panel === 'cont' && window.scrollY < 200) buildCont(); });
}

// 「すべて ›」などの動き
function onAct(act) {
  const goto = (hash) => { history.replaceState(history.state, '', `${location.pathname}${location.search}${hash}`); dispatchEvent(new HashChangeEvent('hashchange')); dispatchEvent(new Event('viewchange')); };
  if (act === 'history') {
    filters.view = 'history'; filters.studio = ''; filters.q = ''; filters.actor = '';
    saveFilters(); renderChips(); return goto('');
  }
  if (act === 'favs') {
    filters.view = 'fav'; filters.studio = ''; filters.q = ''; filters.actor = '';
    saveFilters(); renderChips(); return goto('');
  }
  if (act === 'actors-all') { try { localStorage.setItem('searchSeg', 'actors'); } catch { /* 無視 */ } return goto('#search'); }
  if (act.startsWith('panel:')) return showPanel(act.slice(6));
  if (act.startsWith('actor:')) return gotoActor(+act.slice(6));
  if (act.startsWith('studio:')) {
    Object.assign(filters, { studio: act.slice(7), view: '', q: '', actor: '' });
    saveFilters(); renderChips(); return goto('');
  }
}

/** ページを開いたとき（route から） */
export function openHome() {
  if (!built) init();
  showPanel(panel);
}

