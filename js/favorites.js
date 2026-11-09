// お気に入り（仮実装：担当エージェントが本実装に差し替える）
//
// 公開する関数（list.js / detail.js / main.js から使う。名前と引数は変えないこと）
//   init()              起動時に 1 回呼ばれる（IndexedDB の favs ストアから読み込む）。Promise を返してよい
//   isFav(key)          同期で真偽を返す（一覧の描画で大量に呼ばれる）
//   toggleFav(video)    追加/解除。変わったら data.js の emit('favs') を呼ぶ
//   favButton(video)    詳細シートに置くハートボタン（HTMLElement）を返す

import { emit } from './data.js';

const favs = new Set();

export async function init() {}

export const isFav = (key) => favs.has(key);

export async function toggleFav(video) {
  if (favs.has(video.key)) favs.delete(video.key); else favs.add(video.key);
  emit('favs');
}

export function favButton(video) {
  const b = document.createElement('button');
  b.className = 'btn';
  const paint = () => { b.textContent = isFav(video.key) ? '♥ お気に入り' : '♡ お気に入り'; };
  paint();
  b.onclick = async () => { await toggleFav(video); paint(); };
  return b;
}
