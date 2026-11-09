// 外部サイト（otokoki.net など）から取る詳細情報（仮実装：担当エージェントが本実装に差し替える）
//
// 公開する関数（detail.js / main.js から使う。名前と引数は変えないこと）
//   init()                                        起動時に 1 回呼ばれる
//   mountDetails(container, video, { onTag, onStudio })
//       詳細シートの container に、説明文・画像・出演者/ジャンルなどを非同期で描画する。
//       タグ的なものを押したら onTag(文字列) を、スタジオを押したら onStudio(studioKey) を呼ぶ。

export function init() {}

export function mountDetails(container, video, { onTag, onStudio } = {}) {}
