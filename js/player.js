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
//
// 実際には対象サイトの提供元（morencius・voe 系）はどちらもサンドボックスを拒み、再生中にも数分おきに広告を仕込む。
// アプリ側では防ぎきれないので、
//   - 既知の拒否する提供元は最初からブロックなしで開く（判定待ちをなくす）
//   - 端末の広告ブロッカー（AdGuard DNS / コンテンツブロッカー）を設定画面で案内し、効いているかを確かめられるようにする
//   - 広告のタブから戻ってきたら「もう一度タップで再生」と知らせる

import * as db from './db.js';
import { toast } from './util.js';
import { safeUrl } from './matching.js';
import { registerSettingsSection } from './ui/settings.js';

const KV_KEY = 'playerAdblock';
// 広告ブロック（sandbox）を拒んだ提供元。次回からは最初からブロックなしで開く
const KV_REFUSED = 'playerSandboxRefused';
let refused = new Set();
// サンドボックスを必ず拒む既知の提供元（2026-11 時点で確認）。記録を消してもこれらは残す
const KNOWN_REFUSED = ['morencius.com', 'buzzmonetize.com', 'susanexpectcare.com'];
// 端末の広告ブロッカーが効いているか（設定画面の確認ボタンの結果）
const KV_BLOCKER = 'playerBlockerOk';
let blockerOk = false;
// 多くの広告ブロッカー（AdGuard・EasyList・AdGuard DNS）が止める広告スクリプト。読み込みに失敗すればブロッカーが効いている
const BLOCKER_PROBE = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';
const hostOf = (url) => { try { return new URL(url, location.href).hostname; } catch { return ''; } };

// allow-popups / allow-top-navigation は付けない（広告タブ・画面遷移の防止）
const SANDBOX = 'allow-scripts allow-same-origin allow-presentation allow-forms';
// ピクチャインピクチャ・全画面を許可する（iOS は全画面の標準プレーヤーから PiP に入れる）
const ALLOW = 'autoplay; fullscreen; encrypted-media; picture-in-picture';

let adblock = true; // 設定値（既定オン）

