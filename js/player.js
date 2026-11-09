// 再生プレイヤー（仮実装：担当エージェントが広告ブロック付きに差し替える）
//
// 公開する関数（detail.js / main.js から使う。名前と引数は変えないこと）
//   init()                         起動時に 1 回呼ばれる（設定画面への項目追加など）
//   mountPlayer(container, url)    container（16:9 の枠）の中身を、url のプレイヤーに置き換える

import { esc } from './util.js';

export function init() {}

export function mountPlayer(container, url) {
  container.innerHTML = `<iframe src="${esc(url)}" allowfullscreen allow="autoplay; fullscreen" referrerpolicy="no-referrer"></iframe>`;
}
