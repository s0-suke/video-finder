// 下から出るシート（詳細・絞り込み）
// 開いたときに履歴を 1 つ積むので、iPhone の戻るスワイプ / 戻るボタンで閉じられる
//
// ミニプレイヤー
//   再生中の詳細シートを閉じる（下スワイプ・外側のタップ・戻る操作）と、閉じずにタブバーの上の小さな帯に縮める。
//   iframe は DOM 上で動かすと読み込み直しになるので、シートの要素ごと縮めて（id を #mini に変え）、
//   以降のシート用に空の #sheet を新しく作る。帯をタップすると、その要素を #sheet に戻して全体表示に戻す。

import { $ } from '../util.js';
import { emit } from '../data.js';

const sheet = () => $('#sheet');
let onClose = null;
let mini = null; // 縮めて再生を続けているシートの要素

export const isSheetOpen = () => sheet().classList.contains('open');
export const miniPlayer = () => mini;

// tall: 高さを一定（ほぼ全画面）にする。中身が変わってもボタンの位置が動かないように
export function openSheet(content, { onClose: cb, tall = false } = {}) {
  const el = sheet();
  el.classList.toggle('tall', tall);
  if (onClose) onClose();
  onClose = cb || null;
  el.__restore = null;
  delete el.dataset.key;
  el.innerHTML = '<div class="grabber"></div>';
  if (typeof content === 'string') el.insertAdjacentHTML('beforeend', content);
  else el.appendChild(content);
  el.scrollTop = 0;
  show(el);
  return el;
}

function show(el) {
  if (!isSheetOpen()) history.pushState({ sheet: true }, '');
  el.style.transform = '';
  el.classList.add('open');
  $('#backdrop').classList.add('open');
  document.body.style.overflow = 'hidden';
}

// 再生中のプレイヤーがあるシートは、閉じずにミニプレイヤーにする
const playing = (el) => !!el.querySelector('.player-on iframe');

// 履歴を戻さずに閉じる（画面の切り替え時など、別の遷移の途中で使う）
export function hide() {
  if (!isSheetOpen()) return;
  const el = sheet();
  el.classList.remove('open');
  el.style.transform = '';
  $('#backdrop').classList.remove('open');
  document.body.style.overflow = '';
  if (onClose) { onClose(); onClose = null; }
  emit('sheetclose');
  if (playing(el)) return minimize(el);
  // 閉じるアニメーションの後に中身を消す
  setTimeout(() => { if (!el.classList.contains('open') && !el.classList.contains('mini')) el.innerHTML = ''; }, 300);
}

export function closeSheet() {
  if (!isSheetOpen()) return;
  if (history.state && history.state.sheet) history.back(); // popstate で hide される
  else hide();
}

// ---- ミニプレイヤー ----

function minimize(el) {
  if (mini) closeMini();
  mini = el;
  // 以降のシート（絞り込み・別の動画の詳細）は新しい #sheet で開く
  const fresh = document.createElement('div');
  fresh.className = 'sheet';
  fresh.id = 'sheet';
  el.before(fresh);
  bindSheetGestures(fresh);

  el.id = 'mini';
  el.classList.add('mini');
  el.scrollTop = 0;
  const title = el.querySelector('h2')?.textContent || '';
  const bar = document.createElement('div');
  bar.className = 'mini-bar';
  bar.innerHTML = `
    <button class="mini-info" type="button" aria-label="プレイヤーを大きく表示"><span class="mini-title"></span><span class="mini-sub">タップで大きく表示</span></button>
    <button class="mini-close" type="button" aria-label="再生を終了">×</button>`;
  bar.querySelector('.mini-title').textContent = title;
  el.appendChild(bar);
  placeMini();
  document.body.classList.add('has-mini');
  emit('mini');
}

// タブバーのすぐ上に置く（タブバーの高さは端末の安全領域で変わるので実測する）
function placeMini() {
  if (!mini) return;
  mini.style.bottom = `${Math.round($('#dock').getBoundingClientRect().height) + 6}px`;
}

export function closeMini() {
  if (!mini) return;
  mini.remove(); // iframe ごと消して再生を止める
  mini = null;
  document.body.classList.remove('has-mini');
  emit('mini');
}

export function expandMini() {
  if (!mini) return;
  const el = mini;
  mini = null;
  // 開いている別のシートがあれば閉じずに置き換える（戻る履歴は 1 つのまま）
  const cur = sheet();
  const wasOpen = isSheetOpen();
  if (wasOpen && onClose) { onClose(); onClose = null; }
  cur.remove();
  el.querySelector('.mini-bar')?.remove();
  el.classList.remove('mini');
  el.style.bottom = '';
  el.id = 'sheet';
  document.body.classList.remove('has-mini');
  if (typeof el.__restore === 'function') el.__restore();
  if (wasOpen) el.classList.add('open'); else show(el);
  emit('mini');
}

function bindMiniGestures() {
  // ミニプレイヤーは #mini として作り直されるので、document で受ける
  let sy = null;
  document.addEventListener('click', (e) => {
    if (!mini || !mini.contains(e.target)) return;
    if (e.target.closest('.mini-close')) return closeMini();
    if (e.target.closest('.mini-info')) return expandMini();
  });
  document.addEventListener('touchstart', (e) => {
    sy = mini && mini.contains(e.target) ? e.touches[0].clientY : null;
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (sy == null || !mini) return;
    const dy = e.changedTouches[0].clientY - sy;
    sy = null;
    if (dy > 40) closeMini(); // 下へ払うと終了
    else if (dy < -30) expandMini(); // 上へ払うと大きく表示
  });
  addEventListener('resize', placeMini);
}

// 下スワイプで閉じる（指に合わせてシートを下げ、一定以上で閉じる）
function bindSheetGestures(el) {
  let startY = null, dy = 0;
  el.addEventListener('touchstart', (e) => {
    startY = el.scrollTop <= 0 && !e.target.closest('.related, .tags, .dt-carousel') ? e.touches[0].clientY : null;
    dy = 0;
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (startY == null || !el.classList.contains('open')) return;
    dy = e.touches[0].clientY - startY;
    if (dy <= 0 || el.scrollTop > 0) { el.style.transform = ''; el.style.transition = ''; return; }
    el.style.transition = 'none';
    el.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  el.addEventListener('touchend', () => {
    if (startY == null) return;
    el.style.transition = '';
    const close = dy > 90;
    startY = null;
    if (close) closeSheet();
    else el.style.transform = '';
  });
}

export function initSheet() {
  // 戻った先がまだシートの中（拡大表示などを閉じただけ）なら閉じない
  addEventListener('popstate', () => { if (!(history.state && history.state.sheet)) hide(); });
  $('#backdrop').onclick = closeSheet;
  bindSheetGestures(sheet());
  bindMiniGestures();
}
