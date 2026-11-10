// 画像の全画面表示（ライトボックス）

import { esc } from '../util.js';

// 画像を全画面で表示する
//   横スワイプ、または画面の左右の端（各 25%）のタップで前後へ。
//   下スワイプ・下部中央の ✕・画像の外のタップ・ブラウザの戻る操作で閉じる（片手で届く位置だけで操作できるように）。
const EDGE = 0.25; // 左右の端としてタップを前後送りに使う幅（画面幅に対する割合）
const SWIPE_CLOSE = 90; // この距離（px）以上下へスワイプしたら閉じる

export function openLightbox(urls, start) {
  const box = document.createElement('div');
  box.className = 'dt-lightbox';
  box.innerHTML = `
    <div class="dt-lb-track">${urls.map((u) => `<div class="dt-lb-item"><img src="${esc(u)}" referrerpolicy="no-referrer" alt=""></div>`).join('')}</div>
    ${urls.length > 1 ? `
      <button class="dt-lb-nav prev" data-dir="-1" aria-label="前の画像">‹</button>
      <button class="dt-lb-nav next" data-dir="1" aria-label="次の画像">›</button>
      <div class="dt-lb-count"><span data-role="n">${start + 1}</span> / ${urls.length}</div>` : ''}
    <button class="dt-lb-close" aria-label="閉じる">✕</button>`;
  document.body.appendChild(box);
  const track = box.querySelector('.dt-lb-track');
  track.scrollLeft = start * track.clientWidth;
  const counter = box.querySelector('[data-role="n"]');
  const index = () => Math.round(track.scrollLeft / track.clientWidth);
  track.addEventListener('scroll', () => {
    if (counter) counter.textContent = index() + 1;
  }, { passive: true });
  const go = (dir) => {
    const to = Math.min(urls.length - 1, Math.max(0, index() + dir));
    track.scrollTo({ left: to * track.clientWidth, behavior: 'smooth' });
  };

  // 開いたら履歴を 1 つ積む。戻る操作では拡大表示だけを閉じ、詳細シートは残す
  history.pushState({ sheet: true, lightbox: true }, '');
  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    removeEventListener('popstate', onPop);
    box.classList.remove('open');
    setTimeout(() => box.remove(), 200);
  };
  const onPop = () => { if (!(history.state && history.state.lightbox)) finish(); };
  // ✕・下スワイプ・外側のタップで閉じるときは履歴を戻す（popstate で finish される）
  const close = () => { if (closed) return; if (history.state && history.state.lightbox) history.back(); else finish(); };
  addEventListener('popstate', onPop);

  // 下スワイプで閉じる（指に合わせて画像を下げ、背景を薄くする。足りなければ元に戻す）
  // 横の動きは track のスクロール（touch-action: pan-x）に任せ、縦の動きだけここで扱う
  let drag = null; // { id, x, y, dy, vertical }
  let suppressClick = false;
  const setDrag = (dy) => {
    track.style.transform = dy ? `translateY(${dy}px)` : '';
    box.style.setProperty('--dt-lb-fade', String(Math.max(0, 1 - dy / 400)));
  };
  box.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary) { drag = null; box.classList.remove('dragging'); setDrag(0); return; } // 2 本目の指（ピンチ）
    if (closed || e.button > 0 || e.target.closest('button')) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, dy: 0, vertical: null };
  });
  box.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (drag.vertical === null && Math.hypot(dx, dy) > 8) drag.vertical = Math.abs(dy) > Math.abs(dx);
    if (!drag.vertical) return;
    drag.dy = Math.max(0, dy);
    box.classList.add('dragging');
    setDrag(drag.dy);
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { vertical, dy } = drag;
    drag = null;
    box.classList.remove('dragging');
    if (!vertical) return;
    suppressClick = true; // ドラッグの後に来る click で閉じたり送ったりしない
    setTimeout(() => { suppressClick = false; }, 300);
    if (e.type === 'pointerup' && dy >= SWIPE_CLOSE) {
      box.classList.add('dismiss');
      setDrag(dy);
      close();
    } else {
      setDrag(0);
    }
  };
  box.addEventListener('pointerup', endDrag);
  box.addEventListener('pointercancel', endDrag);

  box.addEventListener('click', (e) => {
    if (suppressClick) return;
    if (e.target.closest('.dt-lb-close')) return close();
    const nav = e.target.closest('.dt-lb-nav');
    if (nav) return go(Number(nav.dataset.dir));
    // 左右の端のタップは前後送り（画像の上でも）
    if (urls.length > 1) {
      const w = box.clientWidth;
      if (e.clientX < w * EDGE) return go(-1);
      if (e.clientX > w * (1 - EDGE)) return go(1);
    }
    if (!e.target.closest('img')) close();
  });
  requestAnimationFrame(() => box.classList.add('open'));
}

