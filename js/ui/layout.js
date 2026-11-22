// 動画の一覧の列数（1 列 / 2 列）の切り替え
//
// ホーム・履歴・お気に入りの検索欄の右のボタン（[data-cols-toggle]）で切り替える。選んだ列数は端末に覚える（localStorage の vfCols）。
// html に cols-1 のクラスを付け外しして、css/base.css が .grid の列数を変える。

const KEY = 'vfCols';

const load = () => { try { return localStorage.getItem(KEY) === '1' ? 1 : 2; } catch { return 2; } };

function apply(cols) {
  document.documentElement.classList.toggle('cols-1', cols === 1);
  for (const b of document.querySelectorAll('[data-cols-toggle]')) {
    b.setAttribute('aria-pressed', String(cols === 1));
    b.title = cols === 1 ? '2 列にする' : '1 列にする';
  }
}

export const currentCols = () => (document.documentElement.classList.contains('cols-1') ? 1 : 2);

export function initLayout() {
  apply(load());
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-cols-toggle]')) return;
    const next = currentCols() === 1 ? 2 : 1;
    try { localStorage.setItem(KEY, String(next)); } catch { /* 保存できなくても、このあいだは効く */ }
    apply(next);
  });
}
