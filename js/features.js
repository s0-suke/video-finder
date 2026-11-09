// 要件の外で足した機能のオン/オフ（設定画面の「機能のオン/オフ」から切り替える）
//
// 一覧の描画中に同期で何度も読むので、IndexedDB ではなく localStorage に保存する。
// 変わったら data.js の emit('features') で知らせる（一覧・タブバーが描き直す）。

import { esc } from './util.js';
import { emit } from './data.js';
import { registerSettingsSection } from './ui/settings.js';

const DEFS = [
  { id: 'newBadge', label: '新着', note: 'NEW の印と新着タブ' },
  { id: 'history', label: '視聴履歴', note: '履歴タブと「視聴済み」の印。オフにすると記録もしない' },
  { id: 'related', label: '同じスタジオの動画', note: '詳細の下に横並びで表示' },
  { id: 'swipeNav', label: '前後の動画へ移動', note: '詳細を左右にスワイプ / ‹ 前へ・次へ ›' },
  { id: 'longPressFav', label: '長押しでお気に入り', note: '一覧のカードを長押し' },
  { id: 'pullRefresh', label: '引っ張って更新', note: '一覧の一番上で下に引っ張ると新着を確認' },
  { id: 'recentSearch', label: '最近の検索', note: '検索欄をタップしたときに候補を出す' },
  { id: 'installTip', label: 'ホーム画面への追加の案内', note: 'Safari で開いているときだけ表示' },
  { id: 'backfillBanner', label: '初回取得の進み具合', note: '一覧の上に % を表示' },
];

const KEY = 'features';
let values = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } })();

// 既定はすべてオン
export const feature = (id) => values[id] !== false;

export function setFeature(id, on) {
  values = { ...values, [id]: !!on };
  try { localStorage.setItem(KEY, JSON.stringify(values)); } catch {}
  emit('features', id);
}

export function init() {
  registerSettingsSection({
    id: 'features',
    title: '機能のオン/オフ',
    render(el) {
      el.innerHTML = DEFS.map((d) => `
        <div class="switch feature-row">
          <span>${esc(d.label)}<span class="note">${esc(d.note)}</span></span>
          <button class="toggle ${feature(d.id) ? 'on' : ''}" data-feature="${d.id}" aria-label="${esc(d.label)}のオン/オフ"></button>
        </div>`).join('');
      el.onclick = (e) => {
        const b = e.target.closest('[data-feature]');
        if (!b) return;
        const on = !feature(b.dataset.feature);
        setFeature(b.dataset.feature, on);
        b.classList.toggle('on', on);
      };
    },
  });
}
