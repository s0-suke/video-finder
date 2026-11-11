// 一覧（検索・スタジオのチップ・無限スクロール）
//
// 表示の切り替え（ホーム / 新着 / お気に入り / 履歴）は画面下のタブバー（ui/tabbar.js）が filters.view を変える
// 上部のチップ: すべて / 上位のスタジオ / スタジオ一覧…

import { $, esc, fmtDate, toast } from '../util.js';

// カード用の短い日付（今年なら「11/04」、それ以外は「2021/05/23」）
const shortDate = (d) => (d && d.startsWith(String(new Date().getFullYear())) ? d.slice(5, 10).replace('-', '/') : fmtDate(d));
import { state, on, emit, isNew } from '../data.js';
import { crawl, collect } from '../crawler.js';
import { isFav, favAddedAt, toggleFav } from '../favorites.js';
import { viewedAt } from '../history.js';
import { normalizeCode } from '../matching.js';
import { descendantKeys } from '../studios.js';
import { feature } from '../features.js';
import { isSheetOpen } from './sheet.js';
import { openDetail } from './detail.js';
import { openStudioPicker } from './filters.js';

const PAGE = 40;
const CHIP_STUDIOS = 15;

// view: '' = すべて / 'new' = 新着 / 'fav' = お気に入り / 'history' = 履歴
const saved = (() => { try { return JSON.parse(localStorage.getItem('filters3') || '{}'); } catch { return {}; } })();
// dateBy: 'post' = 各サイトの掲載日 / 'release' = 元動画の発売日（目安。release.js。推定した日付も同じように並べ、カードでは「頃」を付ける）
export const filters = { q: '', studio: '', site: '', sort: 'new', dateBy: 'post', view: '', hideNoThumb: false, ...saved, actor: '' };
// 出演者で絞り込んでいるときの動画の key（actor.js が otokoki から探す。起動し直したら外れる）
let actorKeys = new Set();
let filtered = [];
let shown = 0;

export function saveFilters() {
  try { localStorage.setItem('filters3', JSON.stringify({ ...filters, actor: '' })); } catch {}
  $('#filter-btn').classList.toggle('active', !!(filters.site || filters.sort !== 'new' || filters.dateBy !== 'post' || filters.hideNoThumb));
}

// 全角/半角・大文字/小文字・品番のハイフンの有無を気にせず探せるようにする
export const normalizeQuery = (s) => s.normalize('NFKC').toLowerCase();

function matches(v, words) {
  return words.every((w) => v.hay.includes(w) || (v.code && /\d/.test(w) && normalizeCode(v.code).toLowerCase().includes(w.replace(/-/g, ''))));
}

function applyFilters() {
  const words = normalizeQuery(filters.q).split(/\s+/).filter(Boolean);
  const siteId = filters.site ? +filters.site : null;
  const view = filters.view;
  // スタジオの絞り込みは、選んだスタジオとその子孫（親を選ぶと子の動画も出る）
  const studioSet = filters.studio ? descendantKeys(state.studios, filters.studio) : null;
  filtered = state.videos.filter((v) =>
    (view !== 'fav' || isFav(v.key)) &&
    (view !== 'history' || viewedAt(v.key)) &&
    (view !== 'new' || isNew(v)) &&
    (!studioSet || studioSet.has(v.studioKey)) &&
    (!siteId || v.siteIds.has(siteId)) &&
    (!filters.hideNoThumb || v.thumb) &&
    (!filters.actor || actorKeys.has(v.key)) &&
    matches(v, words));
  if (view === 'history') filtered.sort((a, b) => viewedAt(b.key) - viewedAt(a.key));
  else if (view === 'fav') filtered.sort((a, b) => favAddedAt(b.key) - favAddedAt(a.key));
  else if (filters.sort === 'random') {
    const r = new Map(filtered.map((v) => [v.key, hash(v.key + shuffleSeed)]));
    filtered.sort((a, b) => r.get(a.key) - r.get(b.key));
  } else {
    // state.videos は掲載日の新しい順。発売日で並べるときだけ並べ直す
    // 発売日で並べるときは発売日の分かるものだけを並べ替え、不明なものは（掲載日の順で）後ろに回す
    if (filters.dateBy === 'release') {
      const known = filtered.filter((v) => v.release).sort((a, b) => (a.release < b.release ? 1 : a.release > b.release ? -1 : 0));
      const unknown = filtered.filter((v) => !v.release);
      if (filters.sort === 'old') known.reverse();
      filtered = [...known, ...unknown];
    } else if (filters.sort === 'old') filtered.reverse();
  }
}

