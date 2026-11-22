// 画面の自動テスト（スモークテスト）
//
// URL に ?selftest を付けて開くと、起動後に主な操作を実際の画面で順に試し、結果を画面右上と
// window.__selftest（{ done, passed, failed, results: [{ name, ok, detail }] }）に出す。
// ?dev と一緒に使う（例: http://localhost:8790/?dev&selftest）。試験で変えた状態（絞り込み・お気に入り）は最後に元に戻す。

import { $, $$ } from './util.js';
import { state, DEFAULT_SITES } from './data.js';
import { allActors, getActor, isFavActor, toggleFavActor } from './actors.js';
import * as db from './db.js';
import { filters } from './ui/home.js';
import { recentKeys } from './history.js';
import { isFav, toggleFav } from './favorites.js';
import { isSheetOpen, miniPlayer } from './ui/sheet.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await wait(100); }
  return false;
}
const tab = async (t) => { $(`#tabbar [data-tab="${t}"]`).click(); await wait(400); };
const visible = (sel) => !!$(sel).offsetParent;
const typeInto = async (sel, q) => {
  const input = $(sel);
  input.value = q;
  input.dispatchEvent(new Event('input'));
  await wait(500);
};
const cards = (sel) => $$(`${sel} .card:not(.skel)`).length;

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
  // 以降のテストは、すべての動画で始める（前回の保存状態の「新着」「お気に入り」ではなく）
  await tab('home');
  $('#home-chips [data-view="all"]').click();
  await until(() => cards('#home-grid') > 0, 10000);

  await check('5 つのタブが並んでいる', () => {
    const tabs = $$('#tabbar [data-tab]').map((b) => b.dataset.tab).join(',');
    assert(tabs === 'home,actors,history,favs,settings', `タブ: ${tabs}`);
  });

  await check('ホーム: 動画の一覧が出る', () => {
    const n = cards('#home-grid');
    assert(n > 0, 'カードがない');
    return `${state.videos.length} 本 / カード ${n} 枚`;
  });

  await check('ホーム: チップ（新着・すべて・お気に入り）で切り替えられる', async () => {
    $('#home-chips [data-view="new"]').click();
    await wait(300);
    assert($('#home-chips [data-view="new"]').classList.contains('on'), '新着が選ばれない');
    $('#home-chips [data-view="fav"]').click();
    await wait(300);
    assert($('#home-chips [data-view="fav"]').classList.contains('on'), 'お気に入りが選ばれない');
    $('#home-chips [data-view="all"]').click();
    await wait(300);
    assert(cards('#home-grid') > 0, 'すべてで 0 件');
  });

  await check('ホーム: 検索で絞り込める（品番のハイフンなしでも当たる）', async () => {
    const v = state.videos.find((x) => x.code);
    assert(v, '品番のある動画がない');
    await typeInto('#q', v.code.replace(/-/g, '').toLowerCase());
    assert(cards('#home-grid') >= 1, `「${v.code}」で 0 件`);
    assert($('#home-meta').textContent.includes('件'), '件数が出ない');
    $('#q-clear').click();
    await wait(400);
  });

  await check('ホーム: スタジオのチップで絞り込める', async () => {
    const chip = $('#home-chips [data-studio]');
    assert(chip, 'スタジオのチップがない');
    chip.click();
    await wait(300);
    assert($('#home-meta .cond[data-clear="studio"]'), '条件が出ない');
    $('#home-meta .cond[data-clear="studio"]').click();
    await wait(300);
  });

  await check('ホーム: カードのハートでお気に入りを付け外しできる', async () => {
    const q = $('#home-grid .qfav');
    assert(q, 'ハートがない');
    const key = q.dataset.qfav;
    const before = isFav(key);
    q.click();
    await until(() => isFav(key) !== before, 3000);
    assert(isFav(key) !== before, 'お気に入りが変わらない');
    assert($(`.qfav[data-qfav="${CSS.escape(key)}"]`).classList.contains('on') === isFav(key), 'ハートの見た目が合わない');
    if (isFav(key) !== before) await toggleFav(state.byKey.get(key)); // 元に戻す
  });

  await check('ホーム: カードを押すと詳細が開き、閉じられる', async () => {
    $('#home-grid .card').click();
    await until(() => isSheetOpen(), 3000);
    assert(isSheetOpen(), '詳細が開かない');
    assert($('#sheet .play-main'), '再生ボタンがない');
    history.back();
    await until(() => !isSheetOpen(), 3000);
    assert(!isSheetOpen() || miniPlayer(), '詳細が閉じない');
  });

  await check('出演者: 2 列の正方形グリッドで並ぶ', async () => {
    await tab('actors');
    assert(visible('#view-actors'), '出演者のページが出ない');
    await until(() => allActors().length > 0 && $$('#actors-list .ag-card').length > 0, 20000);
    const cs = $$('#actors-list .ag-card');
    assert(cs.length > 0, 'カードがない');
    const cols = getComputedStyle($('#actors-list .actor-grid')).gridTemplateColumns.split(' ').length;
    if (innerWidth < 640) assert(cols === 2, `スマホ幅で列が ${cols}`); // 広い画面では列が増える
    const r = $('#actors-list .ag-photo').getBoundingClientRect();
    assert(Math.abs(r.width - r.height) < 2, `正方形でない: ${r.width}x${r.height}`);
    return `${allActors().length} 人 / 表示 ${cs.length}`;
  });

  await check('出演者: 検索で名前を絞り込める', async () => {
    const a = allActors().find((x) => x.count > 0 && x.display.length >= 2);
    await typeInto('#aq', a.display);
    assert($$('#actors-list .ag-card').length >= 1, `「${a.display}」で 0 件`);
    $('#aq-clear').click();
    await wait(400);
  });

  await check('出演者: 「名前あり」・体型タグのチップで絞り込める', async () => {
    await until(() => $('#actors-chips [data-mode="named"]'), 3000);
    const before = $$('#actors-list .ag-card').length;
    $('#actors-chips [data-mode="named"]').click();
    await wait(400);
    assert($('#actors-chips [data-mode="named"]').classList.contains('on'), '名前ありが選ばれない');
    assert($$('#actors-list .ag-card').length <= before, '絞り込みで増えた');
    $('#actors-chips [data-reset]').click();
    await wait(300);
    // 体型のチップ（otokoki から取る。取れなければ飛ばす）
    if (await until(() => $('#actors-chips [data-tag]'), 8000)) {
      const total = allActors().length;
      $('#actors-chips [data-tag]').click();
      assert(await until(() => !$('#actors-meta').textContent.includes('調べています'), 60000), 'タグの絞り込みが終わらない');
      const n = +$('#actors-meta span').textContent.replace(/[^\d]/g, '');
      assert(n > 0 && n < total, `タグで ${n} 人（全 ${total} 人）`);
      $('#actors-chips [data-reset]').click();
      await wait(300);
    }
  });

  await check('出演者: ♥ でお気に入りに付け外しでき、詳細ページを開ける', async () => {
    await until(() => $('#actors-list .ag-card'), 3000);
    const card = $('#actors-list .ag-card');
    const id = +card.dataset.actor;
    const before = isFavActor(id);
    card.querySelector('[data-fav-actor]').click();
    assert(isFavActor(id) !== before, '♥ で変わらない');
    toggleFavActor(id); // 元に戻す
    card.click();
    await wait(500);
    assert(visible('#view-actor'), '詳細ページが開かない');
    assert($('#view-actor-body h1').textContent === getActor(id).display, '名前が違う');
    $('#actor-back').click();
    await wait(400);
    assert(visible('#view-actors'), '戻れない');
  });

  await check('履歴: 見た動画が日付ごとに並び、検索で絞れる', async () => {
    await tab('history');
    assert(visible('#view-history'), '履歴のページが出ない');
    const n = recentKeys().filter((k) => state.byKey.has(k)).length;
    if (!n) { assert($('#history-state').textContent.includes('再生した動画'), '空の案内が出ない'); return '履歴なし'; }
    assert(cards('#history-grid') > 0, 'カードがない');
    assert($('#history-grid .day-sep'), '日付の区切りがない');
    const v = state.byKey.get(recentKeys().find((k) => state.byKey.has(k)));
    await typeInto('#hq', v.title.slice(0, 4));
    assert(cards('#history-grid') >= 1, '検索で 0 件');
    $('#hq-clear').click();
    await wait(300);
    return `${n} 本`;
  });

  await check('お気に入り: 動画と出演者を切り替えられ、検索できる', async () => {
    await tab('favs');
    assert(visible('#view-favs'), 'お気に入りのページが出ない');
    assert(!$('#favs-seg button[data-seg="studios"]'), 'スタジオの切り替えが残っている');
    $('#favs-seg [data-seg="actors"]').click();
    await wait(300);
    assert(visible('#favs-actors'), '出演者が出ない');
    await typeInto('#fq', 'あ');
    $('#fq-clear').click();
    $('#favs-seg [data-seg="videos"]').click();
    await wait(300);
    assert(visible('#favs-videos'), '動画が出ない');
  });

  await check('設定: 開ける（収集対象・収集・データ）', async () => {
    await tab('settings');
    assert(visible('#view-settings'), '設定のページが出ない');
    assert($('#sites .site'), '収集対象サイトがない');
    assert($('[data-section="usage"]'), '利用データの項目がない');
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
  await tab('home');

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
