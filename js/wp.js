// WordPress REST API（/wp-json/wp/v2/）をブラウザから直接呼ぶクライアント

import { sleep } from './util.js';

export async function wpGet(baseUrl, path, params = {}) {
  const url = new URL('wp-json/wp/v2/' + path, baseUrl);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(30000), referrerPolicy: 'no-referrer' });
    } catch {
      lastErr = new Error('取得できません（ボット対策・ブラウザからのアクセス不可・通信エラーのいずれか）');
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (res.status === 400) return { data: [], totalPages: 0 }; // ページ範囲外
    if (res.status === 403 || res.status === 401) throw new Error(`HTTP ${res.status}（アクセス拒否）`);
    if (res.status === 404) throw new Error('HTTP 404（見つかりません）');
    if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); await sleep(2000 * (attempt + 1)); continue; }
    if (!(res.headers.get('content-type') || '').includes('json')) throw new Error('WordPress の API が見つかりません');
    return { data: await res.json(), totalPages: +res.headers.get('x-wp-totalpages') || 1 };
  }
  throw lastErr;
}