export async function init() {
  adblock = await db.kvGet(KV_KEY, true);
  refused = new Set([...KNOWN_REFUSED, ...(await db.kvGet(KV_REFUSED, []))]);
  blockerOk = await db.kvGet(KV_BLOCKER, false);
  registerSettingsSection({
    id: 'player',
    title: '再生',
    render(el) {
      el.innerHTML = `
        <div class="switch">
          <span>広告ブロック</span>
          <button class="toggle ${adblock ? 'on' : ''}" aria-label="広告ブロックのオン/オフ"></button>
        </div>
        <div class="note">再生時に広告のタブや広告ページが開くのを防ぎます。</div>
        <details class="more"><summary>詳しく</summary><p class="note">埋め込みプレイヤーをサンドボックスで開き、新しいタブとページ移動を禁止します。ただし今の主な提供元（morencius・voe 系）はどちらもこれを拒むため、ブロックなしで開きます。広告を止めたいときは、下の「端末の広告ブロッカー」を使ってください。</p></details>
        <div class="note refused-list"></div>
        <div class="blocker">
          <div class="switch"><span>端末の広告ブロッカー<span class="note" data-role="blocker-state" style="display:block"></span></span>
            <button class="btn" data-act="check">効いているか確認</button></div>
          <details class="more"><summary>入れ方</summary>
            <p class="note"><b>おすすめ: AdGuard DNS（端末全体に効く）</b><br>Safari で adguard-dns.io を開き、iOS 用の手順どおりに構成プロファイルをダウンロード →「設定」>「一般」>「VPN、DNS、およびデバイス管理」でインストール。ホーム画面のアプリの中の動画プレイヤーにも効きます（VPN を使っている間は無効）。</p>
            <p class="note"><b>または: AdGuard アプリ（コンテンツブロッカー）</b><br>App Store で AdGuard を入れ、「設定」>「アプリ」>「Safari」>「機能拡張」で AdGuard の項目をすべてオン。ホーム画面のアプリの中でも効くことが多いですが、iOS のバージョンによります。</p>
            <p class="note">入れたら上の「効いているか確認」を押してください。効いていれば、再生中の表示が「端末の広告ブロッカーで保護中」になります。</p>
          </details>
        </div>`;
      const list = el.querySelector('.refused-list');
      const paintRefused = () => {
        list.innerHTML = refused.size
          ? `広告ブロック非対応として記録した提供元: ${[...refused].map((h) => `<code>${h}</code>`).join(' ')} <button class="link" data-act="reset">記録を消す</button>`
          : '';
        const r = list.querySelector('[data-act="reset"]');
        if (r) r.onclick = async () => { refused = new Set(KNOWN_REFUSED); await db.kvSet(KV_REFUSED, []); paintRefused(); toast('記録を消しました（既知の提供元は残ります）'); };
      };
      paintRefused();
      const state = el.querySelector('[data-role="blocker-state"]');
      const paintBlocker = () => { state.textContent = blockerOk ? '効いています（再生中の広告を止められます）' : '未確認 / 効いていません'; };
      paintBlocker();
      el.querySelector('[data-act="check"]').onclick = async () => {
        blockerOk = await checkBlocker();
        await db.kvSet(KV_BLOCKER, blockerOk);
        paintBlocker();
        toast(blockerOk ? '広告ブロッカーが効いています' : '広告ブロッカーは効いていないようです');
      };
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

// 広告スクリプトを取りに行き、失敗すれば（端末のブロッカーに止められれば）true。押したときだけ確かめる
async function checkBlocker() {
  try {
    await fetch(BLOCKER_PROBE, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(8000) });
    return false;
  } catch {
    return navigator.onLine;
  }
}

// 広告のタブから戻ってきたことを見分ける: プレイヤー（iframe）を触った直後にアプリが隠れ、また表示されたら広告のタブだったとみなす
let returnWatch = null;
function watchAdReturn(frame, bar) {
  if (returnWatch) returnWatch.abort();
  const ac = (returnWatch = new AbortController());
  let touchedAt = 0, away = false, count = 0;
  addEventListener('blur', () => { if (document.activeElement === frame) touchedAt = Date.now(); }, { signal: ac.signal });
  document.addEventListener('visibilitychange', () => {
    if (!frame.isConnected) return ac.abort();
    if (document.visibilityState === 'hidden' && Date.now() - touchedAt < 3000) away = true;
    if (document.visibilityState === 'visible' && away) {
      away = false;
      count += 1;
      toast('広告から戻りました。もう一度タップで再生できます');
      const c = bar.querySelector('[data-role="ads"]');
      if (c) c.textContent = `広告 ${count} 回`;
    }
  }, { signal: ac.signal });
}

export function mountPlayer(container, url) {
  render(container, url, adblock && !refused.has(hostOf(url)));
}

function render(container, url, blocked) {
  url = safeUrl(url, 'https://example.invalid/'); // http(s) 以外（javascript: など）は再生しない。「//host/...」形式も受ける
  if (!url) return toast('このプレイヤーは開けません');

  const frame = document.createElement('iframe');
  if (blocked) frame.setAttribute('sandbox', SANDBOX);
  frame.setAttribute('allow', ALLOW);
  frame.setAttribute('allowfullscreen', '');
  frame.setAttribute('webkitallowfullscreen', ''); // 古い WebKit 向け
  frame.setAttribute('allowpictureinpicture', '');
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
  bar.classList.toggle('open', !blocked && !blockerOk);
  bar.classList.toggle('guarded', !blocked && blockerOk);
  bar.innerHTML = `
    <span class="player-state"><span class="player-dot"></span>${blocked ? '再生中・広告ブロック中'
      : blockerOk ? '端末の広告ブロッカーで保護中'
      : '最初のタップで広告が開くことがあります。開いたら閉じて戻り、もう一度タップ'}<span class="player-ads" data-role="ads"></span></span>
    <button class="btn player-switch">${blocked ? '広告ブロックなしで再生' : '広告ブロックありに戻す'}</button>`;
  const sw = bar.querySelector('.player-switch');
  sw.onclick = () => {
    if (blocked) toast('広告のタブが開いたら閉じて戻ってください');
    render(container, url, !blocked);
  };

  // 2 回目の読み込み = プレイヤーが別ページへ移った。morencius / voe 系はサンドボックスを検知すると
  // 「sandboxed」の案内ページへ移るので、その場合は再生できないことを枠の下に出す
  // （iframe の中身は別オリジンで読めないため、読み込み回数で判断する。JS で一度リダイレクトするだけの
  //  プレイヤーを誤判定しないよう、最初の読み込みから 4 秒以内の 2 回目だけを拒否とみなす）
  if (!blocked) watchAdReturn(frame, bar);
  let loads = 0, firstAt = 0;
  // 拒まれたら提供元を記録し、そのままブロックなしで開き直す
  frame.addEventListener('load', async () => {
    loads += 1;
    if (loads === 1) firstAt = Date.now();
    if (!blocked || loads !== 2 || Date.now() - firstAt > 4000 || !frame.isConnected) return;
    const host = hostOf(url);
    refused.add(host);
    await db.kvSet(KV_REFUSED, [...refused]);
    toast('広告ブロック非対応のため、ブロックなしで開きました');
    render(container, url, false);
  });
}
