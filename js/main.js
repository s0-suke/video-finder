// 起動処理とルーティング（#settings で設定画面、#studios でスタジオのページ、それ以外は一覧）

import { $, toast } from './util.js';
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
import * as features from './features.js';
import { feature } from './features.js';
import * as version from './version.js';
import { initSheet, hide as hideSheet } from './ui/sheet.js';
import { initList, render, renderChips, saveFilters, dropStaleFilters } from './ui/list.js';
import { openFilters } from './ui/filters.js';
import { initSettings, openSettings } from './ui/settings.js';
import { initTabbar } from './ui/tabbar.js';
import { openHome } from './ui/home.js';
import { openSearch } from './ui/search.js';
import { renderActorPage, initActorPage, actorIdFromHash, renderFavActors } from './ui/actors.js';
import { pageOf, rememberBack, goBack, switchHash, renderTabs } from './ui/tabbar.js';
import { setQuery, filters } from './ui/list.js';

// 開いているページだけを表示する。ページは URL のハッシュで決まる（ui/tabbar.js の pageOf）
const PAGES = { list: '#view-list', home: '#view-home', search: '#view-search', actor: '#view-actor', favactors: '#view-favactors', settings: '#view-settings' };
let lastPage = '';

function route() {
  const page = pageOf();
  for (const [p, sel] of Object.entries(PAGES)) $(sel).classList.toggle('hidden', p !== page);
  hideSheet();
  // 一覧・出演者のページから戻る先を覚える（ホーム・検索・お気に入りの出演者）
  if (lastPage && lastPage !== page) rememberBack(lastHash);
  lastPage = page;
  lastHash = location.hash;
  if (page !== 'home') trackView(page === 'list' ? `list:${filters.view || 'all'}` : page); // ホームはパネルごとに記録する（ui/home.js）
  window.scrollTo(0, 0);
  renderTabs(); // 起動時のように、ハッシュを直接書き換えたあとでもタブの選択表示を合わせる
  if (page === 'settings') openSettings();
  else if (page === 'home') openHome();
  else if (page === 'search') openSearch();
  else if (page === 'actor') renderActorPage(actorIdFromHash());
  else if (page === 'favactors') renderFavActors();
  else render();
}
let lastHash = '';

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
  // 投稿と発売日の対応表を読んでから、一覧を 1 回だけ作る（6 万件の作り直しは iPhone で 1 秒前後かかる）
  await Promise.all([loadAll(), loadRelease()]);
  rebuild();
  await initCrawler();
  features.init();
  await Promise.all([favorites.init(), history.init(), player.init(), details.init(), initRelease(), initActors(), initAnalytics()]);

  version.init();
  initSheet();
  initList();
  initSettings();
  initTabbar();
  initActorPage({
    onBack: goBack,
    // 出演者の名前で動画を探す（otokoki の別名のどれかで、手元の動画の全文検索に当てる）
    onSearchWords: (a) => { switchHash(''); setQuery(a.aliases.find((x) => x.length >= 2) || a.display); },
  });
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
    if (pageOf() === 'list') render();
  });
  dropStaleFilters();
  saveFilters();
  renderChips();
  // はじめに開くのはホーム（ハッシュがなければ、ホームにする）
  if (!location.hash) window.history.replaceState(window.history.state, '', `${location.pathname}${location.search}#home`);
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
