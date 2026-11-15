// 画面の自動テスト（スモークテスト）
//
// URL に ?selftest を付けて開くと、起動後に主な操作を実際の画面で順に試し、結果を画面右上と
// window.__selftest（{ done, passed, failed, results: [{ name, ok, detail }] }）に出す。
// ?dev と一緒に使う（例: http://localhost:8790/?dev&selftest）。試験で変えた状態（絞り込み・お気に入り）は最後に元に戻す。

import { $, $$ } from './util.js';
import { state, DEFAULT_SITES } from './data.js';
import { allActors, getActor, isFavActor, toggleFavActor } from './actors.js';
import * as db from './db.js';
import { filters, saveFilters, render, renderChips, setActor } from './ui/list.js';
import { recentKeys } from './history.js';
import { isFav } from './favorites.js';
import { isSheetOpen, miniPlayer } from './ui/sheet.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await wait(100); }
  return false;
}
const tab = (t) => $(`#tabbar [data-tab="${t}"]`).click();
const lib = (v) => $(`#lib-seg [data-lib="${v}"]`).click(); // お気に入り（動画｜出演者｜履歴）の切り替え
const goto = async (hash) => { history.replaceState(history.state, '', location.pathname + location.search + hash); dispatchEvent(new HashChangeEvent('hashchange')); dispatchEvent(new Event('viewchange')); await wait(500); };
const listPage = () => goto(''); // 一覧（検索・スタジオ・出演者の結果。お気に入り・履歴）のページ
const back = async () => { history.back(); await wait(400); };
const typeQuery = async (q) => {
  const input = $('#q');
  input.value = q;
  input.dispatchEvent(new Event('input'));
  await wait(450);
};

