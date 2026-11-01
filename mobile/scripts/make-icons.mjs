// Renders the eight-point star logo into every Android launcher icon size, the
// Android splash images and the web app icons. Run after `npx cap add android`.
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../..', import.meta.url));
const res = join(root, 'mobile/android/app/src/main/res');
const webIcons = join(root, 'client/public/icons');

const LAPIS = '#0B1626';
const STAR =
  '<path fill="#2EC4B6" d="M32 3.7 40.3 12H52v11.7l8.3 8.3-8.3 8.3V52H40.3L32 60.3 23.7 52H12V40.3L3.7 32 12 23.7V12h11.7z"/>' +
  `<circle cx="32" cy="32" r="13" fill="${LAPIS}"/><path fill="#F2B33D" d="M28 25.5v13l11-6.5z"/>`;

/** An SVG of the given size: background shape + star scaled to `scale` of the canvas. */
function svg(w, h, { bg = null, shape = 'square', scale = 0.62 } = {}) {
  const s = Math.min(w, h) * scale;
  const x = (w - s) / 2;
  const y = (h - s) / 2;
  const back =
    bg === null ? '' : shape === 'circle' ? `<circle cx="${w / 2}" cy="${h / 2}" r="${w / 2}" fill="${bg}"/>` : shape === 'rounded' ? `<rect width="${w}" height="${h}" rx="${w * 0.22}" fill="${bg}"/>` : `<rect width="${w}" height="${h}" fill="${bg}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${back}<g transform="translate(${x} ${y}) scale(${s / 64})">${STAR}</g></svg>`;
}

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(file, w, h, opts) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(w, h, opts)}</body></html>`);
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
}

const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
if (existsSync(res)) {
  for (const [d, k] of Object.entries(densities)) {
    const dir = join(res, `mipmap-${d}`);
    mkdirSync(dir, { recursive: true });
    await render(join(dir, 'ic_launcher.png'), 48 * k, 48 * k, { bg: LAPIS, shape: 'rounded', scale: 0.72 });
    await render(join(dir, 'ic_launcher_round.png'), 48 * k, 48 * k, { bg: LAPIS, shape: 'circle', scale: 0.66 });
    // Adaptive icon foreground: 108dp canvas, logo inside the 66dp safe zone.
    await render(join(dir, 'ic_launcher_foreground.png'), 108 * k, 108 * k, { scale: 0.5 });
  }
  // Splash images: keep each file's size, lapis background with the star in the middle.
  const { default: sizeOf } = await import('./png-size.mjs');
  for (const dir of readdirSync(res).filter((d) => d.startsWith('drawable'))) {
    const file = join(res, dir, 'splash.png');
    if (!existsSync(file)) continue;
    const { width, height } = sizeOf(file);
    await render(file, width, height, { bg: LAPIS, scale: 0.28 });
  }
  console.log('Android icons and splash images written.');
}
mkdirSync(webIcons, { recursive: true });
await render(join(webIcons, 'icon-192.png'), 192, 192, { bg: LAPIS, shape: 'rounded', scale: 0.72 });
await render(join(webIcons, 'icon-512.png'), 512, 512, { bg: LAPIS, shape: 'rounded', scale: 0.72 });
await render(join(webIcons, 'maskable-512.png'), 512, 512, { bg: LAPIS, scale: 0.56 });
console.log('Web app icons written.');
await browser.close();
