// 画面まわりの小さな共通関数

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const fmtDate = (d) => (d ? d.slice(0, 10).replace(/-/g, '/') : '');

const decoder = document.createElement('textarea');
export function decodeEntities(s) {
  decoder.innerHTML = String(s || '').replace(/<[^>]+>/g, '');
  return decoder.value.trim();
}

// 画面下部に短いメッセージを出す
let toastTimer;
export function toast(message) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('on');
  clearTimeout(toastTimer);
  // 長い文は読み終えられるよう長めに出す
  toastTimer = setTimeout(() => el.classList.remove('on'), Math.max(2200, message.length * 90));
}

/**
 * サムネイル（.thumb の中の img）の読み込みに失敗したら、代わりの表示（.ph。カードのタイトルの先頭）に切り替える。
 * error は伝わらないので、キャプチャで拾う。root に 1 回だけ付ける
 */
export function bindThumbFallback(root) {
  root.addEventListener('error', (e) => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG') return;
    const thumb = img.closest('.thumb');
    if (!thumb) return;
    const label = (img.closest('.card, .rel')?.querySelector('.title')?.textContent || '').slice(0, 12);
    const ph = document.createElement('div');
    ph.className = 'ph';
    ph.textContent = label;
    img.replaceWith(ph);
  }, true);
}
