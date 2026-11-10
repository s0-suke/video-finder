// 起動処理とルーティング（#settings で設定画面、それ以外は一覧）

import { $, toast } from './util.js';
import { openDB } from './db.js';
import { loadAll, on } from './data.js';
import { crawl, initCrawler, maybeAutoCollect, backfillProgress, repairCodes } from './crawler.js';
import * as player from './player.js';
import * as favorites from './favorites.js';
import * as details from './details.js';
import * as history from './history.js';
import { initRelease, collectRelease } from './release.js';
import * as features from './features.js';
import { feature } from './features.js';
import * as version from './version.js';
import { initSheet, hide as hideSheet } from './ui/sheet.js';
import { initList, render, renderChips, saveFilters, dropStaleFilters } from './ui/list.js';
import { openFilters } from './ui/filters.js';
import { initSettings, openSettings } from './ui/settings.js';
import { initTabbar } from './ui/tabbar.js';

function route() {
  const settings = location.hash === '#settings';
  $('#view-list').classList.toggle('hidden', settings);
  $('#view-settings').classList.toggle('hidden', !settings);
  hideSheet();
  window.scrollTo(0, 0);
  if (settings) openSettings(); else render();
}

// iPhone の Safari で開いているときだけ、ホーム画面への追加を案内する（閉じたら出さない）
function installTip() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  let dismissed = false;
  try { dismissed = localStorage.getItem('installTipDismissed') === '1'; } catch {}
  if (!ios || standalone || dismissed || !feature('installTip')) return;
  const el = $('#install-tip');
  el.innerHTML = '<b>ホーム画面に追加すると、アプリとして全画面で使えます</b><br>共有ボタン →「ホーム画面に追加」。収集したデータも消えにくくなります。<button class="close" aria-label="閉じる">×</button>';
  el.classList.remove('hidden');
  el.querySelector('.close').onclick = () => {
    el.classList.add('hidden');
    try { localStorage.setItem('installTipDismissed', '1'); } catch {}
  };
}

async function boot() {
  await openDB();
  await loadAll();
  await initCrawler();
  features.init();
  await Promise.all([favorites.init(), history.init(), player.init(), details.init(), initRelease()]);

  version.init();
  initSheet();
  initList();
  initSettings();
  initTabbar();
  $('#filter-btn').onclick = openFilters;
  on('progress', () => {
    $('#progress').classList.toggle('on', crawl.running);
    // 初回の全件取得中は一覧の上に進み具合を出す
    const p = crawl.running && feature('backfillBanner') ? backfillProgress() : null;
    $('#banner').classList.toggle('hidden', p == null);
    if (p != null) {
      $('#banner').innerHTML = `<b>はじめての取得中… ${Math.floor(p * 100)}%</b><br>アプリを開いたままにしておくと早く終わります。閉じても次に開いたとき続きから再開します。<div class="bar"><span style="width:${(p * 100).toFixed(1)}%"></span></div>`;
    }
  });

  installTip();
  // 機能のオン/オフを変えたら一覧を描き直す
  on('features', () => {
    if (!feature('installTip')) $('#install-tip').classList.add('hidden');
    if (!feature('backfillBanner')) $('#banner').classList.add('hidden');
    renderChips();
    if (location.hash !== '#settings') render();
  });
  dropStaleFilters();
  saveFilters();
  renderChips();
  route();
  // 隠れた操作（長押しでお気に入り）を一度だけ知らせる
  try {
    if (feature('longPressFav') && !localStorage.getItem('hintLongPress') && document.querySelector('.card:not(.skel)')) {
      setTimeout(() => toast('ヒント: カードを長押しするとお気に入りに追加できます'), 1500);
      localStorage.setItem('hintLongPress', '1');
    }
  } catch {}
  addEventListener('hashchange', route);

  // 各サイトの収集が終わってから、発売日の目安（otokoki）の差分を取る
  const auto = () => maybeAutoCollect().then(() => collectRelease()).then(() => repairCodes());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') auto(); });
  setInterval(auto, 60 * 1000);
  auto();
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
// ホーム画面に追加したアプリのデータを iOS が勝手に消さないよう、永続化をお願いする
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

boot().then(() => {
  // ?selftest: 画面の自動テスト（開発用）
  if (new URLSearchParams(location.search).has('selftest')) import('./selftest.js').then((m) => m.runSelftest());
});