export async function runSelftest() {
  const results = [];
  const errors = [];
  addEventListener('error', (e) => errors.push(e.message));
  addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
  const savedFilters = { ...filters };
  const check = async (name, fn) => {
    try {
      const detail = await fn();
      results.push({ name, ok: true, detail: detail || '' });
    } catch (e) {
      results.push({ name, ok: false, detail: e.message });
    }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

  await until(() => state.videos.length > 0, 20000);
  // 以降の多くのテストは、一覧のページ（すべての動画。前回の保存状態の「履歴」などではなく）で走らせる
  Object.assign(filters, { view: '', q: '', studio: '', actor: '', site: '' });
  saveFilters(); renderChips();
  await listPage();
  render();
  await until(() => $$('#grid .card:not(.skel)').length > 0, 10000);

  await check('起動して一覧が出る', () => {
    const n = $$('#grid .card:not(.skel)').length;
    assert(n > 0, 'カードがない');
    return `${state.videos.length} 本 / カード ${n} 枚`;
  });

  await check('検索で絞り込める（品番のハイフンなしでも当たる）', async () => {
    const v = state.videos.find((x) => x.code);
    assert(v, '品番のある動画がない');
    await typeQuery(v.code.replace(/-/g, '').toLowerCase());
    assert($$('#grid .card').length >= 1, `「${v.code}」で 0 件`);
    assert($('#meta .cond'), '条件チップが出ない');
    $('#meta .cond').click();
    await wait(300);
    assert(!filters.q, '条件チップで検索が外れない');
  });

  await check('0 件のとき解除ボタンが出る', async () => {
    await typeQuery('zzzz存在しない語');
    assert($('#list-state [data-clear="all"]'), '解除ボタンがない');
    $('#list-state [data-clear="all"]').click();
    await wait(300);
    assert($$('#grid .card').length > 0, '解除しても一覧が戻らない');
  });

  await check('スタジオのチップで絞り込み、すべてで戻る', async () => {
    filters.view = ''; saveFilters(); renderChips(); render();
    const chip = $('#chips [data-chip="studio"]');
    assert(chip, 'スタジオのチップがない');
    chip.click();
    await wait(300);
    assert(filters.studio, 'スタジオが選ばれない');
    $('#chips [data-chip="all"]').click();
    await wait(300);
    assert(!filters.studio, 'すべてで戻らない');
  });

  await check('タブの切り替え（ホーム・お気に入り（動画｜出演者｜履歴）・検索・設定の 4 つ）', async () => {
    assert($$('#tabbar button').length === 4, 'タブが 4 つではない');
    tab('home'); await wait(500);
    assert(location.hash === '#home' && !$('#view-home').classList.contains('hidden'), 'ホームが出ない');
    assert($('#tabbar [data-tab="home"]').classList.contains('on'), 'ホームのタブが選ばれない');
    tab('fav'); await wait(400);
    assert(filters.view === 'fav' || filters.view === 'history' || location.hash === '#favactors', 'お気に入りタブ');
    lib('fav'); await wait(400);
    assert(filters.view === 'fav' && !$('#lib-seg').classList.contains('hidden'), 'お気に入り（動画）の切り替えが出ない');
    lib('history'); await wait(400);
    assert(filters.view === 'history' && $('#tabbar [data-tab="fav"]').classList.contains('on'), '履歴のときも、お気に入りのタブが選ばれたまま');
    lib('actors'); await wait(500);
    assert(location.hash === '#favactors' && !$('#view-favactors').classList.contains('hidden'), 'お気に入りの出演者のページが出ない');
    assert($('#tabbar [data-tab="fav"]').classList.contains('on'), 'お気に入りの出演者でも、お気に入りのタブが選ばれたまま');
    tab('search'); await wait(500);
    assert(location.hash === '#search' && !$('#view-search').classList.contains('hidden'), '検索が出ない');
    tab('settings'); await wait(500);
    assert(!$('#view-settings').classList.contains('hidden'), '設定が出ない');
    assert($$('#settings-extra .section-title').length >= 3, '設定の項目が足りない');
    // 履歴を開いたままにしない（以降の一覧のテストは、すべての動画で走らせる）
    Object.assign(filters, { view: '', q: '', studio: '', actor: '', site: '' });
    saveFilters(); renderChips();
    await listPage();
    render();
    assert(!$('#view-list').classList.contains('hidden'), '一覧に戻らない');
  });

  await check('詳細を開き、再生ボタン・お気に入り・前後移動が動く', async () => {
    // お気に入りに入っていない動画で試す（入っている動画で外して入れ直すと、追加日時と並び順が変わってしまう）
    let opened = false;
    for (const card of $$('#grid .card').slice(0, 10)) {
      card.click();
      assert(await until(() => isSheetOpen()), 'シートが開かない');
      if ($('#sheet .fav-btn')?.getAttribute('aria-pressed') !== 'true') { opened = true; break; }
      await back();
    }
    assert(opened, 'お気に入りでない動画が見つからない');
    const title1 = $('#sheet h2').textContent;
    assert($('#sheet .detail-actions .play-main'), '再生ボタンがない');
    const fav = $('#sheet .fav-btn');
    fav.click(); await wait(300);
    assert(fav.getAttribute('aria-pressed') === 'true', 'お気に入りに入らない');
    fav.click(); await wait(300); // 元に戻す
    assert(fav.getAttribute('aria-pressed') !== 'true', 'お気に入りから外れない');
    const next = $('#sheet .detail-bar [data-step="1"]');
    assert(next, '次へボタンがない');
    next.click(); await wait(500);
    assert($('#sheet h2').textContent !== title1, '次の動画に移らない');
    $('#sheet .detail-bar [data-step="-1"]').click(); await wait(500);
    assert($('#sheet h2').textContent === title1, '前の動画に戻らない');
  });

  await check('関連動画から開いて ‹ 戻る で戻れる', async () => {
    const rel = $('#sheet [data-related]');
    if (!rel) return 'この動画には関連動画がない（省略）';
    const title1 = $('#sheet h2').textContent;
    rel.click(); await wait(500);
    assert($('#sheet [data-act="back"]'), '戻るボタンがない');
    $('#sheet [data-act="back"]').click(); await wait(500);
    assert($('#sheet h2').textContent === title1, '元の動画に戻らない');
  });

  await check('戻る操作で詳細シートが閉じる', async () => {
    await back();
    assert(await until(() => !isSheetOpen(), 2000), 'シートが閉じない');
  });

  await check('絞り込みシートで並び順を変えてリセットできる', async () => {
    $('#filter-btn').click(); await wait(400);
    assert($('#f-sort'), '絞り込みシートが開かない');
    $('#f-sort [data-v="old"]').click();
    $('#f-apply').click(); await wait(600);
    assert(filters.sort === 'old', '古い順にならない');
    $('#filter-btn').click(); await wait(400);
    $('#f-reset').click(); await wait(600);
    assert(filters.sort === 'new', 'リセットされない');
  });

  await check('スタジオ一覧から選べる', async () => {
    const more = $('#chips [data-chip="more"]');
    if (!more) return 'スタジオが少ない（省略）';
    more.click(); await wait(400);
    const row = $('.picker-row[data-key]:not([data-key=""])');
    assert(row, '一覧が出ない');
    row.click(); await wait(500);
    assert(filters.studio, '選べない');
    filters.studio = ''; saveFilters(); renderChips(); render();
  });

  await check('スタジオの親子: 一覧で親の下に子が出て、親を選ぶと子の動画も数えられ、子を選ぶと子だけになる', async () => {
    const parent = state.studios.find((s) => s.children.length && s.total > s.count);
    if (!parent) return '子のあるスタジオがない（省略。?dev は各サイト 1 ページ目だけなので、収集済みのデータで試す）';
    const childKey = parent.children.find((k) => { const c = state.studios.find((s) => s.key === k); return c && c.count > 0; });
    assert(childKey, '子に本数がない');
    const child = state.studios.find((s) => s.key === childKey);
    // 一覧: 親の行に開閉の印があり、開くと子の行が出る
    $('#filter-btn').click(); await wait(400);
    const sel = $('#f-studio');
    assert(sel && [...sel.options].some((o) => o.value === childKey && o.textContent.includes('└')), '絞り込みの選択肢に子が入れ子で出ない');
    $('#f-reset').click(); await wait(500);
    filters.studio = ''; saveFilters(); renderChips(); render();
    const more = $('#chips [data-chip="more"]');
    if (more) {
      more.click(); await wait(400);
      const tog = $(`.picker-toggle[data-toggle="${parent.key}"]`);
      if (tog) {
        tog.click(); await wait(200);
        assert($(`.picker-row[data-key="${childKey}"]`), '親を開いても子が出ない');
      }
      history.back(); await wait(500);
    }
    // 絞り込み: 親は子を含む本数、子は子だけ
    const meta = () => ($('#meta').textContent || '').replace(/,/g, '');
    filters.studio = parent.key; saveFilters(); renderChips(); render(); await wait(400);
    assert(meta().includes(String(parent.total)), `親の件数が合わない（${meta()} / ${parent.total}）`);
    filters.studio = childKey; saveFilters(); renderChips(); render(); await wait(400);
    assert(meta().includes(String(child.total)), `子の件数が合わない（${meta()} / ${child.total}）`);
    filters.studio = ''; saveFilters(); renderChips(); render();
  });

  await check('再生中に閉じるとミニプレイヤーになり、タップで戻る・× で終わる', async () => {
    const cards = $$('#grid .card');
    assert(cards.length >= 2, 'カードが足りない');
    cards[0].click();
    assert(await until(() => isSheetOpen()), 'シートが開かない');
    const title1 = $('#sheet h2').textContent;
    // 実際のプレイヤーの代わりに中身のない iframe を置く（外部の再生ページは開かない）
    const hero = $('#sheet .hero');
    const f = document.createElement('iframe');
    f.srcdoc = '<body style="background:#000"></body>';
    hero.replaceChildren(f);
    hero.classList.add('player-on');
    await back();
    assert(await until(() => miniPlayer() && !isSheetOpen(), 2000), 'ミニプレイヤーにならない');
    assert(miniPlayer().querySelector('.hero iframe') === f, 'プレイヤーが作り直された');
    // 縮むアニメーションを終わらせてから測る（画面が裏にあるとアニメーションが進まないため）
    for (const a of miniPlayer().getAnimations()) a.finish();
    const r = miniPlayer().getBoundingClientRect(), dock = $('#dock').getBoundingClientRect();
    assert(r.bottom <= dock.top + 1 && r.height < 100, `位置・大きさがおかしい（bottom ${r.bottom} / タブバー ${dock.top}）`);
    // 別の動画の詳細を開いて閉じても、ミニプレイヤーは残る
    cards[1].click();
    assert(await until(() => isSheetOpen()), '別の動画のシートが開かない');
    await back();
    assert(await until(() => !isSheetOpen(), 2000) && miniPlayer(), '別の動画を閉じたらミニプレイヤーが消えた');
    miniPlayer().querySelector('.mini-info').click(); await wait(400);
    assert(isSheetOpen() && !miniPlayer(), '大きく表示されない');
    assert($('#sheet h2').textContent === title1 && $('#sheet .hero iframe') === f, '元の動画に戻らない');
    await back();
    assert(await until(() => miniPlayer(), 2000), '2 回目にミニプレイヤーにならない');
    miniPlayer().querySelector('.mini-close').click(); await wait(300);
    assert(!miniPlayer() && !$('#mini') && !document.body.classList.contains('has-mini'), '× で終わらない');
  });

  await check('出演者で絞り込み、条件チップで外せる', async () => {
    const vs = state.videos.slice(0, 3);
    setActor('テスト出演者', new Set(vs.map((v) => v.key)));
    await wait(300);
    assert($$('#grid .card').length === vs.length, `件数が合わない（${$$('#grid .card').length}）`);
    const cond = $('#meta .cond[data-clear="actor"]');
    assert(cond && cond.textContent.includes('テスト出演者'), '出演の条件チップがない');
    assert($('#tabbar [data-tab="search"]').classList.contains('on'), '検索のタブが選ばれていない（結果の一覧は、検索のタブの中）');
    cond.click(); await wait(300);
    assert(!filters.actor && $$('#grid .card').length > vs.length, '外れない');
    assert(!JSON.parse(localStorage.getItem('filters3') || '{}').actor, '出演者の絞り込みが保存されている');
  });

  await check('ホーム: 5 つの切り替え（新着・続き・おすすめ・スタジオ・出演者）が、タップで行き来でき、スタジオはカルーセル・お気に入りが上に来る', async () => {
    const parent = state.studios.find((s) => !s.parent && s.total > 0);
    const saved = localStorage.getItem('vfFavStudios');
    try {
      localStorage.removeItem('vfFavStudios');
      await goto('#home');
      const panelBtn = (p) => $(`#home-tabs [data-p="${p}"]`);
      for (const p of ['new', 'cont', 'rec', 'studios', 'actors']) assert(panelBtn(p), `${p} の切り替えがない`);
      panelBtn('rec').click(); await wait(500);
      assert($('#hp-rec .sf, #hp-rec .state'), 'おすすめが出ない');
      panelBtn('new').click(); await wait(500);
      assert(!$('#hp-new-wrap').classList.contains('hidden') && $$('#hp-new-grid .card').length > 0, '新着が出ない');
      panelBtn('studios').click(); await wait(700);
      assert(!$('#hp-studios-wrap').classList.contains('hidden'), 'スタジオのパネルが出ない');
      const first = $('#studio-feed .sf');
      assert(first, 'スタジオの行がない');
      assert(first.querySelectorAll('.sf-row .card').length > 0, 'カルーセルに動画がない');
      if (!parent) return 'スタジオが少ない（以降は省略）';
      // お気に入りにすると、開き直したとき一番上に来る（押した行は動かない）
      const secs = $$('#studio-feed .sf');
      const target = secs[Math.min(2, secs.length - 1)];
      const key = target.dataset.key;
      target.querySelector('[data-fav]').click(); await wait(400);
      assert(JSON.parse(localStorage.getItem('vfFavStudios') || '{}')[key], 'お気に入りが保存されない');
      assert(target.querySelector('.sf-star.on'), '☆ が ★ にならない');
      panelBtn('rec').click(); await wait(400);
      panelBtn('studios').click(); await wait(600);
      assert($('#studio-feed .sf').dataset.key === key, 'お気に入りにしたスタジオが、開き直したとき一番上に来ない');
      // おすすめにも、お気に入りのスタジオの行が出る
      panelBtn('rec').click(); await wait(500);
      assert($('#hp-rec').textContent.includes('の新作'), 'おすすめに、お気に入りのスタジオの新作が出ない');
      // 名前を押すと、そのスタジオの動画の一覧になる
      panelBtn('studios').click(); await wait(600);
      $('#studio-feed .sf [data-open]').click(); await wait(600);
      assert($('#view-home').classList.contains('hidden') && !$('#view-list').classList.contains('hidden'), '一覧に移らない');
      assert(filters.studio === key && filters.view === '', 'スタジオで絞り込まれていない');
      assert($('#list-nav') && !$('#list-nav').classList.contains('hidden'), '一覧の「戻る」が出ない');
      $('#list-back').click(); await wait(500);
      assert(location.hash === '#home', '戻るでホームに戻らない');
    } finally {
      if (saved == null) localStorage.removeItem('vfFavStudios'); else localStorage.setItem('vfFavStudios', saved);
      filters.studio = ''; saveFilters(); renderChips();
    }
  });

  await check('ホーム: 左右のスワイプで切り替えが行き来できる', async () => {
    await goto('#home');
    $('#home-tabs [data-p="new"]').click(); await wait(400);
    const root = $('#view-home');
    const touch = (type, x, y) => {
      const t = new Touch({ identifier: 1, target: root, clientX: x, clientY: y });
      root.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true }));
    };
    touch('touchstart', 300, 400); touch('touchend', 120, 405); await wait(500);
    assert(!$('#hp-cont-wrap').classList.contains('hidden'), '左へスワイプしても、次の「続き」にならない');
    touch('touchstart', 100, 400); touch('touchend', 280, 402); await wait(500);
    assert(!$('#hp-new-wrap').classList.contains('hidden'), '右へスワイプしても、前の「新着」に戻らない');
  });

  await check('ホーム: 新着のカードのハートで、開かずにお気に入りにでき、「続き」に出て、利用データに記録される', async () => {
    await goto('#home');
    $('#home-tabs [data-p="new"]').click(); await wait(500);
    const card = $('#hp-new-grid .card');
    assert(card && card.querySelector('[data-qfav]'), '新着のカードにハートがない');
    const key = card.dataset.key;
    const had = isFav(key);
    card.querySelector('[data-qfav]').click(); await wait(400);
    assert(isFav(key) !== had, 'ハートでお気に入りが変わらない');
    assert(!document.querySelector('.sheet.open'), 'ハートを押したのに詳細が開いた');
    assert($(`#hp-new-grid [data-qfav="${CSS.escape(key)}"]`).classList.contains('on') === !had, 'ハートの見た目が変わらない');
    $('#home-tabs [data-p="cont"]').click(); await wait(500);
    assert(had || [...document.querySelectorAll('#hp-cont .card')].some((c) => c.dataset.key === key), '「続き」にお気に入りが出ない');
    // もとに戻す
    $('#home-tabs [data-p="new"]').click(); await wait(400);
    if (isFav(key) !== had) $(`#hp-new-grid [data-qfav="${CSS.escape(key)}"]`).click();
    await wait(300);
    assert(isFav(key) === had, 'お気に入りを元に戻せない');
    const ua = await import('./analytics.js');
    const us = await import('./usage-core.js');
    ua.track('tap', { k: 'selftest', at: 'x' });
    const n = us.summarize([{ t: Date.now(), e: 'launch' }]).sessions;
    assert(n === 1, '利用データの集計ができない');
  });

  await check('検索タブ: 出演者の一覧から出演者のページを開き、♥ でお気に入りにできる', async () => {
    await goto('#search');
    $('#search-seg [data-seg="actors"]').click();
    assert(await until(() => allActors().length > 0 && $$('#search-pane-actors .actor-row').length > 0, 30000), '出演者の一覧が出ない');
    // 名前で絞る
    const first = getActor(+$('#search-pane-actors .actor-row').dataset.actor);
    const q = $('#search-q');
    q.value = first.display.slice(0, 2); q.dispatchEvent(new Event('input')); await wait(500);
    assert($$('#search-pane-actors .actor-row').length >= 1, '名前で絞れない');
    q.value = ''; q.dispatchEvent(new Event('input')); await wait(400);
    // ページを開く
    const saved = localStorage.getItem('vfFavActors');
    try {
      localStorage.removeItem('vfFavActors');
      const row = $('#search-pane-actors .actor-row');
      const id = +row.dataset.actor;
      row.click(); await wait(600);
      assert(location.hash === `#actor/${id}` && !$('#view-actor').classList.contains('hidden'), '出演者のページが開かない');
      assert($('#view-actor-body .ap-title h1').textContent === getActor(id).display, '名前が合わない');
      assert($('#tabbar [data-tab="search"]').classList.contains('on'), '検索のタブが選ばれたままでない');
      const heart = $('#view-actor-body [data-fav-actor]');
      heart.click(); await wait(300);
      assert(isFavActor(id), '♥ で、お気に入りにならない');
      assert(JSON.parse(localStorage.getItem('vfFavActors') || '{}')[id], '♥ が保存されない');
      $('#actor-back').click(); await wait(500);
      assert(location.hash === '#search', '戻るで検索に戻らない');
      assert($('#search-pane-actors .actor-row .heart-btn.on'), '一覧の ♥ に反映されない');
      tab('fav'); await wait(400);
      lib('actors'); await wait(700);
      assert($$('#favactors-list .actor-row').length === 1, 'お気に入りの出演者に出ない');
      toggleFavActor(id); await wait(200);
    } finally {
      if (saved == null) localStorage.removeItem('vfFavActors'); else localStorage.setItem('vfFavActors', saved);
    }
  });

  await check('検索タブ: スタジオ（階層の一覧）で選ぶと、そのスタジオの動画の一覧になる。動画（キーワード）は結果が出る', async () => {
    const target = state.studios.find((s) => !s.parent && s.total > 0);
    await goto('#search');
    // 動画（キーワード）
    $('#search-seg [data-seg="videos"]').click(); await wait(300);
    const v = state.videos.find((x) => x.code);
    const q = $('#search-q');
    q.value = v.code.replace(/-/g, '').toLowerCase(); q.dispatchEvent(new Event('input')); await wait(500);
    assert($$('#search-videos-grid .card').length >= 1, 'キーワードで動画が当たらない');
    q.value = ''; q.dispatchEvent(new Event('input')); await wait(300);
    if (!target) return 'スタジオがない（スタジオの確認は省略）';
    $('#search-seg [data-seg="studios"]').click(); await wait(500);
    const row = $(`#search-pane-studios .picker-row[data-key="${target.key}"]`);
    assert(row, 'スタジオの行がない');
    row.click(); await wait(600);
    assert(!$('#view-list').classList.contains('hidden') && filters.studio === target.key, 'そのスタジオの一覧にならない');
    assert($('#tabbar [data-tab="search"]').classList.contains('on'), '結果の一覧でも、検索のタブが選ばれたまま');
    $('#list-back').click(); await wait(500);
    assert(location.hash === '#search', '一覧から戻れない');
    filters.studio = ''; saveFilters(); renderChips();
  });

  await check('既定のサイトを登録済みとして覚えている（あとから既定に足したサイトを、一度だけ登録するため）', async () => {
    const seeded = await db.kvGet('seededDefaults', null);
    assert(Array.isArray(seeded), 'seededDefaults が記録されていない');
    for (const u of DEFAULT_SITES) assert(seeded.includes(u), `${u} が登録済みの記録にない`);
  });

  await check('想定外の例外が出ていない', () => {
    // Service Worker の登録失敗（確認用ブラウザの制約）は除く
    const real = errors.filter((m) => !/ServiceWorker|fetching the script/i.test(m));
    assert(!real.length, real.join(' / '));
  });

  // 試験で変えた絞り込みを元に戻す
  Object.assign(filters, savedFilters);
  $('#q').value = filters.q;
  saveFilters(); renderChips(); render();

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  window.__selftest = { done: true, passed, failed, results };
  const box = document.createElement('div');
  box.style.cssText = `position:fixed;top:calc(env(safe-area-inset-top) + 8px);right:8px;z-index:99;max-width:300px;padding:10px;border-radius:10px;font-size:11px;line-height:1.5;background:${failed ? '#5a1d24' : '#1d4a2c'};color:#fff;white-space:pre-wrap`;
  box.textContent = `selftest: ${passed} 件成功 / ${failed} 件失敗\n` + results.filter((r) => !r.ok).map((r) => `✗ ${r.name}: ${r.detail}`).join('\n');
  box.onclick = () => box.remove();
  document.body.appendChild(box);
  console.log('selftest', window.__selftest);
}
