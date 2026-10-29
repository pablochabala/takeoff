// Generates PWA PNG icons + favicon.svg from the TakeoffPro mark.
// Usage: npm run icons
import { createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve('public/icons');
fs.mkdirSync(out, { recursive: true });

// Draw the mark on a 64-unit grid; `pad` shrinks it for maskable safe zone.
function draw(size, { maskable = false, rounded = true } = {}) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const s = size / 64;
  ctx.fillStyle = '#1E3A5F';
  if (rounded && !maskable) {
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, 14 * s);
    ctx.fill();
  } else {
    ctx.fillRect(0, 0, size, size);
  }
  const k = maskable ? 0.72 : 1; // maskable icons keep content inside the central 80%
  ctx.translate(size / 2, size / 2);
  ctx.scale(s * k, s * k);
  ctx.translate(-32, -32);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(16, 14); ctx.lineTo(16, 48); ctx.lineTo(50, 48);
  ctx.stroke();
  ctx.strokeStyle = '#F97316';
  ctx.beginPath();
  ctx.moveTo(16, 48); ctx.lineTo(44, 20);
  ctx.stroke();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  for (const [x1, y1, x2, y2] of [[26, 48, 26, 43], [36, 48, 36, 43], [16, 38, 21, 38], [16, 28, 21, 28]]) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  return c.toBuffer('image/png');
}

fs.writeFileSync(path.join(out, 'icon-192.png'), draw(192));
fs.writeFileSync(path.join(out, 'icon-512.png'), draw(512));
fs.writeFileSync(path.join(out, 'icon-maskable-512.png'), draw(512, { maskable: true }));
// iOS applies its own rounded mask, so give it a full-bleed square.
fs.writeFileSync(path.join(out, 'apple-touch-icon.png'), draw(180, { rounded: false }));

fs.writeFileSync(
  path.resolve('public/favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1E3A5F"/><path d="M16 14v34h34" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 48 44 20" stroke="#F97316" stroke-width="6" stroke-linecap="round"/><path d="M26 48v-5M36 48v-5M16 38h5M16 28h5" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>\n`,
);
console.log('Icons written to public/icons and public/favicon.svg');