// ランダム順は、起動ごと・並び順を選び直すごとに変わり、スクロール中は変わらない
let shuffleSeed = String(Math.random());
export const reshuffle = () => { shuffleSeed = String(Math.random()); };
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function cardHTML(v, i) {
  return `<button class="card" data-i="${i}">
    <div class="thumb">
      ${v.thumb ? `<img src="${esc(v.thumb)}" loading="lazy" referrerpolicy="no-referrer" alt="">` : `<div class="ph">${esc(v.studio || v.title.slice(0, 12))}</div>`}
      ${v.code ? `<span class="badge code">${esc(v.code)}</span>` : ''}
      ${feature('newBadge') && isNew(v) ? '<span class="badge new">NEW</span>' : ''}
      ${isFav(v.key) ? '<span class="badge fav" aria-label="お気に入り">♥</span>' : ''}
    </div>
    ${feature('history') && viewedAt(v.key) ? '<span class="watched">視聴済み</span>' : ''}
    <div class="title">${esc(v.title)}</div>
    <div class="sub">${filters.dateBy === 'release' ? (v.release ? '発売 ' + esc(shortDate(v.release)) + (v.releaseSrc === 'estimate' ? '頃' : '') : '発売日不明') : esc(shortDate(v.date))}${v.studio ? ' · ' + esc(v.studio) : ''}</div>
  </button>`;
}

const EMPTY = {
  fav: 'お気に入りはまだありません。動画の詳細で ♡ を押すと追加されます',
  history: '再生した動画がここに並びます',
  new: '前回までの取得のあとに新しく見つかった動画が、3 日間ここに並びます（はじめての全件取得の分は含みません）',
};

export function render(reset = true) {
  if (reset) {
    applyFilters();
    shown = 0;
    $('#grid').innerHTML = '';
    window.scrollTo(0, 0);
  }
  const next = filtered.slice(shown, shown + PAGE);
  $('#grid').insertAdjacentHTML('beforeend', next.map((v, k) => cardHTML(v, shown + k)).join(''));
  shown += next.length;
  renderMeta();
  if (reset) emit('listrender'); // ホームの「最近見た動画」（continue.js）が出し分ける
  $('#list-state').innerHTML = filtered.length
    ? ''
    : activeConditions().some((c) => !c.order) ? '該当する動画がありません<div class="btn-row" style="justify-content:center"><button class="btn" data-clear="all">すべての条件を外す</button></div>'
    : (!filters.q && !filters.studio && EMPTY[filters.view]) ? EMPTY[filters.view]
    : state.posts.size ? '該当する動画がありません'
    : crawl.running ? '収集中です。少し待つと表示されます…'
    : 'まだデータがありません。設定から収集してください';
}

export function renderChips() {
  // チップに並べるのは親のないスタジオ（子は親の下。親は子を含めた本数 total の順）
  const roots = state.studios.filter((s) => !s.parent);
  const top = roots.slice(0, CHIP_STUDIOS);
  // 選択中のスタジオが上位に入っていなくても（子のスタジオのときも）チップに出す
  if (filters.studio && !top.some((s) => s.key === filters.studio)) {
    const cur = state.studios.find((s) => s.key === filters.studio);
    if (cur) top.unshift(cur);
  }
  const chip = (on, attrs, label) => `<button class="chip ${on ? 'on' : ''}" ${attrs}>${label}</button>`;
  $('#chips').innerHTML =
    chip(!filters.studio, 'data-chip="all"', 'すべて') +
    top.map((s) => chip(filters.studio === s.key, `data-chip="studio" data-key="${esc(s.key)}"`, esc(s.name))).join('') +
    (state.studios.length > CHIP_STUDIOS ? '<button class="chip more" data-chip="more">スタジオ一覧…</button>' : '');
  // 選んでいるチップが横スクロールの外にあれば見える位置まで送る
  const on = $('#chips .chip.on');
  if (on && filters.studio) on.scrollIntoView({ inline: 'center', block: 'nearest' });
}

