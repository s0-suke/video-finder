# Video Finder

- 本体はリポジトリ直下の PWA（`index.html` / `app.js` / `sw.js`）。ビルド工程も依存パッケージもない素の HTML/JS。
- `main` に push すると GitHub Pages（https://s0-suke.github.io/video-finder/）に反映される。
- 主な利用環境は iPhone の Safari（ホーム画面に追加した状態）。UI はスマホ幅を基準に作り、システムフォント・ダークテーマを保つ。
- データはブラウザの IndexedDB だけに保存する。サーバー側に収集データを置かない（リポジトリは公開）。
- 動作確認は `.claude/launch.json` の `pwa`（`python3 -m http.server 8790`）を起動し、スマホ幅で行う。
- 実際の収集が走るので、確認が終わったらタブを閉じる。
- `server/` は旧版（Node のサーバー版）。現在は使っていない。
