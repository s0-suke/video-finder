// 動画の一覧（ホーム・履歴・お気に入りの共通部品）
//
// - createFeed: グリッドに、40 本ずつ無限スクロールでカードを並べる。タップで詳細（前後の移動はこの一覧の中）、
//   カードのハートで開かずにお気に入り。サムネイルが読めなければ代わりの表示にする。
// - videoMatcher: キーワード（タイトル・品番・タグ・スタジオ名。全角半角・大文字小文字・品番のハイフンは気にしない）に当たる動画の判定
// - bindSearch: タブ内の検索欄（日本語入力の変換中は絞らない）

import { esc, fmtDate, toast, bindThumbFallback } from '../util.js';
import { on, isNew } from '../data.js';
import { isFav, toggleFav } from '../favorites.js';
import { viewedAt } from '../history.js';
import { normalizeCode } from '../matching.js';
import { openDetail } from './detail.js';

const PAGE = 40;

// カード用の短い日付（今年なら「11/04」、それ以外は「2021/05/23」）
const shortDate = (d) => (d && d.startsWith(String(new Date().getFullYear())) ? d.slice(5, 10).replace('-', '/') : fmtDate(d));

export const normalizeQuery = (s) => String(s || '').normalize('NFKC').toLowerCase();

/** キーワードに当たる動画かどうかを返す関数（キーワードが空なら常に true） */
export function videoMatcher(q) {
  const words = normalizeQuery(q).split(/\s+/).filter(Boolean);
  if (!words.length) return () => true;
  return (v) => words.every((w) => v.hay.includes(w) || (v.code && /\d/.test(w) && normalizeCode(v.code).toLowerCase().includes(w.replace(/-/g, ''))));
}

export function cardHTML(v, i, { dateBy = 'post' } = {}) {
  const fav = isFav(v.key);
  const date = dateBy === 'release' ? (v.release ? `発売 ${shortDate(v.release)}${v.releaseSrc === 'estimate' ? '頃' : ''}` : '発売日不明') : shortDate(v.date);
  return `<button class="card" data-i="${i}">
    <div class="thumb">
      ${v.thumb ? `<img src="${esc(v.thumb)}" loading="lazy" referrerpolicy="no-referrer" alt="">` : `<div class="ph">${esc(v.studio || v.title.slice(0, 12))}</div>`}
      ${v.code ? `<span class="badge code">${esc(v.code)}</span>` : ''}
      ${isNew(v) ? '<span class="badge new">NEW</span>' : ''}
      <span class="qfav${fav ? ' on' : ''}" role="button" aria-label="お気に入り" aria-pressed="${fav}" data-qfav="${esc(v.key)}">${fav ? '♥' : '♡'}</span>
    </div>
    ${viewedAt(v.key) ? '<span class="watched">視聴済み</span>' : ''}
    <div class="title">${esc(v.title)}</div>
    <div class="sub">${esc(date)}${v.studio ? ' · ' + esc(v.studio) : ''}</div>
  </button>`;
}

/** どこかでお気に入りが変わったら、画面にあるカードのハートをすべて合わせる */
on('favs', () => {
  for (const q of document.querySelectorAll('.qfav[data-qfav]')) {
    const f = isFav(q.dataset.qfav);
    q.classList.toggle('on', f);
    q.setAttribute('aria-pressed', String(f));
    q.textContent = f ? '♥' : '♡';
  }
});

/**
 * 動画の一覧を作る。
 *   grid / sentinel / stateEl: 一覧の入れ物・続きを読む合図・空のときの案内を出す場所
 *   empty(): 0 件のときの案内（HTML）
 *   group(v): 日付などの見出し（前のカードと違うときに区切りを入れる）。省略可
 *   dateBy(): 'post' | 'release'（カードの日付）。省略可
 * 返り値: { setList(videos), list(), more() }
 */
export function createFeed({ grid, sentinel, stateEl, empty, group, dateBy }) {
  let list = [];
  let shown = 0;
  let lastGroup = null;
  const visible = () => !!grid.offsetParent;

  const more = () => {
    const next = list.slice(shown, shown + PAGE);
    if (!next.length) return;
    let html = '';
    next.forEach((v, k) => {
      if (group) {
        const g = group(v);
        if (g !== lastGroup) { html += `<div class="day-sep">${esc(g)}</div>`; lastGroup = g; }
      }
      html += cardHTML(v, shown + k, { dateBy: dateBy ? dateBy() : 'post' });
    });
    grid.insertAdjacentHTML('beforeend', html);
    shown += next.length;
  };

  new IntersectionObserver((es) => { if (es[0].isIntersecting && shown < list.length && visible()) more(); }, { rootMargin: '800px' }).observe(sentinel);
  bindThumbFallback(grid);

  grid.addEventListener('click', (e) => {
    const q = e.target.closest('[data-qfav]');
    if (q) { // 開かずにお気に入りを付け外し
      e.stopPropagation();
      const v = list[+q.closest('.card').dataset.i];
      if (v) toggleFav(v).then((added) => toast(added ? 'お気に入りに追加しました' : 'お気に入りから外しました')).catch(() => {});
      return;
    }
    const c = e.target.closest('.card');
    if (!c) return;
    const i = +c.dataset.i;
    openDetail(list[i], { list, index: i });
  });

  return {
    setList(next) {
      list = next;
      shown = 0;
      lastGroup = null;
      grid.innerHTML = '';
      more();
      stateEl.innerHTML = list.length ? '' : empty();
    },
    list: () => list,
    more,
  };
}

/** タブ内の検索欄。onQuery(キーワード) を、入力が落ち着いてから呼ぶ。返り値: { value(), set(q) } */
export function bindSearch(input, clear, onQuery) {
  let timer = 0;
  let composing = false;
  const sync = () => { clear.style.display = input.value ? 'block' : 'none'; };
  const fire = () => { clearTimeout(timer); timer = setTimeout(() => onQuery(input.value.trim()), 200); };
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; fire(); });
  input.addEventListener('input', () => { sync(); if (!composing) fire(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
  clear.onclick = () => { input.value = ''; sync(); onQuery(''); input.focus(); };
  sync();
  return {
    value: () => input.value.trim(),
    set(q) { input.value = q; sync(); onQuery(q); },
  };
}
