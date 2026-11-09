// アプリアイコン（PNG）を外部ライブラリなしで生成する
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// 背景: 暗いグラデーション / 中央: 紫の再生マーク（4x4のスーパーサンプリングで縁を滑らかに）
function pixel(x, y, s) {
  let hit = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const u = (x + (i + 0.5) / 4) / s, v = (y + (j + 0.5) / 4) / s;
    // 三角形 (0.38,0.30) (0.38,0.70) (0.72,0.50)
    if (u >= 0.38 && v >= 0.30 + (u - 0.38) * (0.20 / 0.34) && v <= 0.70 - (u - 0.38) * (0.20 / 0.34)) hit++;
  }
  const t = hit / 16;
  const v = y / s;
  const bg = [Math.round(24 - 8 * v), Math.round(24 - 8 * v), Math.round(30 - 8 * v)];
  const fg = [139, 124, 246];
  return [0, 1, 2].map((k) => Math.round(bg[k] * (1 - t) + fg[k] * t)).concat(255);
}

const out = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(out, { recursive: true });
for (const size of [180, 192, 512]) fs.writeFileSync(path.join(out, `icon-${size}.png`), png(size, pixel));
console.log('icons written to', out);
