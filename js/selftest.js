// 画面の自動テスト（スモークテスト）
//
// URL に ?selftest を付けて開くと、起動後に主な操作を実際の画面で順に試し、結果を画面右上と
// window.__selftest（{ done, passed, failed, results: [{ name, ok, detail }] }）に出す。
// ?dev と一緒に使う（例: http://localhost:8790/?dev&selftest）。試験で変えた状態（絞り込み・お気に入り）は最後に元に戻す。

import { $, $$ } from './util.js';
import { state, DEFAULT_SITES } from './data.js';
import * as db from './db.js';
import { filters, saveFilters, render, renderChips, setActor } from './ui/list.js';
import { recentKeys } from './history.js';
import { isSheetOpen, miniPlayer } from './ui/sheet.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await wait(100); }
  return false;
}
const tab = (t) => $(`#tabbar [data-tab="${t}"]`).click();
const lib = (v) => $(`#lib-seg [data-view="${v}"]`).click(); // お気に入り｜履歴 の切り替え
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

  await until(() => state.videos.length > 0 && $$('#grid .card:not(.skel)').length > 0, 20000);

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
    const chip = $('#chips [data-chip="studio"]');
    assert(chip, 'スタジオのチップがない');
    chip.click();
    await wait(300);
    assert(filters.studio, 'スタジオが選ばれない');
    $('#chips [data-chip="all"]').click();
    await wait(300);
    assert(!filters.studio, 'すべてで戻らない');
  });

  await check('タブの切り替え（お気に入り・履歴・設定・ホーム）', async () => {
    tab('fav'); await wait(300);
    assert(filters.view === 'fav', 'お気に入りタブ');
    assert(!$('#lib-seg').classList.contains('hidden'), 'お気に入りの切り替え（お気に入り｜履歴）が出ない');
    lib('history'); await wait(300);
    assert(filters.view === 'history', '履歴の切り替え');
    assert($('#tabbar [data-tab="fav"]').classList.contains('on'), '履歴のときも、お気に入りのタブが選ばれたまま');
    tab('settings'); await wait(500);
    assert(!$('#view-settings').classList.contains('hidden'), '設定が出ない');
    assert($$('#settings-extra .section-title').length >= 3, '設定の項目が足りない');
    tab(''); await wait(500);
    assert(!$('#view-list').classList.contains('hidden') && filters.view === '', 'ホームに戻らない');
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
    assert($('#tabbar [data-tab=""]').classList.contains('on'), 'ホームのタブが選ばれていない');
    cond.click(); await wait(300);
    assert(!filters.actor && $$('#grid .card').length > vs.length, '外れない');
    assert(!JSON.parse(localStorage.getItem('filters3') || '{}').actor, '出演者の絞り込みが保存されている');
  });

  await check('スタジオのタブ: スタジオごとの最新動画のカルーセル。お気に入りが上に来て、名前を押すとそのスタジオのホームになる', async () => {
    const parent = state.studios.find((s) => !s.parent && s.children.length && s.total > 0);
    if (!parent) return '子のあるスタジオがない（省略）';
    const saved = localStorage.getItem('vfFavStudios');
    try {
      localStorage.removeItem('vfFavStudios');
      tab('studios'); await wait(600);
      assert(!$('#view-studios').classList.contains('hidden') && $('#view-list').classList.contains('hidden'), 'スタジオのページが出ない');
      assert($('#tabbar [data-tab="studios"]').classList.contains('on'), 'スタジオのタブが選ばれていない');
      const first = $('#studio-feed .sf');
      assert(first, 'スタジオの行がない');
      assert(first.querySelectorAll('.sf-row .card').length > 0, 'カルーセルに動画がない');
      // お気に入りにすると、一番上に来る
      const secs = $$('#studio-feed .sf');
      const target = secs[Math.min(2, secs.length - 1)];
      const key = target.dataset.key;
      target.querySelector('[data-fav]').click(); await wait(400);
      assert(JSON.parse(localStorage.getItem('vfFavStudios') || '{}')[key], 'お気に入りが保存されない');
      assert(target.querySelector('.sf-star.on'), '☆ が ★ にならない');
      // 並べ替えは次に開いたときに反映される（押した行が画面から消えないように）
      tab(''); await wait(300); tab('studios'); await wait(600);
      assert($('#studio-feed .sf').dataset.key === key, 'お気に入りにしたスタジオが、開き直したとき一番上に来ない');
      // カードを押すと詳細が開く
      $('#studio-feed .sf .card').click();
      assert(await until(() => isSheetOpen()), 'カードを押しても詳細が開かない');
      await back();
      // 名前を押すと、そのスタジオのホームになる
      $('#studio-feed .sf [data-open]').click(); await wait(500);
      assert($('#view-studios').classList.contains('hidden') && !$('#view-list').classList.contains('hidden'), 'ホームの一覧に戻らない');
      assert(filters.studio === key && filters.view === '', 'スタジオで絞り込まれていない');
      assert($('#tabbar [data-tab=""]').classList.contains('on'), 'ホームのタブが選ばれていない');
    } finally {
      if (saved == null) localStorage.removeItem('vfFavStudios'); else localStorage.setItem('vfFavStudios', saved);
      filters.studio = ''; saveFilters(); renderChips(); render();
    }
  });

  await check('ホームに最近見た動画が出て、タップで詳細が開く', async () => {
    const keys = recentKeys().filter((k) => state.byKey.has(k));
    if (!keys.length) return '視聴履歴がない（省略）';
    tab(''); await wait(300);
    const row = $('#continue');
    assert(row && !row.classList.contains('hidden'), '行が出ない');
    assert(row.querySelectorAll('[data-i]').length === Math.min(keys.length, 12), '件数が合わない');
    row.querySelector('[data-i="0"]').click();
    assert(await until(() => isSheetOpen()), 'シートが開かない');
    assert($('#sheet').dataset.key === keys[0], '違う動画が開いた');
    await back();
    tab('fav'); await wait(300);
    assert(row.classList.contains('hidden'), 'お気に入りタブでも出ている');
    tab(''); await wait(300);
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
