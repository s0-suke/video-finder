// Video Finder — iPhone のブラウザ内だけで収集・保存・検索する PWA
// データは IndexedDB に保存し、検索・重複統合はメモリ上で行う

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_SITES = [
  'https://gayvidsclub.com/',
  'https://igay69.com/',
  'https://poapan.xyz/',
  'https://javboys.com/',
];
const PER_PAGE = 100;
const PAGE_DELAY_MS = 300;

// ---------------------------------------------------------------- IndexedDB

let db;
function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('video-finder', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('sites', { keyPath: 'id', autoIncrement: true });
      d.createObjectStore('posts', { keyPath: 'key' }).createIndex('site', 'siteId');
      d.createObjectStore('terms', { keyPath: 'key' });
      d.createObjectStore('kv');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const store = (name, mode = 'readonly') => db.transaction(name, mode).objectStore(name);
const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
function putAll(name, rows) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(name, 'readwrite');
    const s = t.objectStore(name);
    for (const row of rows) s.put(row);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}
async function deleteByIndex(name, index, value) {
  const s = store(name, 'readwrite');
  const keys = await req(s.index(index).getAllKeys(value));
  for (const k of keys) s.delete(k);
}
const kvGet = (k, def) => req(store('kv').get(k)).then((v) => (v === undefined ? def : v));
const kvSet = (k, v) => req(store('kv', 'readwrite').put(v, k));

// ---------------------------------------------------------------- 品番と統合キー

// 品番（例: MR-KR2387, GT-2720, SUPD-123）を抜き出して重複統合のキーにする
const CODE_RE = /\b([A-Z]{2,8}-(?:[A-Z]{1,4}-?)?\d{2,6})\b/i;

function extractCode(title, tags) {
  const m = title.match(CODE_RE);
  if (m) return m[1].toUpperCase();
  for (const t of tags) {
    const mt = t.match(CODE_RE);
    if (mt && mt[0].length >= t.trim().length - 1) return mt[1].toUpperCase();
  }
  return null;
}

// 品番がない動画は、記号・空白を除いたタイトルで統合する（短すぎるタイトルは誤統合を避けて統合しない）
function groupKey(code, title, key) {
  if (code) return 'code:' + code.replace(/-/g, '');
  const norm = title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return norm.length >= 10 ? 'title:' + norm : 'post:' + key;
}

const decoder = document.createElement('textarea');
function decodeEntities(s) {
  decoder.innerHTML = String(s || '').replace(/<[^>]+>/g, '');
  return decoder.value.trim();
}

// ---------------------------------------------------------------- メモリ上のデータ

let sites = [];
const posts = new Map(); // key -> post
let videos = []; // 統合後（新しい順）

async function loadAll() {
  sites = await req(store('sites').getAll());
  if (!sites.length && !(await kvGet('initialized', false))) {
    for (const u of DEFAULT_SITES) await addSite(u, { silent: true });
    await kvSet('initialized', true);
    sites = await req(store('sites').getAll());
  }
  for (const p of await req(store('posts').getAll())) posts.set(p.key, p);
  for (const t of await req(store('terms').getAll())) termCache.set(t.key, t.name);
  rebuild();
}

function rebuild() {
  const enabled = new Set(sites.filter((s) => s.enabled).map((s) => s.id));
  const siteName = Object.fromEntries(sites.map((s) => [s.id, s.name]));
  const groups = new Map();
  for (const p of posts.values()) {
    if (!enabled.has(p.siteId)) continue;
    let g = groups.get(p.group);
    if (!g) groups.set(p.group, (g = []));
    g.push(p);
  }
  const out = [];
  for (const [key, rows] of groups) {
    rows.sort((a, b) => (b.thumb ? 1 : 0) - (a.thumb ? 1 : 0) || (a.date < b.date ? 1 : -1));
    const main = rows[0];
    const tags = [...new Set(rows.flatMap((r) => r.tags))];
    const studio = rows.map((r) => r.studio).find(Boolean) || null;
    const date = rows.reduce((d, r) => (r.date > d ? r.date : d), '');
    const siteIds = new Set(rows.map((r) => r.siteId));
    out.push({
      key, code: main.code, title: main.title, thumb: main.thumb, date, studio, tags, siteIds,
      sources: rows.map((r) => ({ ...r, siteName: siteName[r.siteId] || '?' })),
      hay: [...rows.map((r) => r.title), main.code || '', studio || '', ...tags].join('\n').toLowerCase(),
    });
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  videos = out;
}

// ---------------------------------------------------------------- 収集

const crawl = { running: false, added: 0 };

async function wpGet(site, path, params) {
  const url = new URL('wp-json/wp/v2/' + path, site.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(30000), referrerPolicy: 'no-referrer' });
    } catch (e) {
      lastErr = new Error('取得できません（ボット対策・ブラウザからのアクセス不可・通信エラーのいずれか）');
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (res.status === 400) return { data: [], totalPages: 0 }; // ページ範囲外
    if (res.status === 403 || res.status === 401) throw new Error(`HTTP ${res.status}（アクセス拒否）`);
    if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); await sleep(2000 * (attempt + 1)); continue; }
    if (!(res.headers.get('content-type') || '').includes('json')) throw new Error('WordPress の API が見つかりません');
    return { data: await res.json(), totalPages: +res.headers.get('x-wp-totalpages') || 1 };
  }
  throw lastErr;
}

