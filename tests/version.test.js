// バージョン番号と更新履歴の整合性（version.js は DOM を使う部品を import するので、文字列として読む）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'js', 'version.js'), 'utf8');

test('VERSION が更新履歴の先頭と一致し、履歴は新しい順', () => {
  const version = src.match(/export const VERSION = '([^']+)'/)[1];
  const listed = [...src.matchAll(/version: '([^']+)'/g)].map((m) => m[1]);
  assert.equal(listed[0], version, '更新履歴の先頭に今のバージョンを足してください');
  const num = (v) => v.split('.').map(Number).reduce((a, b) => a * 1000 + b, 0);
  for (let i = 1; i < listed.length; i++) assert.ok(num(listed[i - 1]) > num(listed[i]), `${listed[i - 1]} と ${listed[i]} の順番`);
});
