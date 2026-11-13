// Fork-only (sc-3532, sc-3913): generate every Home Economics app icon from
// the one master, fork/brand/app-icon.svg, and write it over the upstream
// Actual icons in place, so no manifest or build config changes.
//
// Run on a Mac from the repo root: `node fork/scripts/generate-app-icons.mjs`.
// Needs rsvg-convert (`brew install librsvg`), plus sips and iconutil (macOS).
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

// Pack PNG images into one .ico file. Each entry is { size, png }.
export function pngsToIco(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, entry); // 0 means 256
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4); // colour planes
    header.writeUInt16LE(32, entry + 6); // bits per pixel
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map(image => image.png)]);
}

function main() {
  const master = readFileSync(join(root, 'fork/brand/app-icon.svg'), 'utf8');
  const background = master.match(/id="background"[^>]*fill="([^"]+)"/)[1];
  const foreground = master.match(/<g id="foreground">[\s\S]*<\/g>\s*<\/g>/)[0];
  const tmp = mkdtempSync(join(tmpdir(), 'app-icons-'));

  // One SVG per foreground layer, for building the layered Icon Composer
  // file by hand (Icon Composer has no command line).
  mkdirSync(join(root, 'fork/brand/icon-composer'), { recursive: true });
  for (const layer of ['jar', 'coins']) {
    const group = master.match(
      new RegExp(`<g id="${layer}">[\\s\\S]*?</g>`),
    )[0];
    writeFileSync(
      join(root, `fork/brand/icon-composer/${layer}.svg`),
      `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 120 120">${group}</svg>\n`,
    );
  }

  // The artwork lives in a 120 x 120 box. `art` places that box, `size`
  // units wide, centred on a w x h canvas with an optional backdrop.
  function svg(w, h, size, art, backdrop = '') {
    const s = size / 120;
    const x = (w - size) / 2;
    const y = (h - size) / 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${backdrop}<g transform="translate(${x} ${y}) scale(${s})">${art}</g></svg>`;
  }
  const full = `<rect width="120" height="120" fill="${background}"/>${foreground}`;
  // The Figma squircle: corner radius 27 of 120.
  const rounded = `<rect width="120" height="120" rx="27" fill="${background}"/>${foreground}`;
  const circle = `<circle cx="60" cy="60" r="60" fill="${background}"/>${foreground}`;
  const fill = `<rect width="100%" height="100%" fill="${background}"/>`;

  // `file` is relative to the repo root, or absolute.
  function render(file, w, h, size, art, backdrop) {
    const source = join(tmp, 'icon.svg');
    const out = resolve(root, file);
    writeFileSync(source, svg(w, h, size, art, backdrop));
    mkdirSync(dirname(out), { recursive: true });
    execFileSync(
      'rsvg-convert',
      ['-w', w, '-h', h, '-o', out, source].map(String),
    );
  }
  const square = (file, px, art, scale = 1) =>
    render(file, px, px, px * scale, art);

  // iOS: one 1024 icon per appearance. The default one must be opaque, so
  // it goes through BMP, which has no alpha channel.
  const ios = 'packages/mobile-client/ios/App/App/Assets.xcassets';
  square(`${ios}/AppIcon.appiconset/AppIcon-512@2x.png`, 1024, full);
  const bmp = join(tmp, 'opaque.bmp');
  execFileSync('sips', [
    '-s',
    'format',
    'bmp',
    join(root, ios, 'AppIcon.appiconset/AppIcon-512@2x.png'),
    '--out',
    bmp,
  ]);
  execFileSync('sips', [
    '-s',
    'format',
    'png',
    bmp,
    '--out',
    join(root, ios, 'AppIcon.appiconset/AppIcon-512@2x.png'),
  ]);
  // Dark: the system draws its own dark backdrop behind the foreground.
  square(`${ios}/AppIcon.appiconset/AppIcon-dark.png`, 1024, foreground);
  // Tinted: a greyscale foreground the system colours with the user's tint.
  square(
    `${ios}/AppIcon.appiconset/AppIcon-tinted.png`,
    1024,
    `<g filter="url(#grey)"><filter id="grey"><feColorMatrix type="saturate" values="0"/></filter>${foreground}</g>`,
  );
  for (const name of [
    'splash-2732x2732.png',
    'splash-2732x2732-1.png',
    'splash-2732x2732-2.png',
  ]) {
    render(`${ios}/Splash.imageset/${name}`, 2732, 2732, 600, foreground, fill);
  }

  // macOS: Apple's icon grid puts an 824 squircle on a 1024 canvas.
  const iconset = join(tmp, 'icon.iconset');
  mkdirSync(iconset);
  for (const px of [16, 32, 128, 256, 512]) {
    for (const [scale, suffix] of [
      [1, ''],
      [2, '@2x'],
    ]) {
      const file = join(iconset, `icon_${px}x${px}${suffix}.png`);
      square(file, px * scale, rounded, 824 / 1024);
    }
  }
  execFileSync('iconutil', [
    '-c',
    'icns',
    iconset,
    '-o',
    join(root, 'packages/desktop-electron/icons/icon.icns'),
  ]);

  // Electron on Windows and Linux.
  square('packages/desktop-electron/icons/icon.png', 512, rounded);
  const appx = 'packages/desktop-electron/appx';
  const scales = { 100: 1, 125: 1.25, 150: 1.5, 200: 2, 400: 4 };
  const tiles = {
    LargeTile: [310, 310],
    SmallTile: [71, 71],
    Square150x150Logo: [150, 150],
    Square44x44Logo: [44, 44],
    StoreLogo: [50, 50],
    Wide310x150Logo: [310, 150],
  };
  for (const [name, [w, h]] of Object.entries(tiles)) {
    const tile = (file, tw, th) =>
      render(`${appx}/${file}`, tw, th, Math.min(tw, th) * 0.8, rounded);
    tile(`${name}.png`, w, h);
    for (const [pct, k] of Object.entries(scales)) {
      tile(`${name}.scale-${pct}.png`, Math.round(w * k), Math.round(h * k));
    }
  }
  for (const [pct, k] of Object.entries(scales)) {
    render(
      `${appx}/SplashScreen.scale-${pct}.png`,
      620 * k,
      300 * k,
      300 * k * 0.8,
      rounded,
    );
  }
  for (const px of [
    16, 20, 24, 30, 32, 36, 40, 44, 48, 60, 64, 72, 80, 96, 256,
  ]) {
    for (const variant of [
      'targetsize',
      'altform-unplated_targetsize',
      'altform-lightunplated_targetsize',
    ]) {
      square(`${appx}/Square44x44Logo.${variant}-${px}.png`, px, rounded);
    }
  }

  // Web app.
  const web = 'packages/desktop-client/public';
  square(`${web}/favicon-16x16.png`, 16, rounded);
  square(`${web}/favicon-32x32.png`, 32, rounded);
  square(`${web}/apple-touch-icon.png`, 180, full);
  square(`${web}/android-chrome-192x192.png`, 192, rounded);
  square(`${web}/android-chrome-512x512.png`, 512, rounded);
  square(`${web}/mstile-150x150.png`, 150, rounded, 0.6);
  // Maskable icons keep the artwork inside the central 80% safe zone.
  render(`${web}/maskable-192x192.png`, 192, 192, 192 * 0.8, foreground, fill);
  render(`${web}/maskable-512x512.png`, 512, 512, 512 * 0.8, foreground, fill);
  const ico = [16, 32, 48].map(px => {
    const file = join(tmp, `favicon-${px}.png`);
    square(file, px, rounded);
    return { size: px, png: readFileSync(file) };
  });
  writeFileSync(join(root, web, 'favicon.ico'), pngsToIco(ico));

  // Android: adaptive icon (foreground over the background colour, with the
  // 120 box filling the 72 dp visible part of the 108 dp layer), plus legacy
  // square and round launcher icons and the splash screens.
  const res = 'packages/mobile-client/android/app/src/main/res';
  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [density, k] of Object.entries(densities)) {
    square(
      `${res}/mipmap-${density}/ic_launcher_foreground.png`,
      108 * k,
      foreground,
      72 / 108,
    );
    square(`${res}/mipmap-${density}/ic_launcher.png`, 48 * k, rounded);
    square(`${res}/mipmap-${density}/ic_launcher_round.png`, 48 * k, circle);
  }
  const splashes = {
    'drawable/splash.png': [480, 320],
    ...Object.fromEntries(
      Object.entries({
        mdpi: [320, 480],
        hdpi: [480, 800],
        xhdpi: [720, 1280],
        xxhdpi: [960, 1600],
        xxxhdpi: [1280, 1920],
      }).flatMap(([density, [w, h]]) => [
        [`drawable-port-${density}/splash.png`, [w, h]],
        [`drawable-land-${density}/splash.png`, [h, w]],
      ]),
    ),
  };
  for (const [file, [w, h]] of Object.entries(splashes)) {
    render(`${res}/${file}`, w, h, Math.min(w, h) * 0.4, foreground, fill);
  }
  const colour = join(root, res, 'values/ic_launcher_background.xml');
  writeFileSync(
    colour,
    readFileSync(colour, 'utf8').replace(
      /#[0-9A-Fa-f]{6}/,
      background.toUpperCase(),
    ),
  );

  rmSync(tmp, { recursive: true });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
