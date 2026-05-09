// Generate the platform icon set from assets/source/icon.svg.
//
//   PNG  →  1024×1024 master, 512×512 macOS / Linux fallback, 256×256
//   ICNS →  macOS app icon (built via macOS-native `iconutil`)
//   ICO  →  Windows app icon (built via png-to-ico)
//
// Run:  npm run icons
//
// Outputs land in assets/ at the paths electron-builder.yml expects:
//   assets/icon.png   (master, 1024×1024)
//   assets/icon.icns  (macOS)
//   assets/icon.ico   (Windows)

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC_SVG = join(ROOT, 'assets/source/icon.svg');
const OUT_DIR = join(ROOT, 'assets');
const ICONSET_DIR = join(OUT_DIR, 'icon.iconset');

// macOS expects a specific filename convention inside .iconset/.
const MAC_ICONSET = [
  { size: 16,   name: 'icon_16x16.png' },
  { size: 32,   name: 'icon_16x16@2x.png' },
  { size: 32,   name: 'icon_32x32.png' },
  { size: 64,   name: 'icon_32x32@2x.png' },
  { size: 128,  name: 'icon_128x128.png' },
  { size: 256,  name: 'icon_128x128@2x.png' },
  { size: 256,  name: 'icon_256x256.png' },
  { size: 512,  name: 'icon_256x256@2x.png' },
  { size: 512,  name: 'icon_512x512.png' },
  { size: 1024, name: 'icon_512x512@2x.png' }
];

// Windows .ico packs multiple sizes in one file.
const WIN_ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

async function renderPng(svg, size) {
  return sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

async function main() {
  console.log('Reading SVG…');
  const svg = await readFile(SRC_SVG);

  // 1. The master 1024×1024 PNG (used directly on Linux + as ICNS source).
  console.log('Rendering 1024×1024 master PNG…');
  const masterPng = await renderPng(svg, 1024);
  await writeFile(join(OUT_DIR, 'icon.png'), masterPng);

  // 2. macOS .icns via the system `iconutil` (the only fully-supported path
  //    on macOS — third-party libs lose color-profile fidelity).
  console.log('Building macOS .icns…');
  await rm(ICONSET_DIR, { recursive: true, force: true });
  await mkdir(ICONSET_DIR, { recursive: true });
  for (const { size, name } of MAC_ICONSET) {
    const png = await renderPng(svg, size);
    await writeFile(join(ICONSET_DIR, name), png);
  }
  if (process.platform === 'darwin') {
    execSync(`iconutil -c icns -o "${join(OUT_DIR, 'icon.icns')}" "${ICONSET_DIR}"`, {
      stdio: 'inherit'
    });
  } else {
    console.warn(
      '⚠️  iconutil is macOS-only — skipping icon.icns. ' +
      'Run this script on macOS to commit the .icns alongside the .ico.'
    );
  }
  await rm(ICONSET_DIR, { recursive: true, force: true });

  // 3. Windows .ico via png-to-ico.
  console.log('Building Windows .ico…');
  const winPngs = await Promise.all(WIN_ICO_SIZES.map((s) => renderPng(svg, s)));
  const ico = await pngToIco(winPngs);
  await writeFile(join(OUT_DIR, 'icon.ico'), ico);

  console.log('✅ Icons written to assets/icon.{png,icns,ico}');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
