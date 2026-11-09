// 再生プレイヤー（広告ブロック付き）
//
// 公開する関数（detail.js / main.js から使う。名前と引数は変えないこと）
//   init()                         起動時に 1 回呼ばれる（設定画面への項目追加など）
//   mountPlayer(container, url)    container（16:9 の枠）の中身を、url のプレイヤーに置き換える
//
// 広告ブロックの仕組み
//   埋め込みプレイヤー（morencius.com / buzzmonetize.com など）は、画面全体に透明な div を重ねて
//   最初のタップで window.open() の広告タブを開き、ほかに popunder スクリプトも仕込んでいる。
//   iframe に sandbox を付け、allow-popups と allow-top-navigation を外すことで、
//   新しいタブを開くことと、アプリ画面ごと広告ページへ飛ばされることを封じる。
//   （透明な div はタップ後に自分で消えるので、2 回目のタップからプレイヤーを操作できる）
//   サンドボックスを検知して再生を拒むプレイヤーもあるため、枠の下に「広告ブロックなしで再生」を置く。
//   （検知は document.domain への代入が sandbox 下で必ず例外になることを使っており、属性の組み合わせでは回避できない）

import * as db from './db.js';
import { toast } from './util.js';
import { registerSettingsSection } from './ui/settings.js';

const KV_KEY = 'playerAdblock';
// 広告ブロック（sandbox）を拒んだ提供元。次回からは最初からブロックなしで開く
const KV_REFUSED = 'playerSandboxRefused';
let refused = new Set();
const hostOf = (url) => { try { return new URL(url, location.href).hostname; } catch { return ''; } };

// allow-popups / allow-top-navigation は付けない（広告タブ・画面遷移の防止）
const SANDBOX = 'allow-scripts allow-same-origin allow-presentation allow-forms';
const ALLOW = 'autoplay; fullscreen; encrypted-media; picture-in-picture';

let adblock = true; // 設定値（既定オン）

export async function init() {
  adblock = await db.kvGet(KV_KEY, true);
  refused = new Set(await db.kvGet(KV_REFUSED, []));
  registerSettingsSection({
    id: 'player',
    title: '再生',
    render(el) {
      el.innerHTML = `
        <div class="switch">
          <span>広告ブロック</span>
          <button class="toggle ${adblock ? 'on' : ''}" aria-label="広告ブロックのオン/オフ"></button>
        </div>
        <div class="note">埋め込みプレイヤーが広告タブを開いたり、広告ページへ移動したりするのを防ぎます。広告ブロックを拒む提供元は自動で見分けて、次回からはブロックなしで開きます（そのときは広告タブが開くことがあるので、閉じて戻ってください）。</div>
        <div class="note refused-list"></div>`;
      const list = el.querySelector('.refused-list');
      const paintRefused = () => {
        list.innerHTML = refused.size
          ? `広告ブロック非対応として記録した提供元: ${[...refused].map((h) => `<code>${h}</code>`).join(' ')} <button class="link" data-act="reset">記録を消す</button>`
          : '';
        const r = list.querySelector('[data-act="reset"]');
        if (r) r.onclick = async () => { refused.clear(); await db.kvSet(KV_REFUSED, []); paintRefused(); toast('記録を消しました'); };
      };
      paintRefused();
      const btn = el.querySelector('.toggle');
      btn.onclick = async () => {
        adblock = !adblock;
        btn.classList.toggle('on', adblock);
        await db.kvSet(KV_KEY, adblock);
        toast(adblock ? '広告ブロックをオンにしました' : '広告ブロックをオフにしました');
      };
    },
  });
}

export function mountPlayer(container, url) {
  render(container, url, adblock && !refused.has(hostOf(url)));
}

function render(container, url, blocked) {
  if (!/^https?:\/\//i.test(url)) url = new URL(url, location.href).href; // 「//host/...」形式も受ける

  const frame = document.createElement('iframe');
  if (blocked) frame.setAttribute('sandbox', SANDBOX);
  frame.setAttribute('allow', ALLOW);
  frame.setAttribute('allowfullscreen', '');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.src = url;

  container.replaceChildren(frame);
  container.classList.add('player-on');
  container.classList.toggle('player-open', !blocked);

  // 枠（overflow: hidden）の直後に状態表示とボタンを置く。再生し直すたびに作り直す
  let bar = container.nextElementSibling;
  if (!bar || !bar.classList.contains('player-bar')) {
    bar = document.createElement('div');
    bar.className = 'player-bar';
    container.after(bar);
  }
  bar.classList.toggle('open', !blocked);
  bar.innerHTML = `
    <span class="player-state"><span class="player-dot"></span>${blocked ? '再生中・広告ブロック中' : refused.has(hostOf(url)) ? '広告ブロック非対応の提供元・広告タブに注意' : '再生中・広告ブロックなし'}</span>
    <button class="btn player-switch">${blocked ? '広告ブロックなしで再生' : '広告ブロックありに戻す'}</button>`;
  const sw = bar.querySelector('.player-switch');
  sw.onclick = () => {
    if (blocked) toast('広告のタブが開いたら閉じて戻ってください');
    render(container, url, !blocked);
  };

  // 2 回目の読み込み = プレイヤーが別ページへ移った。morencius / voe 系はサンドボックスを検知すると
  // 「sandboxed」の案内ページへ移るので、その場合は再生できないことを枠の下に出す
  // （iframe の中身は別オリジンで読めないため、読み込み回数で判断する）
  let loads = 0;
  // 拒まれたら提供元を記録し、そのままブロックなしで開き直す
  frame.addEventListener('load', async () => {
    loads += 1;
    if (!blocked || loads !== 2 || !frame.isConnected) return;
    const host = hostOf(url);
    refused.add(host);
    await db.kvSet(KV_REFUSED, [...refused]);
    toast('この提供元は広告ブロックに対応していないため、ブロックなしで開きました。広告のタブが開いたら閉じて戻ってください');
    render(container, url, false);
  });
}
