// Fork-only (sc-3514, ADR 11). The page side of the iOS app's native tab bar
// (NativeChromePlugin.swift and NativeTabBarController.swift). The page tells
// the tab bar which screen it shows and asks for haptic taps; the tab bar asks
// the page to show a section through `window.__actualNativeChrome.navigate`.
// The message handler exists only inside the iOS app, so everything here is a
// no-op in a browser.
type ChromeMessage =
  | { type: 'route'; path: string; tabBar: boolean }
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

const TAB_ROOTS = ['/budget', '/accounts', '/reports', '/settings'];
// Settings sections and the list screen their details go back to; the list's
// own parent is Settings
const SETTINGS_LISTS: Record<string, string> = {
  '/schedules': '/schedules',
  '/business-calendars': '/business-calendars',
  '/notifications': '/notifications',
  '/payees': '/settings/payees',
  '/rules': '/settings/rules',
  '/tags': '/settings/tags',
  '/bank-sync': '/settings/bank-sync',
};
const DETAIL_PARENTS: Record<string, string> = {
  '/paychecks': '/schedules',
  '/categories': '/budget',
};

// The last screen shown that was not a transaction page: where a transaction
// opened from (an account register, a category, the Add tab) returns to
let lastScreen: string | null = null;
export function rememberNativeScreen(path: string | null) {
  // null forgets it, as after a relaunch
  if (path == null || !path.startsWith('/transactions/')) lastScreen = path;
}

// Fork-only (sc-3736). The fixed parent screen the iOS app's Back goes to, or
// null on a tab root or a screen with no mapped parent (Back is hidden).
// Never history, never another tab. `account` is the fallback for a
// transaction with no remembered screen (deep link or relaunch).
export function nativeParentPath(
  path: string,
  account?: string | null,
): string | null {
  const segments = path.split('/').filter(Boolean);
  const root = `/${segments[0] ?? ''}`;
  if (TAB_ROOTS.includes(root)) return segments.length === 1 ? null : root;
  if (root in SETTINGS_LISTS) {
    return segments.length === 1 ? '/settings' : SETTINGS_LISTS[root];
  }
  if (root === '/transactions') {
    return lastScreen ?? (account ? `/accounts/${account}` : '/accounts');
  }
  return DETAIL_PARENTS[root] ?? null;
}

// The budget closed: hide the tab bar until a budget is open again
export function postNativeClosed(win: ChromeWindow) {
  post(win, { type: 'closed' });
}
