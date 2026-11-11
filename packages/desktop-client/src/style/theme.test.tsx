import type { ReactElement } from 'react';

import heDarkCss from '@actual-app/components/themes/home-economics-dark.css?inline';
import heLightCss from '@actual-app/components/themes/home-economics-light.css?inline';
import lightCss from '@actual-app/components/themes/light.css?inline';
import midnightCss from '@actual-app/components/themes/midnight.css?inline';
import sidebarRedesignLightCss from '@actual-app/components/themes/sidebar-redesign-light.css?inline';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CustomThemeStyle, ThemeStyle } from './theme';

let mockShell: 'ios' | 'mac' | null = null;
let mockPrefs: Record<string, string | undefined> = {};

// Tests don't process CSS, so each sheet stands in as its name
vi.mock('@actual-app/components/themes/palette.css?inline', () => ({
  default: '/* palette */',
}));
vi.mock('@actual-app/components/themes/light.css?inline', () => ({
  default: '/* light */',
}));
vi.mock('@actual-app/components/themes/dark.css?inline', () => ({
  default: '/* dark */',
}));
vi.mock('@actual-app/components/themes/midnight.css?inline', () => ({
  default: '/* midnight */',
}));
vi.mock(
  '@actual-app/components/themes/sidebar-redesign-light.css?inline',
  () => ({
    default: '/* sidebar-redesign-light */',
  }),
);
vi.mock(
  '@actual-app/components/themes/home-economics-light.css?inline',
  () => ({
    default: '/* home-economics-light */',
  }),
);
vi.mock('@actual-app/components/themes/home-economics-dark.css?inline', () => ({
  default: '/* home-economics-dark */',
}));

vi.mock('./nativeShell', () => ({
  nativeShell: () => mockShell,
  isNativeShell: () => mockShell !== null,
}));

vi.mock('#hooks/useGlobalPref', () => ({
  useGlobalPref: (key: string) => [mockPrefs[key], vi.fn()],
}));

const customTheme = JSON.stringify({
  id: 'x',
  name: 'Synced from a browser',
  repo: 'example/theme',
  baseTheme: 'midnight',
  cssContent: ':root { --color-pageBackground: #123456; }',
});

function sheets(ui: ReactElement) {
  const { container } = render(ui);
  return [...container.querySelectorAll('style')].map(style => ({
    css: style.textContent,
    media: style.getAttribute('media'),
  }));
}

describe('ThemeStyle (sc-3505)', () => {
  beforeEach(() => {
    mockShell = null;
    mockPrefs = {};
  });

  it.each(['ios', 'mac'] as const)(
    'in the %s app renders the Home Economics sheets, following the system appearance',
    shell => {
      mockShell = shell;
      const rendered = sheets(<ThemeStyle />);
      expect(rendered).toContainEqual({
        css: heLightCss,
        media: '(prefers-color-scheme: light)',
      });
      expect(rendered).toContainEqual({
        css: heDarkCss,
        media: '(prefers-color-scheme: dark)',
      });
      expect(rendered.map(s => s.css)).not.toContain(lightCss);
    },
  );

  it('in a browser renders upstream sheets', () => {
    mockPrefs = { theme: 'light' };
    const css = sheets(<ThemeStyle />).map(s => s.css);
    expect(css).toContain(lightCss);
    expect(css).not.toContain(heLightCss);
    expect(css).not.toContain(heDarkCss);
  });

  it('in a native app ignores the theme pref, a custom theme and the sidebar redesign sheet', () => {
    mockShell = 'mac';
    mockPrefs = {
      theme: 'midnight',
      installedCustomLightTheme: customTheme,
    };
    const css = sheets(<ThemeStyle />).map(s => s.css);
    expect(css).toContain(heLightCss);
    expect(css).not.toContain(midnightCss);
    expect(css).not.toContain(sidebarRedesignLightCss);
  });

  it('in a browser keeps the sidebar redesign sheet', () => {
    mockPrefs = { theme: 'light' };
    const css = sheets(<ThemeStyle />).map(s => s.css);
    expect(css).toContain(sidebarRedesignLightCss);
  });
});

describe('CustomThemeStyle (sc-3505)', () => {
  beforeEach(() => {
    mockShell = null;
    mockPrefs = {
      theme: 'light',
      installedCustomLightTheme: customTheme,
      customCssOverride: ':root { --color-pageText: #654321; }',
    };
  });

  it('in a browser renders the custom theme and the CSS override', () => {
    const css = sheets(<CustomThemeStyle />).map(s => s.css);
    expect(css.join('\n')).toContain('#123456');
    expect(css.join('\n')).toContain('#654321');
  });

  it.each(['ios', 'mac'] as const)(
    'in the %s app renders nothing, so a theme synced from a browser cannot restyle it',
    shell => {
      mockShell = shell;
      expect(sheets(<CustomThemeStyle />)).toEqual([]);
    },
  );
});
