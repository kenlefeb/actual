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

function color(themeCss: string, token: string): string {
  const value = themeCss.match(
    new RegExp(`--color-${token}:\\s*([^;]+);`),
  )?.[1];
  // A fork token can alias a shared one
  const alias = value?.match(/var\(--color-([\w-]+)\)/)?.[1];
  if (alias) {
    return color(themeCss, alias);
  }
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

// fork: sc-3505, the Home Economics themes of the native apps
const themeNames = [
  'light',
  'dark',
  'midnight',
  'home-economics-light',
  'home-economics-dark',
];

describe('paycheck note and warning contrast', () => {
  // The desktop register sits on pageBackground, the phone account page on
  // mobilePageBackground
  it.each(themeNames)('meets WCAG AA in the %s theme', themeName => {
    const css = read(`${themeName}.css`);
    const pairs = [
      ['paycheckNoteText', 'pageBackground'],
      ['paycheckNoteText', 'mobilePageBackground'],
      // Field labels in the phone paycheck editor's section cards
      ['paycheckNoteText', 'tableBackground'],
      // The paycheck note in the desktop schedule dialog (sc-1116)
      ['paycheckNoteText', 'modalBackground'],
      ['paycheckWarningText', 'pageBackground'],
      ['paycheckWarningText', 'mobilePageBackground'],
      // The Paychecks card on the Schedules page ("Skipped: …" and the
      // clearing warning)
      ['paycheckWarningText', 'tableBackground'],
    ];
    for (const [text, background] of pairs) {
      expect(
        contrast(color(css, text), color(css, background)),
        `${text} on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

// The backgrounds secondary and warning text sit on across the app, as
// measured on sc-1096
const backgrounds = [
  'pageBackground',
  'mobilePageBackground',
  'tableBackground',
  'cardBackground',
  'modalBackground',
  'menuBackground',
];

describe('subdued and warning text contrast (sc-1212)', () => {
  it.each(themeNames)(
    'pageTextSubdued meets WCAG AA on every background in the %s theme',
    themeName => {
      const css = read(`${themeName}.css`);
      for (const background of backgrounds) {
        expect(
          contrast(color(css, 'pageTextSubdued'), color(css, background)),
          `pageTextSubdued on ${background}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it.each(['light', 'home-economics-light', 'home-economics-dark'])(
    'warningText meets WCAG AA on every background in the %s theme',
    themeName => {
      const css = read(`${themeName}.css`);
      for (const background of backgrounds) {
        expect(
          contrast(color(css, 'warningText'), color(css, background)),
          `warningText on ${background}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});

describe('Notifications row count pill contrast (sc-1848)', () => {
  it.each(themeNames)(
    'pillTextSelected on pillBackgroundSelected meets WCAG AA in the %s theme',
    themeName => {
      const css = read(`${themeName}.css`);
      expect(
        contrast(
          color(css, 'pillTextSelected'),
          color(css, 'pillBackgroundSelected'),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );
});

describe('Home Economics text and amount contrast (sc-3505)', () => {
  const texts = [
    'pageText',
    'pageTextSubdued',
    'pageTextLink',
    'tableText',
    'tableTextLight',
    'tableHeaderText',
    'numberPositive',
    'numberNegative',
    'budgetNumberZero',
    'templateNumberUnderFunded',
    'errorText',
    'noticeText',
  ];

  it.each(['home-economics-light', 'home-economics-dark'])(
    'every text and amount colour meets WCAG AA on every background in the %s theme',
    themeName => {
      const css = read(`${themeName}.css`);
      for (const text of texts) {
        for (const background of backgrounds) {
          expect(
            contrast(color(css, text), color(css, background)),
            `${text} on ${background}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
      for (const [text, background] of [
        ['buttonPrimaryText', 'buttonPrimaryBackground'],
        ['mobileHeaderText', 'mobileHeaderBackground'],
        ['mobileNavItemSelected', 'mobileNavBackground'],
        ['sidebarItemText', 'sidebarBackground'],
        ['sidebarItemTextSelected', 'sidebarBackground'],
        ['menuItemText', 'menuBackground'],
        ['menuAutoCompleteText', 'menuAutoCompleteBackground'],
        ['formInputText', 'formInputBackground'],
        ['tooltipText', 'tooltipBackground'],
      ]) {
        expect(
          contrast(color(css, text), color(css, background)),
          `${text} on ${background}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});

describe('Home Economics token parity (sc-3505)', () => {
  // A token upstream adds to light.css must be added here too, or the native
  // apps would fall through to no value for it
  function tokens(file: string) {
    return [...new Set(read(file).match(/--color-[\w-]+(?=:)/g))].sort();
  }

  it.each(['home-economics-light.css', 'home-economics-dark.css'])(
    '%s defines exactly the --color-* tokens of light.css',
    file => {
      expect(tokens(file)).toEqual(tokens('light.css'));
    },
  );
});
