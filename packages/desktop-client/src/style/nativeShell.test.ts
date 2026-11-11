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
    ['the iOS Capacitor app', win(IPHONE, 'ios'), 'ios'],
    ['the macOS Electron app', win(MAC_ELECTRON), 'mac'],
    ['Safari on a Mac', win(MAC_SAFARI), null],
    ['Safari on an iPhone', win(IPHONE), null],
    // The web build can load Capacitor's JS without being the app
    ['a browser with Capacitor on the web platform', win(IPHONE, 'web'), null],
    ['the Android Capacitor app', win(IPHONE, 'android'), null],
    ['the Windows Electron app', win(WINDOWS_ELECTRON), null],
    ['the Linux Electron app', win(LINUX_ELECTRON), null],
  ])('in %s is %s', (_, w, expected) => {
    expect(nativeShell(w)).toBe(expected);
    expect(isNativeShell(w)).toBe(expected !== null);
  });
});
