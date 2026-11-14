// 出演者データベースの、DOM・通信に依存しない部分（純粋関数。tests/actors.test.js で確かめる）
//
// otokoki.net の「出演者」カテゴリの名前は、次のような形をしている:
//   「バキ＝藤村剛気＝哲郎」        … ＝ で別名をつなぐ（同じ人が、レーベルごとに違う名前で出る）
//   「ゴーグルマン/GAMES」          … / のあとは、レーベル・サイト
//   「172cm60kg20歳」「19才爽やか」   … 名前のない出演者の、身長・体重・年齢・特徴
//   「モデル044」「原田さん43歳」
// ここから、表示名・別名・レーベル・身長・体重・年齢・特徴を読み取る。

const clean = (s) => String(s || '').replace(/^[_＿◆■●]+/, '').trim();
const norm = (s) => String(s || '').normalize('NFKC');

/** 出演者カテゴリの名前を読み取る */
export function parseActorName(raw) {
  const full = clean(raw);
  const n = norm(full);
  // / のあと（半角・全角）は、レーベル・サイト。ただし日付や分数のような / は対象外（数字だけの場合）
  let body = n;
  let label = '';
  const slash = n.indexOf('/');
  if (slash > 0 && !/^\d+$/.test(n.slice(slash + 1).trim())) {
    body = n.slice(0, slash);
    label = n.slice(slash + 1).trim();
  }
  // / のあとにも ＝ で別名が続く形（「ゴーグルマン/GAMES＝かずし」）: 最初の語がレーベル、残りは別名
  if (label.includes('＝') || label.includes('=')) {
    const [lab, ...rest] = label.split(/[＝=]+/).map((x) => x.trim()).filter(Boolean);
    label = lab || '';
    body = [body, ...rest].join('＝');
  }
  const aliases = body.split(/[＝=]+/).map((s) => s.trim()).filter(Boolean);
  // 身長・体重・年齢は、名前全体から探す。「170×58×21」（単位なし・× でつなぐ）の形も読む
  const trio = n.match(/(\d{3})\s*(?:cm)?\s*[×x*]\s*(\d{2,3})\s*(?:kg)?\s*[×x*]\s*(\d{2})(?!\d)/i);
  const h = n.match(/(\d{3})\s*cm/i) || (trio && [null, trio[1]]);
  const w = n.match(/(\d{2,3})\s*kg/i) || (trio && [null, trio[2]]);
  const a = n.match(/(\d{2})\s*(?:歳|才)/) || (trio && [null, trio[3]]);
  const height = h && +h[1] >= 140 && +h[1] <= 210 ? +h[1] : null;
  const weight = w && +w[1] >= 40 && +w[1] <= 160 ? +w[1] : null;
  const age = a && +a[1] >= 18 && +a[1] <= 79 ? +a[1] : null;
  // 表示名: 身長・体重・年齢だけの別名や、「モデル044」のような番号は、実名の別名があればそちらを先頭に
  // 名前のない出演者の別名: 数値で始まる・「モデル 044」・年齢つき・番号だけ・文章（長くて、人名らしくないもの）
  const looksAnon = (s) => {
    const t = norm(s);
    return /^\d{3}\s*(?:cm|[×x*])|^推定|^モデル\s*\d+$|^[A-Z ]*model\b|\d{2}\s*(?:歳|才)|^\d+$/i.test(t) || t.length > 14;
  };
  const named = aliases.find((s) => !looksAnon(s));
  const display = named || aliases[0] || full;
  const anonymous = !named;
  // 特徴: 名前のない出演者の名前そのもの（「19才爽やか」「165cm63kg19歳大学生」）から、数値を除いた言葉
  let descriptor = '';
  if (anonymous) {
    descriptor = display
      .replace(/推定/g, ' ')
      .replace(/\d{3}\s*(?:cm)?\s*[×x*]\s*\d{2,3}\s*(?:kg)?\s*[×x*]\s*\d{2}\s*(?:歳|才)?/gi, ' ')
      .replace(/\d{3}\s*cm|\d{2,3}\s*kg|\d{2}\s*(?:歳|才)/gi, ' ')
      .replace(/[×*]/g, ' ')
      .replace(/^[のはがを\s]+/, '')
      .replace(/\s+/g, ' ').trim();
  } else {
    // 別名の中の特徴語（「＝20歳の太マラガッチリ男子」のような長い説明）
    const longer = aliases.find((s) => s !== named && /[ぁ-んァ-ヶ一-龥]{6,}/.test(s) && /歳|才|系|男子|学生|部員|マッチョ/.test(s));
    if (longer) descriptor = longer;
  }
  return { raw: full, display, aliases, label, height, weight, age, anonymous, descriptor };
}

/** 作品のタイトルに書かれた年齢（「18歳の…」「20才」）の最頻値。年齢の手がかりがなければ null */
export function ageFromTitles(titles) {
  const count = new Map();
  for (const t of titles || []) {
    for (const m of norm(t).matchAll(/(\d{2})\s*(?:歳|才)/g)) {
      const a = +m[1];
      if (a >= 18 && a <= 79) count.set(a, (count.get(a) || 0) + 1);
    }
  }
  let best = null, n = 0;
  for (const [a, c] of count) if (c > n || (c === n && best !== null && a < best)) { best = a; n = c; }
  // 1 回だけ書かれていても、その作品の出演者の年齢とは限らない（複数人の作品）ので、2 回以上のときだけ採る。作品が少ないときは 1 回でも採る
  return n >= 2 || (n === 1 && (titles || []).length <= 3) ? best : null;
}

/** タグの出現回数を数える（ids: 記事ごとのカテゴリ id の配列の配列、names: id → 名前）。多い順 [{ name, n }] */
export function countTags(postCategories, names) {
  const c = new Map();
  for (const cats of postCategories || []) {
    for (const id of cats || []) {
      const name = names.get(id);
      if (name) c.set(name, (c.get(name) || 0) + 1);
    }
  }
  return [...c].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'ja'));
}

/** 検索用の文字列（別名・レーベル・特徴を NFKC・小文字にして、つなげる） */
export function actorHay(a) {
  return norm([...(a.aliases || []), a.label, a.descriptor, a.height ? `${a.height}cm` : '', a.weight ? `${a.weight}kg` : '', a.age ? `${a.age}歳` : ''].join(' ')).toLowerCase();
}

/** 体型の短い要約（一覧のカードの 2 行目）。「172cm・60kg・20歳」 */
export function actorSummary(a) {
  return [a.height ? `${a.height}cm` : '', a.weight ? `${a.weight}kg` : '', a.age ? `${a.age}歳` : ''].filter(Boolean).join('・');
}