// タグ・カテゴリ名とサムネイル URL を、投稿 100 件分まとめて引く
const termCache = new Map(); // `${siteId}:${termId}` -> name
async function resolveTerms(site, ids, taxonomy) {
  const missing = [...new Set(ids)].filter((id) => !termCache.has(`${site.id}:${id}`));
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    const { data } = await wpGet(site, taxonomy, { per_page: 100, include: chunk.join(','), _fields: 'id,name' });
    const rows = data.map((t) => ({ key: `${site.id}:${t.id}`, name: decodeEntities(t.name) }));
    for (const r of rows) termCache.set(r.key, r.name);
    for (const id of chunk) if (!termCache.has(`${site.id}:${id}`)) termCache.set(`${site.id}:${id}`, '');
    await putAll('terms', rows);
  }
}
async function resolveMedia(site, ids) {
  const map = {};
  const uniq = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 100) {
    const { data } = await wpGet(site, 'media', { per_page: 100, include: uniq.slice(i, i + 100).join(','), _fields: 'id,source_url' });
    for (const m of data) map[m.id] = m.source_url;
  }
  return map;
}

async function toPosts(site, raw) {
  const [media] = await Promise.all([
    resolveMedia(site, raw.map((p) => p.featured_media)),
    resolveTerms(site, raw.flatMap((p) => p.tags || []), 'tags'),
    resolveTerms(site, raw.flatMap((p) => p.categories || []), 'categories'),
  ]);
  return raw.map((p) => {
    const key = `${site.id}:${p.id}`;
    const title = decodeEntities(p.title && p.title.rendered);
    const tags = (p.tags || []).map((id) => termCache.get(`${site.id}:${id}`)).filter(Boolean);
    const cats = (p.categories || []).map((id) => termCache.get(`${site.id}:${id}`)).filter(Boolean);
    const code = extractCode(title, tags);
    const clean = (code ? title.replace(new RegExp('^\\s*' + code.replace(/-/g, '-?') + '\\s*[–\\-:：]?\\s*', 'i'), '') : title) || title;
    // スタジオ名はタグ側（品番以外）を優先、なければカテゴリ
    const studio = tags.find((t) => !CODE_RE.test(t)) || cats.find((c) => !/^(AAA|uncategorized|未分類)$/i.test(c)) || null;
    const prev = posts.get(key);
    return {
      key, siteId: site.id, postId: p.id, link: p.link, title: clean, date: p.date,
      thumb: media[p.featured_media] || (prev && prev.thumb) || null,
      code, group: groupKey(code, clean, key), studio,
      tags: [...new Set([...cats, ...tags])].filter((t) => !CODE_RE.test(t)),
      embeds: prev ? prev.embeds : undefined,
    };
  });
}

async function saveSite(site) {
  await req(store('sites', 'readwrite').put(site));
  const i = sites.findIndex((s) => s.id === site.id);
  if (i >= 0) sites[i] = site;
}

let rebuildTimer;
function scheduleRebuild() {
  if (rebuildTimer) return;
  rebuildTimer = setTimeout(() => { rebuildTimer = null; rebuild(); onDataChanged(); }, 3000);
}

