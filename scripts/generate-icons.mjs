// Generates the bundled toolbar icons as PNGs with no external dependencies.
// Design: navy rounded square, white "in"-free link glyph (two interlocking rings), teal check dot.
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "../public/icons");
mkdirSync(outDir, { recursive: true });

const NAVY = [16, 37, 66];
const WHITE = [255, 255, 255];
const TEAL = [20, 184, 166];

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
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Signed distance helpers in unit space [0,1].
const sdRoundRect = (x, y, half, r) => {
  const qx = Math.abs(x - 0.5) - half + r;
  const qy = Math.abs(y - 0.5) - half + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const sdRing = (x, y, cx, cy, radius, thick) => Math.abs(Math.hypot(x - cx, y - cy) - radius) - thick;
const sdCircle = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r;

function shade(u, v, px) {
  const aa = 1 / px;
  const cover = (d) => Math.min(1, Math.max(0, 0.5 - d / aa));
  const bg = cover(sdRoundRect(u, v, 0.48, 0.2));
  if (bg <= 0) return [0, 0, 0, 0];
  let color = NAVY;
  const ring = Math.max(cover(sdRing(u, v, 0.38, 0.5, 0.16, 0.045)), cover(sdRing(u, v, 0.62, 0.5, 0.16, 0.045)));
  color = color.map((c, i) => c + (WHITE[i] - c) * ring);
  const dot = cover(sdCircle(u, v, 0.78, 0.24, 0.1));
  color = color.map((c, i) => c + (TEAL[i] - c) * dot);
  return [...color.map(Math.round), Math.round(bg * 255)];
}

for (const size of [16, 32, 48, 128]) {
  const ss = 4; // supersampling
  const buf = png(size, (x, y) => {
    let acc = [0, 0, 0, 0];
    for (let i = 0; i < ss; i++) for (let j = 0; j < ss; j++) {
      const p = shade((x + (i + 0.5) / ss) / size, (y + (j + 0.5) / ss) / size, size);
      acc = acc.map((a, k) => a + (k < 3 ? p[k] * p[3] : p[3]));
    }
    const a = acc[3] / (ss * ss);
    return a === 0 ? [0, 0, 0, 0] : [acc[0] / acc[3], acc[1] / acc[3], acc[2] / acc[3], a].map(Math.round);
  });
  writeFileSync(resolve(outDir, `icon-${size}.png`), buf);
}
console.log(`Icons written to ${outDir}`);
