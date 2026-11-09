// 下から出るシート（詳細・絞り込み）
// 開いたときに履歴を 1 つ積むので、iPhone の戻るスワイプ / 戻るボタンで閉じられる

import { $ } from '../util.js';
import { emit } from '../data.js';

const sheet = () => $('#sheet');
let onClose = null;

export const isSheetOpen = () => sheet().classList.contains('open');

export function openSheet(content, { onClose: cb } = {}) {
  const el = sheet();
  if (onClose) onClose();
  onClose = cb || null;
  el.innerHTML = '<div class="grabber"></div>';
  if (typeof content === 'string') el.insertAdjacentHTML('beforeend', content);
  else el.appendChild(content);
  el.scrollTop = 0;
  if (!isSheetOpen()) history.pushState({ sheet: true }, '');
  el.classList.add('open');
  $('#backdrop').classList.add('open');
  document.body.style.overflow = 'hidden';
  return el;
}

// 履歴を戻さずに閉じる（画面の切り替え時など、別の遷移の途中で使う）
export function hide() {
  if (!isSheetOpen()) return;
  sheet().classList.remove('open');
  $('#backdrop').classList.remove('open');
  document.body.style.overflow = '';
  if (onClose) { onClose(); onClose = null; }
  emit('sheetclose');
  // 閉じるアニメーションの後に中身（再生中の iframe など）を消す
  setTimeout(() => { if (!isSheetOpen()) sheet().innerHTML = ''; }, 300);
}

export function closeSheet() {
  if (!isSheetOpen()) return;
  if (history.state && history.state.sheet) history.back(); // popstate で hide される
  else hide();
}

export function initSheet() {
  addEventListener('popstate', hide);
  $('#backdrop').onclick = closeSheet;
  // 下スワイプで閉じる
  let startY = null;
  sheet().addEventListener('touchstart', (e) => { startY = sheet().scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
  sheet().addEventListener('touchend', (e) => {
    if (startY != null && e.changedTouches[0].clientY - startY > 90) closeSheet();
    startY = null;
  });
}