async function crawlPages(site, start, { stopWhenKnown, track }) {
  let page = start, total = start;
  while (page <= total) {
    site.status = `収集中 ${page}/${total} ページ`;
    renderProgress();
    const { data, totalPages } = await wpGet(site, 'posts', {
      per_page: PER_PAGE, page, _fields: 'id,date,link,title,featured_media,tags,categories',
    });
    total = totalPages;
    if (!data.length) break;
    const rows = await toPosts(site, data);
    let known = 0;
    for (const p of rows) { if (posts.has(p.key)) known++; else crawl.added++; posts.set(p.key, p); }
    await putAll('posts', rows);
    site.count = [...posts.values()].reduce((n, p) => n + (p.siteId === site.id), 0);
    if (track) site.backfillPage = Math.max(site.backfillPage || 1, page);
    await saveSite(site);
    scheduleRebuild();
    if (stopWhenKnown && known === data.length) break;
    page++;
    await sleep(PAGE_DELAY_MS);
  }
}

// 新着側から、既知の投稿が 1 ページ丸ごと続くまで取得（差分収集）。
// 初回の全件取得が終わっていなければ、前回の続きのページから最後まで取得する。
async function crawlSite(site, { full = false } = {}) {
  try {
    const track = !site.backfillDone;
    await crawlPages(site, 1, { stopWhenKnown: !full, track });
    if (!full && !site.backfillDone) {
      await crawlPages(site, site.backfillPage || 1, { stopWhenKnown: false, track });
    }
    site.backfillDone = true;
    site.status = 'OK';
    site.error = false;
  } catch (e) {
    site.status = 'エラー: ' + e.message;
    site.error = true;
  }
  site.lastRun = new Date().toISOString();
  await saveSite(site);
  renderProgress();
}

async function collect({ siteId, full = false } = {}) {
  if (crawl.running) return;
  crawl.running = true;
  crawl.added = 0;
  renderProgress();
  try {
    const targets = sites.filter((s) => (siteId ? s.id === siteId : s.enabled));
    await Promise.all(targets.map((s) => crawlSite(s, { full })));
    await kvSet('lastCollect', Date.now());
  } finally {
    crawl.running = false;
    clearTimeout(rebuildTimer); rebuildTimer = null;
    rebuild();
    onDataChanged();
    renderProgress();
  }
}

// アプリを開いたとき・画面に戻ったときに、前回から一定時間経っていれば新着を取りに行く
async function maybeAutoCollect() {
  const min = await kvGet('intervalMin', 30);
  if (!min || crawl.running || !navigator.onLine) return;
  const last = await kvGet('lastCollect', 0);
  const unfinished = sites.some((s) => s.enabled && !s.backfillDone && !s.error);
  if (unfinished || Date.now() - last >= min * 60 * 1000) collect();
}

