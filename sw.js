// アプリ本体（同一オリジンのファイル）だけをキャッシュする。
// ネット優先で最新版を取り、オフラインのときだけキャッシュを返す。
// 各動画サイトへの通信（API・画像・プレイヤー）はキャッシュせずそのまま通す。
// ファイルを増やしたら SHELL にも足すこと（tests/structure.test.js が漏れを検出する）。
const CACHE = 'vf-v11';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './css/base.css',
  './css/player.css',
  './css/favorites.css',
  './css/details.css',
  './js/main.js',
  './js/util.js',
  './js/db.js',
  './js/wp.js',
  './js/matching.js',
  './js/studios.js',
  './js/data.js',
  './js/crawler.js',
  './js/source.js',
  './js/player.js',
  './js/favorites.js',
  './js/details.js',
  './js/details/otokoki.js',
  './js/details/previews.js',
  './js/details/lightbox.js',
  './js/history.js',
  './js/release.js',
  './js/release-estimate.js',
  './js/features.js',
  './js/version.js',
  './js/selftest.js',
  './js/ui/sheet.js',
  './js/ui/list.js',
  './js/ui/detail.js',
  './js/ui/filters.js',
  './js/ui/settings.js',
  './js/ui/tabbar.js',
  './js/ui/continue.js',
  './js/actor.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // 保存キーは ?v=（版番号）を除いた URL に統一する。版ごとにエントリが増えず、オフラインでも最後に取れた版が返る
  const key = e.request.mode === 'navigate' ? new URL('./', location.href).href : url.origin + url.pathname;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      // HTTP キャッシュの古い版（GitHub Pages は max-age=600）を混ぜないよう、毎回サーバーに更新を確認する
      // 遅いだけのときにキャッシュ（旧版）へ切り替えると、新旧のモジュールが混ざって起動できなくなるので、
      // キャッシュを使うのはネットワークにつながらないときだけにする
      try {
        const res = await fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' });
        if (res.ok) cache.put(key, res.clone());
        return res;
      } catch {
        return (await cache.match(key)) || Response.error();
      }
    })
  );
});
