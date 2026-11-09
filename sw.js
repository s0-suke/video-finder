// アプリ本体（同一オリジンのファイル）だけをキャッシュする。
// ネット優先で最新版を取り、オフラインや応答が遅いときだけキャッシュを返す。
// 各動画サイトへの通信（API・画像・プレイヤー）はキャッシュせずそのまま通す。
// ファイルを増やしたら SHELL にも足すこと（tests/structure.test.js が漏れを検出する）。
const CACHE = 'vf-v4';
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
  './js/data.js',
  './js/crawler.js',
  './js/source.js',
  './js/player.js',
  './js/favorites.js',
  './js/details.js',
  './js/history.js',
  './js/ui/sheet.js',
  './js/ui/list.js',
  './js/ui/detail.js',
  './js/ui/filters.js',
  './js/ui/settings.js',
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
  const key = e.request.mode === 'navigate' ? './' : e.request;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      // HTTP キャッシュの古い版（GitHub Pages は max-age=600）を混ぜないよう、毎回サーバーに更新を確認する
      const fresh = fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' })
        .then((res) => { if (res.ok) cache.put(key, res.clone()); return res; });
      const slow = new Promise((r) => setTimeout(r, 4000));
      try {
        const res = await Promise.race([fresh, slow]);
        if (res) return res;
      } catch {}
      return (await cache.match(key, { ignoreSearch: true })) || fresh;
    })
  );
});
