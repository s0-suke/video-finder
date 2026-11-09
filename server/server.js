const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('./db');
const { collectAll, reindex, state } = require('./collector');

const PORT = +process.env.PORT || 8787;

// 定期クローリング（間隔は設定画面から変更可、0で停止）
const schedule = { timer: null, next: null };
function scheduleNext() {
  clearTimeout(schedule.timer);
  const min = +db.getSetting('interval_min', 60);
  if (!min) { schedule.next = null; return; }
  schedule.next = new Date(Date.now() + min * 60 * 1000);
  schedule.timer = setTimeout(() => { collectAll(); scheduleNext(); }, min * 60 * 1000);
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
  });
}

function toVideo(rows, sitesById) {
  const sorted = [...rows].sort((a, b) => (b.thumb ? 1 : 0) - (a.thumb ? 1 : 0) || (a.date < b.date ? 1 : -1));
  const main = sorted[0];
  const tags = new Set();
  for (const r of rows) for (const t of JSON.parse(r.tags || '[]')) tags.add(t);
  return {
    key: main.group_key,
    code: main.code,
    title: main.title,
    thumb: main.thumb,
    date: rows.map((r) => r.date).sort().pop(),
    studio: rows.map((r) => r.studio).find(Boolean) || null,
    tags: [...tags],
    sources: rows.map((r) => ({
      site: sitesById[r.site_id] ? sitesById[r.site_id].name : '?',
      link: r.link,
      title: r.title,
      thumb: r.thumb,
      embeds: JSON.parse(r.embeds || '[]'),
    })),
  };
}

function sitesMap() {
  const m = {};
  for (const s of db.prepare('SELECT * FROM sites').all()) m[s.id] = s;
  return m;
}

function listVideos(q) {
  const where = ['p.site_id IN (SELECT id FROM sites WHERE enabled = 1)'];
  const having = [];
  const params = [];
  const hparams = [];
  for (const w of String(q.q || '').trim().split(/\s+/).filter(Boolean)) {
    having.push('SUM(p.title LIKE ? OR p.code LIKE ? OR p.tags LIKE ? OR p.studio LIKE ?) > 0');
    const like = `%${w}%`;
    hparams.push(like, like, like, like);
  }
  if (q.site) { having.push('SUM(p.site_id = ?) > 0'); hparams.push(+q.site); }
  if (q.studio) { having.push('SUM(p.studio = ?) > 0'); hparams.push(q.studio); }
  if (q.multi === '1') having.push('COUNT(DISTINCT p.site_id) > 1');
  const order = q.sort === 'old' ? 'ASC' : 'DESC';
  const limit = Math.min(+q.limit || 40, 200);
  const offset = +q.offset || 0;
  const base = `FROM posts p WHERE ${where.join(' AND ')} GROUP BY p.group_key ${having.length ? 'HAVING ' + having.join(' AND ') : ''}`;
  const total = db.prepare(`SELECT COUNT(*) AS n FROM (SELECT p.group_key ${base})`).get(...params, ...hparams).n;
  const keys = db.prepare(`SELECT p.group_key AS k, MAX(p.date) AS d ${base} ORDER BY d ${order} LIMIT ? OFFSET ?`)
    .all(...params, ...hparams, limit, offset).map((r) => r.k);
  const sm = sitesMap();
  let items = [];
  if (keys.length) {
    const rows = db.prepare(`SELECT * FROM posts WHERE group_key IN (${keys.map(() => '?').join(',')}) AND site_id IN (SELECT id FROM sites WHERE enabled = 1)`).all(...keys);
    const byKey = {};
    for (const r of rows) (byKey[r.group_key] ||= []).push(r);
    items = keys.map((k) => toVideo(byKey[k], sm));
  }
  return { total, items };
}

const routes = {
  'GET /api/videos': (req, res, url) => json(res, 200, listVideos(Object.fromEntries(url.searchParams))),
  'GET /api/studios': (req, res) => json(res, 200, db.prepare(
    `SELECT studio AS name, COUNT(DISTINCT group_key) AS n FROM posts WHERE studio IS NOT NULL
     AND site_id IN (SELECT id FROM sites WHERE enabled = 1) GROUP BY studio ORDER BY n DESC LIMIT 100`).all()),
  'GET /api/sites': (req, res) => json(res, 200, {
    sites: db.prepare('SELECT * FROM sites ORDER BY id').all(),
    running: state.running,
    current: state.current,
    groups: db.prepare('SELECT COUNT(DISTINCT group_key) AS n FROM posts').get().n,
    interval: +db.getSetting('interval_min', 60),
    next: schedule.next,
  }),
  'POST /api/settings': async (req, res) => {
    const body = await readBody(req);
    if ('interval' in body) { db.setSetting('interval_min', Math.max(0, +body.interval || 0)); scheduleNext(); }
    json(res, 200, { ok: true, next: schedule.next });
  },
  'POST /api/sites': async (req, res) => {
    const { url } = await readBody(req);
    let u;
    try { u = new URL(/^https?:\/\//.test(url) ? url : 'https://' + url); } catch { return json(res, 400, { error: 'URLが不正です' }); }
    const norm = `${u.protocol}//${u.host}/`;
    try {
      db.prepare('INSERT INTO sites (url, name) VALUES (?, ?)').run(norm, u.hostname);
    } catch { return json(res, 409, { error: '登録済みです' }); }
    json(res, 200, { ok: true });
  },
  'POST /api/collect': async (req, res) => {
    const body = await readBody(req);
    const started = await collectAll({ siteId: body.siteId, full: !!body.full });
    json(res, 200, { started });
  },
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const route = routes[`${req.method} ${url.pathname}`];
  if (route) return route(req, res, url);

  const m = url.pathname.match(/^\/api\/sites\/(\d+)$/);
  if (m && req.method === 'DELETE') {
    db.prepare('DELETE FROM posts WHERE site_id = ?').run(+m[1]);
    db.prepare('DELETE FROM sites WHERE id = ?').run(+m[1]);
    return json(res, 200, { ok: true });
  }
  if (m && req.method === 'PATCH') {
    const body = await readBody(req);
    if ('enabled' in body) db.prepare('UPDATE sites SET enabled = ? WHERE id = ?').run(body.enabled ? 1 : 0, +m[1]);
    return json(res, 200, { ok: true });
  }

  let file = path.join(__dirname, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(__dirname, 'public', 'index.html');
  }
  const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' };
  if (/\.(html|js|webmanifest)$/.test(file)) headers['Cache-Control'] = 'no-cache';
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`起動しました:`);
  console.log(`  このPC:  http://localhost:${PORT}`);
  try { console.log(`  スマホ:  http://${require('child_process').execSync('scutil --get LocalHostName').toString().trim()}.local:${PORT}`); } catch {}
  for (const ip of ips) console.log(`  スマホ:  http://${ip}:${PORT}`);
});

reindex();
collectAll();
scheduleNext();
