// アプリ本体（同一オリジンのファイル）だけをキャッシュする。
// ネット優先で最新版を取り、オフラインや応答が遅いときだけキャッシュを返す。
// 各動画サイトへの通信（API・画像・プレイヤー）はキャッシュせずそのまま通す。
const CACHE = 'vf-v1';
const SHELL = ['./', './index.html', './app.js', './manifest.webmanifest', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];

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
      const fresh = fetch(e.request).then((res) => { if (res.ok) cache.put(key, res.clone()); return res; });
      const slow = new Promise((r) => setTimeout(r, 4000));
      try {
        const res = await Promise.race([fresh, slow]);
        if (res) return res;
      } catch {}
      return (await cache.match(key, { ignoreSearch: true })) || fresh;
    })
  );
});