async function addSite(input, { silent = false } = {}) {
  let u;
  try { u = new URL(/^https?:\/\//.test(input) ? input : 'https://' + input); } catch { throw new Error('URL が不正です'); }
  const url = `${u.protocol}//${u.host}/`;
  if (sites.some((s) => s.url === url)) throw new Error('登録済みです');
  const site = { url, name: u.hostname, enabled: true, status: null, count: 0, backfillDone: false, backfillPage: 1 };
  if (!silent) await wpGet(site, 'posts', { per_page: 1, _fields: 'id' }); // ブラウザから取得できるか確認
  site.id = await req(store('sites', 'readwrite').add(site));
  sites.push(site);
  return site;
}

async function removeSite(id) {
  await deleteByIndex('posts', 'site', id);
  await req(store('sites', 'readwrite').delete(id));
  sites = sites.filter((s) => s.id !== id);
  for (const [k, p] of posts) if (p.siteId === id) posts.delete(k);
  rebuild();
}

// 再生プレイヤー（iframe）の URL は本文にしかないので、詳細を開いたときに取る
async function loadEmbeds(post) {
  if (post.embeds) return post.embeds;
  const site = sites.find((s) => s.id === post.siteId);
  const { data } = await wpGet(site, 'posts/' + post.postId, { _fields: 'content' });
  const html = (data.content && data.content.rendered) || '';
  post.embeds = [...html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]);
  if (!post.thumb) {
    const img = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (img) post.thumb = img[1];
  }
  posts.set(post.key, post);
  await putAll('posts', [post]);
  return post.embeds;
}

// ---------------------------------------------------------------- 一覧

const PAGE = 40;
const saved = (() => { try { return JSON.parse(localStorage.getItem('filters') || '{}'); } catch { return {}; } })();
const filters = { q: '', site: '', studio: '', sort: 'new', multi: '', ...saved };
let filtered = [];
let shown = 0;

function saveFilters() {
  try { localStorage.setItem('filters', JSON.stringify(filters)); } catch {}
  $('#filter-btn').classList.toggle('active', !!(filters.studio || filters.sort !== 'new' || filters.multi));
}

function applyFilters() {
  const words = filters.q.toLowerCase().split(/\s+/).filter(Boolean);
  const siteId = filters.site ? +filters.site : null;
  filtered = videos.filter((v) =>
    (!siteId || v.siteIds.has(siteId)) &&
    (!filters.studio || v.sources.some((s) => s.studio === filters.studio)) &&
    (!filters.multi || v.siteIds.size > 1) &&
    words.every((w) => v.hay.includes(w)));
  if (filters.sort === 'old') filtered.reverse();
}

const fmtDate = (d) => (d ? d.slice(0, 10).replace(/-/g, '/') : '');

function cardHTML(v, i) {
  const n = v.siteIds.size;
  return `<button class="card" data-i="${i}">
    <div class="thumb">
      ${v.thumb ? `<img src="${esc(v.thumb)}" loading="lazy" referrerpolicy="no-referrer" alt="">` : ''}
      ${v.code ? `<span class="badge code">${esc(v.code)}</span>` : ''}
      ${n > 1 ? `<span class="badge multi">${n}サイト</span>` : ''}
    </div>
    <div class="title">${esc(v.title)}</div>
    <div class="sub">${esc(fmtDate(v.date))}${v.studio ? ' · ' + esc(v.studio) : ''}</div>
  </button>`;
}

function render(reset) {
  if (reset) {
    applyFilters();
    shown = 0;
    $('#grid').innerHTML = '';
    window.scrollTo(0, 0);
  }
  const next = filtered.slice(shown, shown + PAGE);
  $('#grid').insertAdjacentHTML('beforeend', next.map((v, k) => cardHTML(v, shown + k)).join(''));
  shown += next.length;
  $('#meta').textContent = `${filtered.length.toLocaleString()} 件`;
  $('#list-state').textContent = filtered.length
    ? ''
    : posts.size ? '該当する動画がありません' : crawl.running ? '収集中です。少し待つと表示されます…' : 'まだデータがありません。設定から収集してください';
}

new IntersectionObserver((e) => { if (e[0].isIntersecting && shown < filtered.length) render(false); }, { rootMargin: '800px' }).observe($('#sentinel'));

// 収集でデータが増えたとき：一覧の先頭を見ていれば描き直す
function onDataChanged() {
  renderChips();
  if (location.hash === '#settings') return renderSettings();
  if (!$('#sheet').classList.contains('open') && window.scrollY < 300) render(true);
}

// ---------------------------------------------------------------- 検索・チップ

let qTimer;
$('#q').value = filters.q;
$('#q-clear').style.display = filters.q ? 'block' : 'none';
$('#q').addEventListener('input', () => {
  $('#q-clear').style.display = $('#q').value ? 'block' : 'none';
  clearTimeout(qTimer);
  qTimer = setTimeout(() => { filters.q = $('#q').value.trim(); saveFilters(); render(true); }, 250);
});
$('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#q').blur(); });
$('#q-clear').onclick = () => { $('#q').value = ''; $('#q').dispatchEvent(new Event('input')); };

function setQuery(q) {
  $('#q').value = q; filters.q = q; saveFilters();
  $('#q-clear').style.display = q ? 'block' : 'none';
  closeSheet(); render(true);
}

function renderChips() {
  const enabled = sites.filter((s) => s.enabled);
  $('#site-chips').innerHTML =
    `<button class="chip ${!filters.site ? 'on' : ''}" data-site="">すべて</button>` +
    enabled.map((s) => `<button class="chip ${String(filters.site) === String(s.id) ? 'on' : ''}" data-site="${s.id}">${esc(s.name)}</button>`).join('');
}
$('#site-chips').onclick = (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  filters.site = b.dataset.site; saveFilters(); renderChips(); render(true);
};

// ---------------------------------------------------------------- シート（詳細・絞り込み）

