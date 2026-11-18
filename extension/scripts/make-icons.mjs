// Generates the toolbar icons (a small dot plot on a blue tile) as PNG files without any dependency.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(out, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]); };

function icon(size) {
  const S = 4; // supersampling
  const px = Buffer.alloc(size * size * 4);
  const r = size * 0.22;
  const dots = [[0.26, 0.70, 0.085], [0.44, 0.52, 0.085], [0.60, 0.58, 0.085], [0.76, 0.30, 0.085]];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let tile = 0, dot = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const fx = x + (sx + 0.5) / S, fy = y + (sy + 0.5) / S;
      const cx = Math.min(Math.max(fx, r), size - r), cy = Math.min(Math.max(fy, r), size - r);
      if ((fx - cx) ** 2 + (fy - cy) ** 2 <= r * r) tile++;
      if (dots.some(([dx, dy, dr]) => (fx / size - dx) ** 2 + (fy / size - dy) ** 2 <= dr * dr)) dot++;
    }
    const a = tile / (S * S), d = dot / (S * S), i = (y * size + x) * 4;
    px[i] = Math.round(0x23 + (0xff - 0x23) * d); px[i + 1] = Math.round(0x46 + (0xff - 0x46) * d); px[i + 2] = Math.round(0xc0 + (0xff - 0xc0) * d); px[i + 3] = Math.round(255 * a);
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

for (const size of [16, 32, 48, 128]) writeFileSync(join(out, `icon-${size}.png`), icon(size));
console.log('icons written');
