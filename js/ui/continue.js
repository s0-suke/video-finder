// ホームの先頭の「最近見た動画」（視聴履歴の新しい順に横並び。履歴タブまで行かずに見直せるように）
//
// - ホーム（タブ・検索・スタジオ・サイト・出演者の絞り込みなし）のときだけ出す。機能のオン/オフは 'continueRow'（視聴履歴がオフなら出さない）
// - ミニプレイヤーで再生中の動画には「再生中」の印を付ける（タップするとミニプレイヤーを大きく表示）
// - 一覧の描き直し（list.js が emit('listrender')）・履歴・データ・ミニプレイヤーの変化で描き直す

import { $, esc } from '../util.js';
import { state, on } from '../data.js';
import { recentKeys } from '../history.js';
import { feature } from '../features.js';
import { filters, setView } from './list.js';
import { openDetail } from './detail.js';
import { miniPlayer } from './sheet.js';

const MAX = 12;
let items = [];

const visible = () =>
  feature('continueRow') && feature('history') && location.hash !== '#settings' &&
  !filters.view && !filters.q && !filters.studio && !filters.site && !filters.actor;

export function renderContinue() {
  const el = $('#continue');
  if (!el) return;
  items = visible() ? recentKeys().map((k) => state.byKey.get(k)).filter(Boolean).slice(0, MAX) : [];
  el.classList.toggle('hidden', !items.length);
  if (!items.length) { el.innerHTML = ''; return; }
  const playing = miniPlayer()?.dataset.key;
  el.innerHTML = `
    <div class="continue-head"><span>最近見た動画</span><button class="link" type="button" data-act="history">履歴 ›</button></div>
    <div class="related continue-row">
      ${items.map((v, i) => `
        <button class="rel" type="button" data-i="${i}">
          <div class="thumb">${v.thumb ? `<img src="${esc(v.thumb)}" loading="lazy" referrerpolicy="no-referrer" alt="">` : `<div class="ph">${esc(v.studio || '')}</div>`}${v.key === playing ? '<span class="continue-now">再生中</span>' : ''}</div>
          <div class="title">${esc(v.title)}</div>
        </button>`).join('')}
    </div>`;
}

export function initContinue() {
  const el = $('#continue');
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="history"]')) return setView('history');
    const b = e.target.closest('[data-i]');
    if (b) openDetail(items[+b.dataset.i], { list: items, index: +b.dataset.i });
  });
  // サムネイルが読めなければスタジオ名の表示に替える
  el.addEventListener('error', (e) => {
    if (e.target.tagName !== 'IMG') return;
    const ph = document.createElement('div');
    ph.className = 'ph';
    e.target.replaceWith(ph);
  }, true);
  for (const ev of ['listrender', 'history', 'features', 'mini']) on(ev, renderContinue);
  addEventListener('hashchange', renderContinue);
  renderContinue();
}
