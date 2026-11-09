const db = require('./db');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const PER_PAGE = 100;
const DELAY_MS = 800;

// 品番（例: MR-KR2387, GT-2720, SUPD-123）を抜き出して重複統合のキーにする
const CODE_RE = /\b([A-Z]{2,8}-(?:[A-Z]{1,4}-?)?\d{2,6})\b/i;
const codeKey = (code) => 'code:' + code.replace(/-/g, '');

// 品番がない動画は、記号・空白を除いたタイトルで統合する（短すぎるタイトルは誤統合を避けて統合しない）
function groupKey(code, title, siteId, postId) {
  if (code) return codeKey(code);
  const norm = title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return norm.length >= 10 ? 'title:' + norm : `post:${siteId}:${postId}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeEntities(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .trim();
}

function extractCode(title, tags) {
  const m = title.match(CODE_RE);
  if (m) return m[1].toUpperCase();
  for (const t of tags) {
    const mt = t.match(CODE_RE);
    if (mt && mt[0].length >= t.trim().length - 1) return mt[1].toUpperCase();
  }
  return null;
}

function parsePost(site, p) {
  const title = decodeEntities(p.title && p.title.rendered);
  const content = (p.content && p.content.rendered) || '';
  const emb = p._embedded || {};
  const fm = emb['wp:featuredmedia'] && emb['wp:featuredmedia'][0];
  let thumb = (fm && fm.source_url) || null;
  if (!thumb) {
    const img = content.match(/<img[^>]+src="([^"]+)"/i);
    if (img) thumb = img[1];
  }
  const termGroups = emb['wp:term'] || [];
  const cats = (termGroups[0] || []).map((t) => decodeEntities(t.name));
  const tags = (termGroups[1] || []).map((t) => decodeEntities(t.name));
  const embeds = [...content.matchAll(/<iframe[^>]+src="([^"]+)"/gi)].map((m) => m[1]);
  const code = extractCode(title, tags);
  const cleanTitle = code ? title.replace(new RegExp('^\\s*' + code.replace(/-/g, '-?') + '\\s*[–\\-:：]?\\s*', 'i'), '') : title;
  // スタジオ名はタグ側（品番以外）を優先、なければカテゴリ
  const studio = tags.find((t) => !CODE_RE.test(t)) || cats.find((c) => !/^(AAA|uncategorized)$/i.test(c)) || null;
  const finalTitle = cleanTitle || title;
  return {
    site_id: site.id,
    post_id: String(p.id),
    link: p.link,
    title: finalTitle,
    thumb,
    date: p.date,
    code,
    group_key: groupKey(code, finalTitle, site.id, p.id),
    studio,
    tags: JSON.stringify([...new Set([...cats, ...tags])].filter((t) => !CODE_RE.test(t))),
    embeds: JSON.stringify(embeds),
  };
}

const upsert = db.prepare(`
INSERT INTO posts (site_id, post_id, link, title, thumb, date, code, group_key, studio, tags, embeds)
VALUES (:site_id, :post_id, :link, :title, :thumb, :date, :code, :group_key, :studio, :tags, :embeds)
ON CONFLICT(site_id, post_id) DO UPDATE SET
  link=excluded.link, title=excluded.title, thumb=excluded.thumb, date=excluded.date, code=excluded.code,
  group_key=excluded.group_key, studio=excluded.studio, tags=excluded.tags, embeds=excluded.embeds
`);
const exists = db.prepare('SELECT 1 FROM posts WHERE site_id = ? AND post_id = ?');
const setStatus = db.prepare('UPDATE sites SET status = ? WHERE id = ?');

// 品番ルールを変えたときに、取得済みデータの品番・統合キーを付け直す
function reindex() {
  const rows = db.prepare('SELECT site_id, post_id, title, code, tags FROM posts').all();
  const upd = db.prepare('UPDATE posts SET code = ?, group_key = ?, tags = ?, title = ? WHERE site_id = ? AND post_id = ?');
  let changed = 0;
  db.exec('BEGIN');
  for (const r of rows) {
    const tags = JSON.parse(r.tags || '[]');
    const code = r.code || extractCode(r.title, tags);
    const title = code ? r.title.replace(new RegExp('^\\s*' + code.replace(/-/g, '-?') + '\\s*[–\\-:：]?\\s*', 'i'), '') || r.title : r.title;
    upd.run(code, groupKey(code, title, r.site_id, r.post_id), JSON.stringify(tags.filter((t) => !CODE_RE.test(t))), title, r.site_id, r.post_id);
    changed++;
  }
  db.exec('COMMIT');
  return changed;
}

const state = { running: false, current: null };

async function fetchPage(base, page) {
  const url = new URL('wp-json/wp/v2/posts', base);
  url.searchParams.set('per_page', PER_PAGE);
  url.searchParams.set('page', page);
  url.searchParams.set('_fields', 'id,date,link,title,content,_links,_embedded');
  url.searchParams.set('_embed', 'wp:featuredmedia,wp:term');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
      if (res.status === 400) return { posts: [], totalPages: 0 }; // ページ範囲外
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('json')) throw new Error('JSONではない応答（WordPress APIなし／ボット対策の可能性）');
      return { posts: await res.json(), totalPages: +res.headers.get('x-wp-totalpages') || 1 };
    } catch (e) {
      if (attempt === 2 || /HTTP 40[13]|JSONではない/.test(e.message)) throw e;
      await sleep(3000 * (attempt + 1));
    }
  }
}

async function crawlPages(site, startPage, { stopWhenKnown, onPage }) {
  let page = startPage, totalPages = startPage, added = 0;
  while (page <= totalPages) {
    setStatus.run(`収集中 ${page}/${totalPages} ページ`, site.id);
    const r = await fetchPage(site.url, page);
    totalPages = r.totalPages;
    let known = 0;
    for (const p of r.posts) {
      if (exists.get(site.id, String(p.id))) known++; else added++;
      upsert.run(parsePost(site, p));
    }
    if (onPage) onPage(page);
    db.prepare('UPDATE sites SET post_count = (SELECT COUNT(*) FROM posts WHERE site_id = ?) WHERE id = ?').run(site.id, site.id);
    if (stopWhenKnown && r.posts.length && known === r.posts.length) break;
    page++;
    await sleep(DELAY_MS);
  }
  return added;
}

// 新着側から既知の投稿が1ページ丸ごと続くまで取得（差分収集）。
// 初回の全件取得が終わっていなければ、前回の続きのページから最後まで取得する。
async function collectSite(site, { full = false } = {}) {
  state.current = site.name;
  try {
    const savePage = db.prepare('UPDATE sites SET backfill_page = MAX(backfill_page, ?) WHERE id = ?');
    const track = site.backfill_done ? null : (pg) => savePage.run(pg, site.id);
    let added = await crawlPages(site, 1, { stopWhenKnown: !full, onPage: track });
    if (!full && !site.backfill_done && site.backfill_page > 1) {
      added += await crawlPages(site, Math.max(1, site.backfill_page - 1), { stopWhenKnown: false, onPage: track });
    }
    db.prepare('UPDATE sites SET backfill_done = 1 WHERE id = ?').run(site.id);
    const n = db.prepare('SELECT COUNT(*) AS n FROM posts WHERE site_id = ?').get(site.id).n;
    db.prepare('UPDATE sites SET status = ?, last_run = ?, post_count = ? WHERE id = ?')
      .run(`OK（新規 ${added} 件）`, new Date().toISOString(), n, site.id);
  } catch (e) {
    const n = db.prepare('SELECT COUNT(*) AS n FROM posts WHERE site_id = ?').get(site.id).n;
    db.prepare('UPDATE sites SET status = ?, last_run = ?, post_count = ? WHERE id = ?')
      .run('エラー: ' + e.message, new Date().toISOString(), n, site.id);
  }
}

async function collectAll(opts = {}) {
  if (state.running) return false;
  state.running = true;
  (async () => {
    try {
      const sites = opts.siteId
        ? db.prepare('SELECT * FROM sites WHERE id = ?').all(opts.siteId)
        : db.prepare('SELECT * FROM sites WHERE enabled = 1').all();
      for (const s of sites) await collectSite(s, opts);
    } finally {
      state.running = false;
      state.current = null;
    }
  })();
  return true;
}

module.exports = { collectAll, reindex, state };
