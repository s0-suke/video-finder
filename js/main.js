// 起動処理とルーティング（#settings で設定画面、それ以外は一覧）

import { $ } from './util.js';
import { openDB } from './db.js';
import { loadAll, on } from './data.js';
import { crawl, initCrawler, maybeAutoCollect } from './crawler.js';
import * as player from './player.js';
import * as favorites from './favorites.js';
import * as details from './details.js';
import * as history from './history.js';
import { initSheet, hide as hideSheet } from './ui/sheet.js';
import { initList, render, renderChips, saveFilters } from './ui/list.js';
import { openFilters } from './ui/filters.js';
import { initSettings, openSettings } from './ui/settings.js';

function route() {
  const settings = location.hash === '#settings';
  $('#view-list').classList.toggle('hidden', settings);
  $('#view-settings').classList.toggle('hidden', !settings);
  hideSheet();
  window.scrollTo(0, 0);
  if (settings) openSettings(); else render();
}

async function boot() {
  await openDB();
  await loadAll();
  await initCrawler();
  await Promise.all([favorites.init(), history.init(), player.init(), details.init()]);

  initSheet();
  initList();
  initSettings();
  $('#filter-btn').onclick = openFilters;
  on('progress', () => $('#progress').classList.toggle('on', crawl.running));

  saveFilters();
  renderChips();
  route();
  addEventListener('hashchange', route);

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') maybeAutoCollect(); });
  setInterval(maybeAutoCollect, 60 * 1000);
  maybeAutoCollect();
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
// ホーム画面に追加したアプリのデータを iOS が勝手に消さないよう、永続化をお願いする
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

boot();
