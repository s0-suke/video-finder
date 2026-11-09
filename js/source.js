// 投稿本文から、再生プレイヤー・画像・説明文を取り出す（詳細を開いたときに 1 件ずつ取得してキャッシュ）

import * as db from './db.js';
import { state } from './data.js';
import { wpGet } from './wp.js';

const CONTENT_VERSION = 2; // 取り出し方を変えたら上げる（古いキャッシュを取り直す）

export function parseContent(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const embeds = [...doc.querySelectorAll('iframe[src]')].map((f) => f.getAttribute('src'));
  const images = [...doc.querySelectorAll('img')]
    .map((img) => img.getAttribute('data-src') || img.getAttribute('src'))
    .filter((src) => src && /^https?:/.test(src) && !/emoji|gravatar|icon|logo|banner/i.test(src));
  const description = [...doc.querySelectorAll('p')]
    .filter((p) => !p.querySelector('iframe'))
    .map((p) => p.textContent.trim())
    .filter((t) => t.length > 1)
    .join('\n\n');
  return { embeds, images: [...new Set(images)], description };
}

const inflight = new Map(); // post.key -> 取得中の Promise（詳細シートと details.js が同時に呼んでも 1 回で済ませる）

// post に embeds / images / description を付けて返す
export function loadContent(post) {
  if (post.contentVersion === CONTENT_VERSION) return Promise.resolve(post);
  if (!inflight.has(post.key)) {
    inflight.set(post.key, fetchContent(post).finally(() => inflight.delete(post.key)));
  }
  return inflight.get(post.key);
}

async function fetchContent(post) {
  const site = state.sites.find((s) => s.id === post.siteId);
  const { data } = await wpGet(site.url, 'posts/' + post.postId, { _fields: 'content' });
  Object.assign(post, parseContent((data.content && data.content.rendered) || ''), { contentVersion: CONTENT_VERSION });
  if (!post.thumb && post.images.length) post.thumb = post.images[0];
  state.posts.set(post.key, post);
  await db.put('posts', post);
  return post;
}
