// 起動処理とルーティング（#home / #actors / #history / #favs / #settings / #actor/<id>）

import { $ } from './util.js';
import { openDB } from './db.js';
import { loadAll, rebuild, on } from './data.js';
import { crawl, initCrawler, maybeAutoCollect, backfillProgress, repairCodes } from './crawler.js';
import * as player from './player.js';
import * as favorites from './favorites.js';
import * as details from './details.js';
import * as history from './history.js';
import { initAnalytics, trackView } from './analytics.js';
import { initActors } from './actors.js';
import { initRelease, loadRelease, collectRelease } from './release.js';
import * as version from './version.js';
import { initSheet, hide as hideSheet } from './ui/sheet.js';
import { initSettings, openSettings } from './ui/settings.js';
import { initTabbar, pageOf, switchHash, renderTabs } from './ui/tabbar.js';
import { initLayout } from './ui/layout.js';
import { openHome, filters } from './ui/home.js';
import { openHistory } from './ui/history-view.js';
import { openFavs, favSegment } from './ui/favs.js';
import { openActors, renderActorPage, initActorPage, actorIdFromHash, actorFrom } from './ui/actors.js';

// 開いているページだけを表示する。ページは URL のハッシュで決まる（ui/tabbar.js の pageOf）
const PAGES = { home: '#view-home', actors: '#view-actors', history: '#view-history', favs: '#view-favs', actor: '#view-actor', settings: '#view-settings' };
let lastPage = '';
const scrollAt = {}; // ページごとのスクロール位置（タブを行き来しても、見ていた位置に戻る）

/** アクセス解析に残す画面の名前 */
const surfaceOf = (page) => (page === 'home' ? `home:${filters.view}` : page === 'favs' ? `favs:${favSegment()}` : page);

function route() {
  const page = pageOf();
  if (lastPage) scrollAt[lastPage] = window.scrollY;
  for (const [p, sel] of Object.entries(PAGES)) $(sel).classList.toggle('hidden', p !== page);
  hideSheet();
  const changed = page !== lastPage;
  lastPage = page;
  trackView(surfaceOf(page));
  renderTabs();
  if (page === 'settings') openSettings();
  else if (page === 'home') openHome();
  else if (page === 'actors') openActors();
  else if (page === 'history') openHistory();
  else if (page === 'favs') openFavs();
  else if (page === 'actor') renderActorPage(actorIdFromHash());
  // 別のページから来たときは、そのページで見ていた位置へ（出演者の詳細は毎回先頭から）
  restoreScroll(changed && page !== 'actor' ? scrollAt[page] || 0 : 0);
}

/** y へスクロールする。一覧が作り直されて高さが足りないときは、末尾に着くたびに続きが読み込まれるので、届くまで繰り返す */
let restoreToken = 0;
function restoreScroll(y) {
  const mine = ++restoreToken;
  let n = 0;
  const step = () => {
    if (mine !== restoreToken) return; // 別のページに移った
    window.scrollTo(0, y);
    if (Math.abs(window.scrollY - y) < 4 || n++ > 25) return;
    setTimeout(step, 80);
  };
  step();
}

// iPhone の Safari で開いているときだけ、ホーム画面への追加を案内する（閉じたら出さない）
function installTip() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  let dismissed = false;
  try { dismissed = localStorage.getItem('installTipDismissed') === '1'; } catch { /* 無視 */ }
  if (!ios || standalone || dismissed) return;
  const el = $('#install-tip');
  el.innerHTML = '<b>ホーム画面に追加すると、アプリとして全画面で使えます</b><br>共有ボタン →「ホーム画面に追加」。収集したデータも消えにくくなります。<button class="close" aria-label="閉じる">×</button>';
  el.classList.remove('hidden');
  el.querySelector('.close').onclick = () => {
    el.classList.add('hidden');
    try { localStorage.setItem('installTipDismissed', '1'); } catch { /* 無視 */ }
  };
}

async function boot() {
  await openDB();
  // 投稿と発売日の対応表を読んでから、一覧を 1 回だけ作る（6 万件の作り直しは iPhone で 1 秒前後かかる）
  await Promise.all([loadAll(), loadRelease()]);
  rebuild();
  await initCrawler();
  await Promise.all([favorites.init(), history.init(), player.init(), details.init(), initRelease(), initActors(), initAnalytics()]);

  version.init();
  initSheet();
  initSettings();
  initTabbar();
  initLayout();
  initActorPage({ onBack: () => switchHash(actorFrom && pageOf(actorFrom) !== 'actor' ? actorFrom : '#actors') });
  on('progress', () => {
    $('#progress').classList.toggle('on', crawl.running);
    // 初回の全件取得中は一覧の上に進み具合を出す
    const p = crawl.running ? backfillProgress() : null;
    $('#banner').classList.toggle('hidden', p == null);
    if (p != null) {
      $('#banner').innerHTML = `<b>はじめての取得中… ${Math.floor(p * 100)}%</b><br>アプリを開いたままにしておくと早く終わります。閉じても次に開いたとき続きから再開します。<div class="bar"><span style="width:${(p * 100).toFixed(1)}%"></span></div>`;
    }
  });

  installTip();
  // はじめに開くのはホーム（ハッシュがなければ、ホームにする。昔の形のハッシュも）
  if (pageOf() === 'home' && location.hash !== '#home') window.history.replaceState(window.history.state, '', `${location.pathname}${location.search}#home`);
  route();
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