// 保存してある絞り込みの対象（スタジオ・サイト）がなくなっていたら外す。外したら true
export function dropStaleFilters() {
  if (!state.videos.length) return false;
  let changed = false;
  if (filters.studio && !state.studios.some((s) => s.key === filters.studio)) { filters.studio = ''; changed = true; }
  if (filters.site && !state.sites.some((s) => String(s.id) === String(filters.site) && s.enabled)) { filters.site = ''; changed = true; }
  return changed;
}

const VIEW_LABEL = { '': '', new: '新着', fav: 'お気に入り', history: '履歴' };

// 効いている条件（タブとスタジオ以外）。件数の横に × 付きで出し、押すと外せる
function activeConditions() {
  const c = [];
  if (filters.actor) c.push({ id: 'actor', label: `出演: ${filters.actor}` });
  if (filters.q) c.push({ id: 'q', label: `“${filters.q}”` });
  // 並び順はお気に入り・履歴では効かない（追加順・視聴順で並ぶ）ので出さない
  const sorted = filters.view !== 'fav' && filters.view !== 'history';
  if (sorted && filters.dateBy === 'release') c.push({ id: 'dateBy', label: '発売日順', order: true });
  if (sorted && filters.sort === 'old') c.push({ id: 'sort', label: '古い順', order: true });
  if (sorted && filters.sort === 'random') c.push({ id: 'sort', label: 'ランダム', order: true });
  if (filters.site) c.push({ id: 'site', label: state.sites.find((s) => String(s.id) === String(filters.site))?.name || 'サイト' });
  if (filters.hideNoThumb) c.push({ id: 'hideNoThumb', label: 'サムネなし除外' });
  if (filters.studio) c.push({ id: 'studio', label: state.studios.find((x) => x.key === filters.studio)?.name || 'スタジオ' });
  return c;
}

function renderMeta() {
  const head = [VIEW_LABEL[filters.view], `${filtered.length.toLocaleString()} 件`].filter(Boolean).join(' · ');
  $('#meta').innerHTML = `<span>${esc(head)}</span>` +
    activeConditions().map((c) => `<button class="cond" data-clear="${c.id}" aria-label="${esc(c.label)}を外す">${esc(c.label)} <b>×</b></button>`).join('');
}

function clearCondition(id) {
  const reset = { q: '', dateBy: 'post', sort: 'new', site: '', hideNoThumb: false, studio: '', actor: '' };
  if (id === 'all') Object.assign(filters, reset);
  else filters[id] = reset[id];
  if (id === 'q' || id === 'all') { $('#q').value = ''; $('#q-clear').style.display = 'none'; }
  saveFilters();
  renderChips();
  render();
}

export function setView(view) {
  filters.view = view;
  saveFilters();
  renderChips();
  render();
  dispatchEvent(new Event('viewchange')); // タブバーの表示を合わせる（tabbar.js）
}

// ---- 最近の検索 ----

const RECENT_MAX = 12;
const loadRecent = () => { try { return JSON.parse(localStorage.getItem('recentQueries') || '[]'); } catch { return []; } };
function saveRecent(list) { try { localStorage.setItem('recentQueries', JSON.stringify(list.slice(0, RECENT_MAX))); } catch {} }
function rememberQuery(q) {
  if (!feature('recentSearch')) return;
  q = q.trim();
  if (q.length < 2) return;
  // 続けて打った語（「マッチョ」→「マッチョ 筋肉」）は、先頭の途中の語を置き換える
  const [head, ...rest] = loadRecent();
  const list = head && q.startsWith(head) ? rest : [head, ...rest].filter(Boolean);
  saveRecent([q, ...list.filter((x) => x !== q)]);
}

function renderSuggest() {
  const box = $('#suggest');
  const recent = loadRecent();
  if (!feature('recentSearch') || $('#q').value || !recent.length) return box.classList.add('hidden');
  box.innerHTML = `<div class="suggest-head">最近の検索</div>` +
    recent.map((q) => `<div class="suggest-row"><button class="suggest-q" data-q="${esc(q)}">${esc(q)}</button><button class="suggest-del" data-del="${esc(q)}" aria-label="削除">×</button></div>`).join('');
  box.classList.remove('hidden');
}

