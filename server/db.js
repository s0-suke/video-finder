const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'data.db'));
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT,
  last_run TEXT,
  post_count INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS posts (
  site_id INTEGER NOT NULL,
  post_id TEXT NOT NULL,
  link TEXT NOT NULL,
  title TEXT NOT NULL,
  thumb TEXT,
  date TEXT,
  code TEXT,
  group_key TEXT NOT NULL,
  studio TEXT,
  tags TEXT,
  embeds TEXT,
  PRIMARY KEY (site_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_posts_group ON posts(group_key);
CREATE INDEX IF NOT EXISTS idx_posts_date ON posts(date);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`);

// 初回の全件取得の進み具合（途中で止めても続きから再開する）
for (const col of ['backfill_done INTEGER DEFAULT 0', 'backfill_page INTEGER DEFAULT 1']) {
  try { db.exec(`ALTER TABLE sites ADD COLUMN ${col}`); } catch {}
}

db.getSetting = (key, def) => {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : def;
};
db.setSetting = (key, value) => db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));

const DEFAULT_SITES = [
  'https://gayvidsclub.com/',
  'https://igay69.com/',
  'https://poapan.xyz/',
  'https://javboys.com/',
];
if (db.prepare('SELECT COUNT(*) AS n FROM sites').get().n === 0) {
  const ins = db.prepare('INSERT INTO sites (url, name) VALUES (?, ?)');
  for (const u of DEFAULT_SITES) ins.run(u, new URL(u).hostname);
}

module.exports = db;
