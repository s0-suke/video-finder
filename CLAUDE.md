# Video Finder

- 本体はリポジトリ直下の PWA（`index.html` / `js/` / `css/` / `sw.js`）。ビルド工程も依存パッケージもない素の HTML/JS。
- `main` に push すると GitHub Pages（https://s0-suke.github.io/video-finder/）に反映される。
- 主な利用環境は iPhone の Safari（ホーム画面に追加した状態）。UI はスマホ幅を基準に作り、システムフォント・ダークテーマを保つ。
- データはブラウザの IndexedDB だけに保存する。サーバー側に収集データを置かない（リポジトリは公開）。
- 動作確認は `.claude/launch.json` の `pwa`（`python3 -m http.server 8790`）を起動し、スマホ幅で行う。
- 実際の収集が走るので、確認が終わったらタブを閉じる。
- `server/` は旧版（Node のサーバー版）。現在は使っていない。

## 開発の進め方

- 構成: `js/main.js`（起動）→ `data.js`（メモリ上の状態とイベント）/ `crawler.js`（収集）/ `source.js`（本文の取得）/ `matching.js`（品番・統合キー。純粋関数）/ `db.js`（IndexedDB）/ `wp.js`（WordPress API）/ `ui/`（画面）。
  拡張用モジュールは `player.js`（再生）/ `favorites.js`（お気に入り）/ `details.js`（外部サイトの詳細情報。`details/` に otokoki・サンプル画像・全画面表示を分けている）/ `history.js`（視聴履歴）。
- モジュール間は `data.js` の `emit` / `on` のイベント（'data' / 'progress' / 'favs' / 'history'）でつなぐ。設定画面への項目追加は `ui/settings.js` の `registerSettingsSection`。
- スタイルは `css/base.css` と、拡張モジュールごとの `css/<module>.css`。
- ファイルを増やしたら `sw.js` の `SHELL` に足す。`npm test`（`node --test`）が import 先・SHELL・index.html の参照漏れを検出する。
- ブラウザ確認は URL に `?dev` を付ける（各サイト 1 ページ目だけ取得し、全件取得をしない）。
- 文言・コメントは日本語。
- コミット前に必ずブラウザで `?dev&selftest` を開き、画面右上の結果（`window.__selftest`）がすべて成功することを確かめる（`js/selftest.js`。主な操作を自動で試す。操作を足したらテストも足す）。`npm test` はファイル構成・export の整合性・純粋関数しか見ないので、同じファイル内の関数を消したことなどは検出できない。
- 一括置換のスクリプトで広い範囲を書き換えたときは、`git diff` で消えた行（`-` の行）を必ず見直す。
- 公開（push）するまとまりごとに `js/version.js` の `VERSION` を上げ、`CHANGELOG` の先頭に利用者向けの言葉で変更点を足す（設定画面の更新履歴に出る。`npm test` が先頭と VERSION の一致を確かめる）。
- UI は片手操作が前提: 主要な操作（タブ、詳細の再生・前後移動）は画面下に置く。検索欄はキーボードと干渉するので上部のヘッダーに置く。
- JS / CSS を変えたら `npm run stamp`（`tools/stamp.js`）で index.html の import map と CSS・main.js の URL に版番号（中身のハッシュ）を付け直す。ブラウザは同じ URL の JS をメモリに持ち続けて Service Worker を通さずに使うことがあるため。付け忘れは `npm test` が検出する。

## 複数エージェントでの開発の進め方（この体制で作ってきた）

- 並行で作業させるときは、担当ファイルが重ならないように分け（例: `js/player.js` + `css/player.css`）、公開インターフェース（関数名・引数）を先に決めて仮実装を置く。各エージェントは `isolation: worktree` で別の作業コピーに入り、最初に `git merge --ff-only main` してから作業し、自分のブランチにコミットする（push はしない）。
- ブラウザ確認はエージェントごとに別ポート（8791〜）でサーバーを立て、自分専用のタブで行い、終わったら閉じる。
- 取り込みは `git merge`。`index.html` の版番号は両側で変わるので衝突したら片側を採用して `npm run stamp` で付け直す。取り込み後に `git worktree remove` とブランチ削除で片付ける。
- まとまった変更のあとは、前回のレビュー以降の差分（`git diff <前回>..HEAD`）を、読むだけのレビューエージェントに渡して不具合を探させる。使い勝手は、先入観のないエージェントに利用者目線で画面を触らせて点検させる。