export function setQuery(q) {
  $('#q').value = q;
  filters.q = q;
  saveFilters();
  $('#q-clear').style.display = q ? 'block' : 'none';
  render();
}

// 出演者の作品だけにする（検索語・スタジオは外す。ほかのタブにいたらホームに戻す）
export function setActor(name, keys) {
  actorKeys = keys;
  Object.assign(filters, { actor: name, q: '', studio: '', view: '' });
  $('#q').value = '';
  $('#q-clear').style.display = 'none';
  saveFilters();
  renderChips();
  render();
  dispatchEvent(new Event('viewchange')); // タブバーの表示を合わせる
}

export function setStudio(key) {
  filters.studio = key;
  saveFilters();
  renderChips();
  render();
}

export function initList() {
  new IntersectionObserver((e) => { if (e[0].isIntersecting && shown < filtered.length) render(false); }, { rootMargin: '800px' })
    .observe($('#sentinel'));

  let qTimer, rememberTimer, composing = false;
  // 日本語入力の変換中は最近の検索に残さない
  $('#q').addEventListener('compositionstart', () => { composing = true; });
  $('#q').addEventListener('compositionend', () => { composing = false; });
  $('#q').value = filters.q;
  $('#q-clear').style.display = filters.q ? 'block' : 'none';
  $('#q').addEventListener('input', () => {
    $('#q-clear').style.display = $('#q').value ? 'block' : 'none';
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      filters.q = $('#q').value.trim();
      saveFilters();
      render();
      // 入力が止まって 2 秒たち、結果があれば最近の検索に残す
      clearTimeout(rememberTimer);
      rememberTimer = setTimeout(() => { if (filtered.length && !composing) rememberQuery(filters.q); }, 2000);
    }, 250);
  });
  $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#q').blur(); });
  $('#q-clear').onclick = () => { $('#q').value = ''; $('#q').dispatchEvent(new Event('input')); $('#q').focus(); };

  // 検索欄が空のときは最近の検索を出す。候補のタップで blur より先に処理されるよう pointerdown で受ける
  $('#q').addEventListener('focus', renderSuggest);
  $('#q').addEventListener('input', renderSuggest);
  $('#q').addEventListener('blur', () => {
    // 結果が 0 件の語は残さない
    if (filtered.length && filters.q === $('#q').value.trim()) rememberQuery(filters.q);
    setTimeout(() => $('#suggest').classList.add('hidden'), 150);
  });
  $('#suggest').addEventListener('pointerdown', (e) => {
    e.preventDefault(); // 検索欄のフォーカスを外さない
    const d = e.target.closest('[data-del]');
    if (d) { saveRecent(loadRecent().filter((x) => x !== d.dataset.del)); return renderSuggest(); }
    const q = e.target.closest('[data-q]');
    if (q) { setQuery(q.dataset.q); rememberQuery(q.dataset.q); $('#suggest').classList.add('hidden'); $('#q').blur(); }
  });

  // 表示の切り替え（新着・お気に入り・履歴）とスタジオは組み合わせられる
  // 件数の横の条件チップ・0 件のときの解除ボタン
  const onClear = (e) => { const b = e.target.closest('[data-clear]'); if (b) clearCondition(b.dataset.clear); };
  $('#meta').addEventListener('click', onClear);
  $('#list-state').addEventListener('click', onClear);

  $('#chips').onclick = (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const kind = b.dataset.chip;
    if (kind === 'more') return openStudioPicker();
    if (kind === 'all') filters.studio = '';
    if (kind === 'studio') filters.studio = filters.studio === b.dataset.key ? '' : b.dataset.key;
    saveFilters();
    renderChips();
    render();
    $(`#chips [data-chip="${kind}"]${b.dataset.key ? `[data-key="${CSS.escape(b.dataset.key)}"]` : ''}`)
      ?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  };

  // タップで詳細、長押しでお気に入りの追加/解除
  let pressTimer = null, pressed = false;
  $('#grid').addEventListener('touchstart', (e) => {
    const c = e.target.closest('.card');
    if (!c || !feature('longPressFav')) return;
    pressed = false;
    pressTimer = setTimeout(async () => {
      pressed = true;
      const v = filtered[+c.dataset.i];
      const added = await toggleFav(v);
      toast(added ? '♥ お気に入りに追加しました' : 'お気に入りから外しました');
    }, 550);
  }, { passive: true });
  const cancel = () => { clearTimeout(pressTimer); pressTimer = null; };
  $('#grid').addEventListener('touchmove', cancel, { passive: true });
  $('#grid').addEventListener('touchend', cancel);
  $('#grid').addEventListener('contextmenu', (e) => { if (e.target.closest('.card')) e.preventDefault(); });
  // サムネイルの読み込みに失敗したら、代わりの表示（スタジオ名）に切り替える
  $('#grid').addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName !== 'IMG' || !img.closest('.thumb')) return;
    const v = filtered[+img.closest('.card').dataset.i];
    const ph = document.createElement('div');
    ph.className = 'ph';
    ph.textContent = (v && (v.studio || v.title.slice(0, 12))) || '';
    img.replaceWith(ph);
  }, true);

  $('#grid').onclick = (e) => {
    const c = e.target.closest('.card');
    if (!c) return;
    if (pressed) { pressed = false; return; } // 長押しの直後のタップは無視
    openDetail(filtered[+c.dataset.i], { list: filtered, index: +c.dataset.i });
  };

  // 一番上で下に引っ張ると新着を取りに行く（ホーム画面アプリには標準の引っ張って更新がないため）
  const ptr = $('#ptr');
  let pullStart = null, pulled = 0;
  addEventListener('touchstart', (e) => {
    pullStart = feature('pullRefresh') && !e.target.closest('#dock, .suggest') && window.scrollY <= 0 && !isSheetOpen() && !location.hash ? e.touches[0].clientY : null;
  }, { passive: true });
  addEventListener('touchmove', (e) => {
    if (pullStart == null) return;
    pulled = Math.max(0, e.touches[0].clientY - pullStart);
    ptr.style.height = Math.min(pulled * 0.5, 60) + 'px';
    ptr.textContent = pulled > 110 ? '離すと新着を確認' : '引っ張って新着を確認';
  }, { passive: true });
  addEventListener('touchcancel', () => { pullStart = null; pulled = 0; ptr.style.height = '0px'; });
  addEventListener('touchend', () => {
    if (pullStart == null) return;
    if (pulled > 110) {
      if (crawl.running) toast('収集中です');
      else { toast('新着を確認しています…'); collect(); }
    }
    pullStart = null; pulled = 0;
    ptr.style.height = '0px';
  });

  // 収集でデータが増えたとき：一覧の先頭を見ていれば描き直す
  on('data', () => {
    if (dropStaleFilters()) saveFilters();
    renderChips();
    if (!location.hash && !isSheetOpen() && window.scrollY < 300) render();
  });
  // お気に入り・履歴が変わったら、絞り込み中なら描き直し、そうでなければ該当カードだけ更新する
  const refresh = (view) => () => {
    if (location.hash) return;
    if (filters.view === view) return render();
    for (const card of $('#grid').querySelectorAll('.card')) {
      const v = filtered[+card.dataset.i];
      const has = !!card.querySelector('.badge.fav');
      if (v && has !== isFav(v.key)) card.outerHTML = cardHTML(v, +card.dataset.i);
    }
  };
  on('favs', refresh('fav'));
  // 再生はシートの中なので、履歴の表示中ならシートを閉じたときに並びを更新する
  let historyDirty = false;
  on('history', () => { historyDirty = true; });
  on('sheetclose', () => {
    if (!historyDirty) return;
    historyDirty = false;
    if (filters.view === 'history') return render();
    // それ以外の表示では、視聴済みの印だけ付け直す
    for (const card of $('#grid').querySelectorAll('.card')) {
      const v = filtered[+card.dataset.i];
      if (v && !card.querySelector('.watched') && viewedAt(v.key)) card.outerHTML = cardHTML(v, +card.dataset.i);
    }
  });
}
