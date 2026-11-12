// Fork-only (sc-3514, ADR 11). The page side of the iOS app's native tab bar
// (NativeChromePlugin.swift and NativeTabBarController.swift). The page tells
// the tab bar which screen it shows and asks for haptic taps; the tab bar asks
// the page to show a section through `window.__actualNativeChrome.navigate`.
// The message handler exists only inside the iOS app, so everything here is a
// no-op in a browser.
type ChromeMessage =
  | { type: 'route'; path: string; tabBar: boolean }
  | { type: 'closed' }
  | { type: 'haptic' }
  | { type: 'nativeScreen'; screen: NativeScreenName; on: boolean };

// The tabs that have a native screen behind a per-screen switch (sc-3751)
export type NativeScreenName = 'budget';

type NativeChrome = {
  navigate: (path: string) => void;
  report: () => void;
};

export type ChromeWindow = {
  webkit?: {
    messageHandlers?: {
      actualNativeChrome?: { postMessage: (message: ChromeMessage) => void };
    };
  };
  __actualNativeChrome?: NativeChrome;
  // Set by the app at document start: which native screens are switched on
  __actualNativeScreens?: Partial<Record<NativeScreenName, boolean>>;
};

declare global {
  // oxlint-disable-next-line typescript/consistent-type-definitions
  interface Window {
    __actualNativeChrome?: NativeChrome;
    __actualNativeScreens?: Partial<Record<NativeScreenName, boolean>>;
  }
}

// The sections a tab or the Add button may open, and the screens a tab may
// return to (its last screen)
const SECTIONS = [
  'budget',
  'accounts',
  'reports',
  'settings',
  'transactions',
  'categories',
  'schedules',
  'payees',
  'rules',
  'tags',
  'bank-sync',
  'notifications',
];
const PATH = /^\/([a-z-]+)(\/[\w-]+)*\/?$/;

function post(win: ChromeWindow, message: ChromeMessage) {
  win.webkit?.messageHandlers?.actualNativeChrome?.postMessage(message);
}

export function hasNativeTabBar(win: ChromeWindow = window) {
  return win.webkit?.messageHandlers?.actualNativeChrome != null;
}

export function nativeHaptic(win: ChromeWindow = window) {
  post(win, { type: 'haptic' });
}

export function isNativeScreenOn(
  screen: NativeScreenName,
  win: ChromeWindow = window,
) {
  return win.__actualNativeScreens?.[screen] === true;
}

// The app stores the switch (UserDefaults) and applies it when the tab is
// next shown; no-op in a browser
export function setNativeScreenOn(
  screen: NativeScreenName,
  on: boolean,
  win: ChromeWindow = window,
) {
  if (!hasNativeTabBar(win)) return;
  win.__actualNativeScreens = { ...win.__actualNativeScreens, [screen]: on };
  post(win, { type: 'nativeScreen', screen, on });
}

export function postNativeRoute(
  win: ChromeWindow,
  path: string,
  tabBar: boolean,
) {
  post(win, { type: 'route', path, tabBar });
}

// iOS convention: the tab bar hides while a pushed form or a sheet shows
export function showsNativeTabBar(path: string, hasSheet: boolean) {
  return !hasSheet && !path.startsWith('/transactions/');
}

export function installNativeChrome(
  win: ChromeWindow,
  navigate: (path: string) => void,
  report: () => void,
) {
  if (!hasNativeTabBar(win)) return undefined;

  win.__actualNativeChrome = {
    navigate(path) {
      const section = PATH.exec(path)?.[1];
      if (!section || !SECTIONS.includes(section)) {
        throw new Error(`native tab bar: ${path} is not allowlisted`);
      }
      navigate(path);
    },
    report,
  };
  return () => {
    delete win.__actualNativeChrome;
  };
}

// The budget closed: hide the tab bar until a budget is open again
export function postNativeClosed(win: ChromeWindow) {
  post(win, { type: 'closed' });
}
