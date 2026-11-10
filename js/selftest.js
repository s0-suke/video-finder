// 画面の自動テスト（スモークテスト）
//
// URL に ?selftest を付けて開くと、起動後に主な操作を実際の画面で順に試し、結果を画面右上と
// window.__selftest（{ done, passed, failed, results: [{ name, ok, detail }] }）に出す。
// ?dev と一緒に使う（例: http://localhost:8790/?dev&selftest）。試験で変えた状態（絞り込み・お気に入り）は最後に元に戻す。

import { $, $$ } from './util.js';
import { state } from './data.js';
import { filters, saveFilters, render, renderChips } from './ui/list.js';
import { isSheetOpen } from './ui/sheet.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await wait(100); }
  return false;
}
const tab = (t) => $(`#tabbar [data-tab="${t}"]`).click();
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
    tab('history'); await wait(300);
    assert(filters.view === 'history', '履歴タブ');
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
  box.style.cssText = `position:fixed;top:8px;right:8px;z-index:99;max-width:300px;padding:10px;border-radius:10px;font-size:11px;line-height:1.5;background:${failed ? '#5a1d24' : '#1d4a2c'};color:#fff;white-space:pre-wrap`;
  box.textContent = `selftest: ${passed} 件成功 / ${failed} 件失敗\n` + results.filter((r) => !r.ok).map((r) => `✗ ${r.name}: ${r.detail}`).join('\n');
  box.onclick = () => box.remove();
  document.body.appendChild(box);
  console.log('selftest', window.__selftest);
}