function openSheet(html) {
  $('#sheet').innerHTML = '<div class="grabber"></div>' + html;
  $('#sheet').scrollTop = 0;
  $('#sheet').classList.add('open'); $('#backdrop').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  $('#sheet').classList.remove('open'); $('#backdrop').classList.remove('open');
  document.body.style.overflow = '';
  setTimeout(() => { if (!$('#sheet').classList.contains('open')) $('#sheet').innerHTML = ''; }, 300);
}
$('#backdrop').onclick = closeSheet;
// 下スワイプで閉じる
let ty = null;
$('#sheet').addEventListener('touchstart', (e) => { ty = $('#sheet').scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
$('#sheet').addEventListener('touchend', (e) => { if (ty != null && e.changedTouches[0].clientY - ty > 90) closeSheet(); ty = null; });

$('#grid').onclick = (e) => {
  const c = e.target.closest('.card'); if (!c) return;
  const v = filtered[+c.dataset.i];
  openSheet(`
    <div class="hero" id="hero">${v.thumb ? `<img src="${esc(v.thumb)}" referrerpolicy="no-referrer" alt="">` : ''}</div>
    <h2>${esc(v.title)}</h2>
    <div class="kv">${[v.code, v.studio, fmtDate(v.date)].filter(Boolean).map(esc).join(' · ')}</div>
    ${v.tags.length ? `<div class="tags">${v.tags.map((t) => `<button class="tag" data-q="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
    <div class="section-title">掲載サイト（${v.sources.length}）</div>
    ${v.sources.map((s) => `
      <div class="source">
        <div class="head"><span class="name">${esc(s.siteName)}</span></div>
        <div class="btn-row">
          <span class="embeds" data-key="${esc(s.key)}"><button class="btn" disabled>プレイヤー確認中…</button></span>
          <a class="btn" href="${esc(s.link)}" target="_blank" rel="noopener noreferrer">サイトで開く ↗</a>
        </div>
      </div>`).join('')}
  `);
  for (const s of v.sources) {
    const slot = $(`.embeds[data-key="${CSS.escape(s.key)}"]`);
    loadEmbeds(posts.get(s.key))
      .then((list) => {
        slot.innerHTML = list.length
          ? list.map((u, k) => `<button class="btn primary" data-embed="${esc(u)}">▶ 再生${list.length > 1 ? ' ' + (k + 1) : ''}</button>`).join('')
          : '';
      })
      .catch(() => { slot.innerHTML = '<button class="btn" disabled>プレイヤーを取得できません</button>'; });
  }
};
$('#sheet').addEventListener('click', (e) => {
  const t = e.target.closest('[data-q]'); if (t) return setQuery(t.dataset.q);
  const em = e.target.closest('[data-embed]');
  if (em) {
    $('#hero').innerHTML = `<iframe src="${esc(em.dataset.embed)}" allowfullscreen allow="autoplay; fullscreen" referrerpolicy="no-referrer"></iframe>`;
    $('#sheet').scrollTo({ top: 0, behavior: 'smooth' });
  }
});

$('#filter-btn').onclick = () => {
  const counts = new Map();
  for (const v of videos) if (v.studio) counts.set(v.studio, (counts.get(v.studio) || 0) + 1);
  const studios = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 150);
  openSheet(`
    <h2 style="margin-top:0">絞り込み</h2>
    <div class="field"><label>並び順</label>
      <div class="seg" id="f-sort">
        <button data-v="new" class="${filters.sort === 'new' ? 'on' : ''}">新しい順</button>
        <button data-v="old" class="${filters.sort === 'old' ? 'on' : ''}">古い順</button>
      </div>
    </div>
    <div class="field"><label>スタジオ</label>
      <select id="f-studio"><option value="">すべて</option>
        ${studios.map(([name, n]) => `<option value="${esc(name)}" ${filters.studio === name ? 'selected' : ''}>${esc(name)}（${n}）</option>`).join('')}
      </select>
    </div>
    <div class="field switch"><span>複数サイトに掲載されているものだけ</span>
      <button class="toggle ${filters.multi ? 'on' : ''}" id="f-multi" aria-label="切り替え"></button>
    </div>
    <div class="btn-row">
      <button class="btn" id="f-reset">リセット</button>
      <button class="btn primary" id="f-apply" style="flex:1;justify-content:center">適用</button>
    </div>
  `);
  const tmp = { sort: filters.sort, multi: filters.multi };
  $('#f-sort').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; tmp.sort = b.dataset.v; [...$('#f-sort').children].forEach((x) => x.classList.toggle('on', x === b)); };
  $('#f-multi').onclick = (e) => { tmp.multi = tmp.multi ? '' : '1'; e.target.classList.toggle('on', !!tmp.multi); };
  $('#f-reset').onclick = () => { Object.assign(filters, { sort: 'new', studio: '', multi: '' }); saveFilters(); closeSheet(); render(true); };
  $('#f-apply').onclick = () => { Object.assign(filters, tmp, { studio: $('#f-studio').value }); saveFilters(); closeSheet(); render(true); };
};

// ---------------------------------------------------------------- 進捗表示・設定画面

function renderProgress() {
  const bar = $('#progress');
  bar.classList.toggle('on', crawl.running);
  if (location.hash === '#settings') renderSettings();
}

async function renderSettings() {
  $('#sites').innerHTML = sites.map((s) => `
    <div class="site">
      <div class="row">
        <div class="info">
          <div class="host">${esc(s.name)}</div>
          <div class="status ${s.error ? 'err' : ''}">${esc(s.status || '未収集')} · ${(s.count || 0).toLocaleString()} 件${s.lastRun ? ' · ' + new Date(s.lastRun).toLocaleString('ja-JP') : ''}</div>
        </div>
        <button class="toggle ${s.enabled ? 'on' : ''}" data-toggle="${s.id}" aria-label="有効/無効"></button>
      </div>
      <div class="btn-row">
        <button class="btn" data-collect="${s.id}" ${crawl.running ? 'disabled' : ''}>収集</button>
        <a class="btn" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">開く ↗</a>
        <button class="btn danger" data-del="${s.id}">削除</button>
      </div>
    </div>`).join('');
  $('#collect-status').textContent = crawl.running
    ? `収集中…（新規 ${crawl.added.toLocaleString()} 件 / 統合後 ${videos.length.toLocaleString()} 本）`
    : `待機中（統合後 ${videos.length.toLocaleString()} 本）`;
  $('#collect-all').disabled = $('#collect-full').disabled = crawl.running;
  $('#interval').value = String(await kvGet('intervalMin', 30));
  const last = await kvGet('lastCollect', 0);
  $('#last-run').textContent = last ? `前回の収集: ${new Date(last).toLocaleString('ja-JP')}` : 'まだ収集していません';
  if (navigator.storage && navigator.storage.estimate) {
    const { usage } = await navigator.storage.estimate();
    $('#storage').textContent = `使用容量: 約 ${(usage / 1024 / 1024).toFixed(1)} MB`;
  }
}

$('#sites').onclick = async (e) => {
  const t = e.target.closest('[data-toggle]');
  if (t) {
    const s = sites.find((x) => x.id === +t.dataset.toggle);
    s.enabled = !s.enabled;
    await saveSite(s);
    rebuild();
    return onDataChanged();
  }
  const c = e.target.closest('[data-collect]');
  if (c) return collect({ siteId: +c.dataset.collect });
  const d = e.target.closest('[data-del]');
  if (d && confirm('このサイトと収集済みデータを削除しますか？')) { await removeSite(+d.dataset.del); onDataChanged(); }
};
$('#collect-all').onclick = () => collect();
$('#collect-full').onclick = () => { if (confirm('全ページを取り直します。時間と通信量がかかりますがよいですか？')) collect({ full: true }); };
$('#interval').onchange = () => kvSet('intervalMin', +$('#interval').value);
$('#add-form').onsubmit = async (e) => {
  e.preventDefault();
  const btn = $('#add-form button');
  btn.disabled = true;
  try {
    const s = await addSite($('#add-url').value);
    $('#add-url').value = '';
    renderSettings(); renderChips();
    collect({ siteId: s.id });
  } catch (err) {
    alert('追加できませんでした: ' + err.message);
  } finally {
    btn.disabled = false;
  }
};
$('#wipe').onclick = async () => {
  if (!confirm('収集したデータをすべて削除します（サイトの登録は残ります）。よいですか？')) return;
  await req(store('posts', 'readwrite').clear());
  await req(store('terms', 'readwrite').clear());
  posts.clear(); termCache.clear();
  for (const s of sites) Object.assign(s, { count: 0, backfillDone: false, backfillPage: 1, status: null, error: false, lastRun: null });
  for (const s of sites) await saveSite(s);
  await kvSet('lastCollect', 0);
  rebuild(); onDataChanged();
};

// ---------------------------------------------------------------- ルーティング・起動

function route() {
  const s = location.hash === '#settings';
  $('#view-list').classList.toggle('hidden', s);
  $('#view-settings').classList.toggle('hidden', !s);
  closeSheet();
  if (s) { renderSettings(); window.scrollTo(0, 0); } else render(true);
}
addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') maybeAutoCollect(); });
setInterval(maybeAutoCollect, 60 * 1000);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
// ホーム画面に追加したアプリのデータを iOS が勝手に消さないよう、永続化をお願いする
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

(async () => {
  db = await openDB();
  await loadAll();
  saveFilters();
  renderChips();
  route();
  maybeAutoCollect();
})();
