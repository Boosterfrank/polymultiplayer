#!/usr/bin/env node
// Generates 0.1.0/icon.png (128x128) without any image library: a trophy on the game's blue.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const outFile = path.join(root, manifest.latest["0.6.3"], "icon.png");

const W = 128;
const H = 128;
const px = new Uint8Array(W * H * 4);

function put(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  px[i] = r;
  px[i + 1] = g;
  px[i + 2] = b;
  px[i + 3] = a;
}

// background: rounded square in --surface-color #28346a with a lighter ring
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dx = Math.max(Math.abs(x - 63.5) - 44, 0);
    const dy = Math.max(Math.abs(y - 63.5) - 44, 0);
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= 20) {
      const edge = d > 17;
      put(x, y, edge ? 0x33 : 0x28, edge ? 0x4b : 0x34, edge ? 0x77 : 0x6a);
    }
  }
}

// trophy (white): cup, handles, stem, base
function fillRect(x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, 255, 255, 255);
}
// cup: a bowl narrowing toward the bottom
for (let y = 30; y <= 68; y++) {
  const t = (y - 30) / 38;
  const half = Math.round(26 - 14 * t * t);
  fillRect(64 - half, y, 63 + half, y);
}
// handles
for (let y = 34; y <= 56; y++) {
  const t = (y - 34) / 22;
  const r = Math.round(12 * Math.sin(Math.PI * t));
  fillRect(64 - 26 - r - 3, y, 64 - 26 - r + 1, y);
  fillRect(63 + 26 + r - 1, y, 63 + 26 + r + 3, y);
}
// stem and base
fillRect(59, 69, 68, 84);
fillRect(48, 85, 79, 92);
fillRect(42, 93, 85, 99);
// a dark "1" on the cup
for (let y = 38; y <= 60; y++) fillRect(62, y, 66, y);
for (let y = 38; y <= 44; y++) fillRect(58 + (y - 38), y, 62, y);
for (let y = 38; y <= 60; y++) for (let x = 58; x <= 69; x++) {
  const i = (y * W + x) * 4;
  if (px[i] === 255 && px[i + 1] === 255 && ((x >= 62 && x <= 66) || (y <= 44 && x >= 58 + (y - 38) && x <= 62))) {
    px[i] = 0x28; px[i + 1] = 0x34; px[i + 2] = 0x6a;
  }
}

// PNG encoding
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0; // filter none
  Buffer.from(px.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
fs.writeFileSync(outFile, png);
console.log(`[icon] wrote ${path.relative(root, outFile)} (${png.length} bytes)`);
