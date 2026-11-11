import { describe, expect, it } from 'vitest';

import { isNativeShell, nativeShell } from './nativeShell';

const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const MAC_ELECTRON =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Actual/26.10.1 Chrome/136.0.0.0 Electron/36.0.0 Safari/537.36';
const WINDOWS_ELECTRON =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Actual/26.10.1 Chrome/136.0.0.0 Electron/36.0.0 Safari/537.36';
const LINUX_ELECTRON =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Actual/26.10.1 Chrome/136.0.0.0 Electron/36.0.0 Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

function win(userAgent: string, platform?: string) {
  return {
    navigator: { userAgent },
    ...(platform && { Capacitor: { getPlatform: () => platform } }),
  };
}

describe('nativeShell', () => {
  it.each([
    ['the iOS Capacitor app', 'ios', win(IPHONE, 'ios')],
    ['the macOS Electron app', 'mac', win(MAC_ELECTRON)],
    ['Safari on a Mac', null, win(MAC_SAFARI)],
    ['Safari on an iPhone', null, win(IPHONE)],
    // The web build can load Capacitor's JS without being the app
    ['a browser with Capacitor on the web platform', null, win(IPHONE, 'web')],
    ['the Android Capacitor app', null, win(IPHONE, 'android')],
    ['the Windows Electron app', null, win(WINDOWS_ELECTRON)],
    ['the Linux Electron app', null, win(LINUX_ELECTRON)],
  ])('in %s is %s', (_, expected, w) => {
    expect(nativeShell(w)).toBe(expected);
    expect(isNativeShell(w)).toBe(expected !== null);
  });
});
