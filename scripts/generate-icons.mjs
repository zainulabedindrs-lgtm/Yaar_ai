#!/usr/bin/env node
/**
 * Generates the Yaar app icon set from a single vector source.
 *
 *   npm run icons
 *
 * Output (client/public/icons/):
 *   favicon.svg            vector favicon for browsers
 *   apple-touch-icon.png   180x180 (iOS home screen)
 *   icon-192.png           192x192 (Android / PWA)
 *   icon-512.png           512x512 (PWA / Play Store listing)
 *   icon-maskable-512.png  512x512 with the safe-zone padding Android masks need
 *   icon-1024.png          1024x1024 (Play Store feature graphic source)
 *
 * Icons are committed to the repository, so this script only needs to be re-run
 * when the artwork changes. It uses `sharp` (dev dependency) and does not need a
 * network connection.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'client', 'public', 'icons');

const PINK = '#ff5f8f';
const CORAL = '#ff9fbe';
const DEEP = '#f4477f';
const INK = '#2b1b2f';

/** The app icon: a rounded squircle, a warm gradient and a soft "Y" monogram. */
function iconSvg({ size = 512, padding = 0, rounded = true, background = true } = {}) {
  const inset = padding;
  const radius = rounded ? size * 0.24 : 0;
  const fontSize = size * 0.5;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${CORAL}" />
      <stop offset="55%" stop-color="${PINK}" />
      <stop offset="100%" stop-color="${DEEP}" />
    </linearGradient>
    <radialGradient id="glow" cx="30%" cy="18%" r="80%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.42" />
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0" />
    </radialGradient>
  </defs>
  ${
    background
      ? `<rect x="${inset}" y="${inset}" width="${size - inset * 2}" height="${size - inset * 2}" rx="${radius}" fill="url(#grad)" />
  <rect x="${inset}" y="${inset}" width="${size - inset * 2}" height="${size - inset * 2}" rx="${radius}" fill="url(#glow)" />`
      : ''
  }
  <g transform="translate(${size / 2} ${size / 2})">
    <text
      x="0"
      y="${fontSize * 0.35}"
      text-anchor="middle"
      font-family="Inter, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
      font-size="${fontSize}"
      font-weight="800"
      letter-spacing="${-fontSize * 0.03}"
      fill="#ffffff"
    >Y</text>
    <circle cx="${size * 0.185}" cy="${fontSize * 0.42}" r="${size * 0.045}" fill="#ffffff" opacity="0.9" />
  </g>
</svg>`;
}

async function loadSharp() {
  try {
    const module = await import('sharp');
    return module.default ?? module;
  } catch {
    console.error(
      [
        'This script needs the optional dev dependency "sharp".',
        '',
        '  npm install --no-save sharp',
        '',
        'The generated icons are already committed, so you only need sharp if you',
        'change the artwork in scripts/generate-icons.mjs.',
      ].join('\n'),
    );
    process.exit(1);
  }
}

async function main() {
  const sharp = await loadSharp();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Vector favicon (hand-written so no rasteriser is needed at runtime).
  fs.writeFileSync(path.join(OUT_DIR, 'favicon.svg'), `${iconSvg({ size: 64 })}\n`);

  const raster = [
    { file: 'icon-192.png', size: 192 },
    { file: 'icon-512.png', size: 512 },
    { file: 'icon-1024.png', size: 1024 },
    { file: 'apple-touch-icon.png', size: 180, rounded: false },
  ];

  for (const { file, size, rounded } of raster) {
    const svg = Buffer.from(iconSvg({ size, rounded: rounded ?? true }));
    await sharp(svg).png({ compressionLevel: 9 }).toFile(path.join(OUT_DIR, file));
    console.log(`icons: wrote ${file} (${size}x${size})`);
  }

  // Maskable icon: Android crops to a circle, so the art is inset to ~72%.
  const maskableSize = 512;
  const inset = Math.round(maskableSize * 0.14);
  const maskableSvg = `<svg width="${maskableSize}" height="${maskableSize}" viewBox="0 0 ${maskableSize} ${maskableSize}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${maskableSize}" height="${maskableSize}" fill="${PINK}" />
  <g transform="translate(${inset} ${inset})">
    ${iconSvg({ size: maskableSize - inset * 2, rounded: true })}
  </g>
</svg>`;
  await sharp(Buffer.from(maskableSvg))
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT_DIR, 'icon-maskable-512.png'));
  console.log('icons: wrote icon-maskable-512.png (512x512, safe zone applied)');

  // A splash-friendly square avatar placeholder, in case artwork is missing.
  fs.writeFileSync(
    path.join(OUT_DIR, 'placeholder-avatar.svg'),
    `<svg width="120" height="120" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
  <circle cx="60" cy="60" r="60" fill="${PINK}" />
  <text x="60" y="76" text-anchor="middle" font-family="system-ui, sans-serif" font-size="44" font-weight="700" fill="${INK}">Y</text>
</svg>\n`,
  );

  console.log('icons: done →', path.relative(ROOT, OUT_DIR));
}

main().catch((error) => {
  console.error('icon generation failed:', error?.message);
  process.exit(1);
});
