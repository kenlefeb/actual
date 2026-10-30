import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// WCAG 2.1 contrast, computed from the theme CSS so a palette or token change
// that drops below AA fails here
function read(file: string) {
  return readFileSync(join(__dirname, file), 'utf8');
}

const palette = Object.fromEntries(
  [
    ...read('palette.css').matchAll(/--palette-([\w-]+):\s*(#[0-9a-f]{6})/gi),
  ].map(([, name, hex]) => [name, hex]),
);

function color(themeCss: string, token: string) {
  const value = themeCss.match(
    new RegExp(`--color-${token}:\\s*([^;]+);`),
  )?.[1];
  const name = value?.match(/var\(--palette-([\w-]+)\)/)?.[1];
  const hex = name ? palette[name] : value?.trim();
  if (!hex?.startsWith('#')) {
    throw new Error(`No color for ${token}`);
  }
  return hex;
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map(i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe('clearing account note contrast', () => {
  // The desktop register sits on pageBackground, the phone account page on
  // mobilePageBackground
  it.each(['light', 'dark', 'midnight'])(
    'meets WCAG AA in the %s theme',
    themeName => {
      const css = read(`${themeName}.css`);
      for (const text of ['clearingNoteText', 'clearingWarningText']) {
        for (const background of ['pageBackground', 'mobilePageBackground']) {
          expect(
            contrast(color(css, text), color(css, background)),
            `${text} on ${background}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    },
  );
});
