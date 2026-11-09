// 投稿本文から、再生プレイヤー・画像・説明文を取り出す（詳細を開いたときに 1 件ずつ取得してキャッシュ）

import * as db from './db.js';
import { state } from './data.js';
import { wpGet } from './wp.js';
import { safeUrl } from './matching.js';

const CONTENT_VERSION = 4; // 取り出し方を変えたら上げる（古いキャッシュを取り直す）

// URL は掲載元の投稿 URL を基準に解決し、http(s) 以外（javascript: など）は捨てる。
// 遅延読み込みプラグインの data-src / data-lazy-src を優先する
const srcOf = (el, base) => safeUrl(el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || el.getAttribute('src'), base);

// 説明文から除く段落: リンクだけでできた段落（ダウンロード先の一覧など）と、意味のない短い英字（linksv1 など）
const JUNK_TEXT = /^(links?v?\d*|link\s*\|.*|download|streaming|mirror\s*\d*|[a-z]{1,12}\d*)$/i;
function isLinkList(p) {
  const links = p.querySelectorAll('a');
  if (!links.length) return false;
  const linkText = [...links].reduce((n, a) => n + a.textContent.trim().length, 0);
  return p.textContent.trim().length - linkText < 6;
}

export function parseContent(html, base) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const embeds = [...doc.querySelectorAll('iframe')].map((f) => srcOf(f, base)).filter(Boolean);
  const images = [...doc.querySelectorAll('img')]
    .map((img) => srcOf(img, base))
    .filter((src) => src && !/emoji|gravatar|icon|logo|banner/i.test(src));
  const description = [...doc.querySelectorAll('p')]
    .filter((p) => !p.querySelector('iframe') && !isLinkList(p))
    .map((p) => p.textContent.trim())
    .filter((t) => t.length > 1 && !JUNK_TEXT.test(t))
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
  const parsed = parseContent((data.content && data.content.rendered) || '', post.link || site.url);
  // 収集で更新された最新の行に、本文由来の項目だけを足して保存する（古いコピーで上書きしない）
  const latest = state.posts.get(post.key) || post;
  for (const p of new Set([latest, post])) {
    Object.assign(p, parsed, { contentVersion: CONTENT_VERSION });
    if (!p.thumb && parsed.images.length) p.thumb = parsed.images[0];
  }
  await db.put('posts', latest);
  return latest;
}
