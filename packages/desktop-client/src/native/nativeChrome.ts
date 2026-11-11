// Fork-only (sc-3514, ADR 11). The page side of the iOS app's native tab bar
// (NativeChromePlugin.swift and NativeTabBarController.swift). The page tells
// the tab bar which screen it shows and asks for haptic taps; the tab bar asks
// the page to show a section through `window.__actualNativeChrome.navigate`.
// The message handler exists only inside the iOS app, so everything here is a
// no-op in a browser.
type ChromeMessage =
  | { type: 'route'; path: string }
  | { type: 'closed' }
  | { type: 'haptic' };

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
  location: { pathname: string };
  __actualNativeChrome?: NativeChrome;
};

declare global {
  // oxlint-disable-next-line typescript/consistent-type-definitions
  interface Window {
    __actualNativeChrome?: NativeChrome;
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

export function postNativeRoute(win: ChromeWindow, path: string) {
  post(win, { type: 'route', path });
}

export function installNativeChrome(
  win: ChromeWindow,
  navigate: (path: string) => void,
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
    report() {
      postNativeRoute(win, win.location.pathname);
    },
  };
  return () => {
    delete win.__actualNativeChrome;
  };
}

// The budget closed: hide the tab bar until a budget is open again
export function postNativeClosed(win: ChromeWindow) {
  post(win, { type: 'closed' });
}
