import {
  hasNativeTabBar,
  installNativeChrome,
  isNativeScreenOn,
  nativeHaptic,
  nativeParentPath,
  postNativeClosed,
  postNativeRoute,
  setNativeScreenOn,
  showsNativeTabBar,
} from './nativeChrome';
import type { ChromeWindow } from './nativeChrome';

// native-appearance: "iPhone uses a native tab bar" (sc-3514)
function iosApp() {
  const postMessage = vi.fn();
  const win: ChromeWindow = {
    webkit: { messageHandlers: { actualNativeChrome: { postMessage } } },
  };
  return { win, postMessage };
}

const browser = (): ChromeWindow => ({});

describe('hasNativeTabBar', () => {
  it('is true only inside the iOS app', () => {
    expect(hasNativeTabBar(iosApp().win)).toBe(true);
    expect(hasNativeTabBar(browser())).toBe(false);
  });
});

describe('nativeHaptic', () => {
  it('asks the iOS app for a haptic tap', () => {
    const { win, postMessage } = iosApp();
    nativeHaptic(win);
    expect(postMessage).toHaveBeenCalledWith({ type: 'haptic' });
  });

  it('is a no-op in a browser', () => {
    expect(() => nativeHaptic(browser())).not.toThrow();
  });
});

describe('postNativeRoute', () => {
  it('tells the tab bar which screen the page shows', () => {
    const { win, postMessage } = iosApp();
    postNativeRoute(win, '/reports', true);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'route',
      path: '/reports',
      tabBar: true,
    });
  });
});

// iOS convention: the tab bar hides while a pushed form or a sheet shows, so
// the form's own footer and the keyboard have the bottom of the screen
describe('showsNativeTabBar', () => {
  it('shows on section screens', () => {
    expect(showsNativeTabBar('/budget', false)).toBe(true);
    expect(showsNativeTabBar('/accounts/a1', false)).toBe(true);
  });

  it('hides on the new and edit transaction forms', () => {
    expect(showsNativeTabBar('/transactions/new', false)).toBe(false);
    expect(showsNativeTabBar('/transactions/t1', false)).toBe(false);
  });

  it('hides while a sheet is open', () => {
    expect(showsNativeTabBar('/budget', true)).toBe(false);
  });
});

describe('installNativeChrome', () => {
  it('does nothing in a browser', () => {
    const win = browser();
    const navigate = vi.fn();
    installNativeChrome(win, navigate, vi.fn());
    expect(win.__actualNativeChrome).toBeUndefined();
  });

  it('navigates to an allowlisted section when a tab is tapped', () => {
    const { win } = iosApp();
    const navigate = vi.fn();
    installNativeChrome(win, navigate, vi.fn());

    win.__actualNativeChrome?.navigate('/accounts');
    win.__actualNativeChrome?.navigate('/transactions/new');
    win.__actualNativeChrome?.navigate('/categories/c1');

    expect(navigate.mock.calls).toEqual([
      ['/accounts'],
      ['/transactions/new'],
      ['/categories/c1'],
    ]);
  });

  it.each([
    'https://example.com/budget',
    '//example.com/budget',
    'mailto:budget',
    '/budget/../files',
    '/files',
    'budget',
    '',
  ])('refuses %j without navigating', path => {
    const { win } = iosApp();
    const navigate = vi.fn();
    installNativeChrome(win, navigate, vi.fn());

    expect(() => win.__actualNativeChrome?.navigate(path)).toThrow(
      'not allowlisted',
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it('re-reports the current route when the app returns to the foreground', () => {
    const { win } = iosApp();
    const report = vi.fn();
    installNativeChrome(win, vi.fn(), report);

    win.__actualNativeChrome?.report();

    expect(report).toHaveBeenCalledOnce();
  });

  it('removes the page call on cleanup', () => {
    const { win } = iosApp();
    const cleanup = installNativeChrome(win, vi.fn(), vi.fn());

    cleanup?.();

    expect(win.__actualNativeChrome).toBeUndefined();
  });
});

describe('postNativeClosed', () => {
  it('hides the tab bar when the budget closes', () => {
    const { win, postMessage } = iosApp();
    postNativeClosed(win);
    expect(postMessage).toHaveBeenCalledWith({ type: 'closed' });
  });
});

// native-budget-screen: "The native Budget tab has a per-screen switch" (sc-3751)
describe('the native Budget screen switch', () => {
  it('is off until the app says it is on', () => {
    expect(isNativeScreenOn('budget', iosApp().win)).toBe(false);
    const { win } = iosApp();
    win.__actualNativeScreens = { budget: true };
    expect(isNativeScreenOn('budget', win)).toBe(true);
  });

  it('tells the app and remembers the new value', () => {
    const { win, postMessage } = iosApp();
    setNativeScreenOn('budget', true, win);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'nativeScreen',
      screen: 'budget',
      on: true,
    });
    expect(isNativeScreenOn('budget', win)).toBe(true);
    setNativeScreenOn('budget', false, win);
    expect(isNativeScreenOn('budget', win)).toBe(false);
  });

  it('is always off in a browser', () => {
    const win = browser();
    setNativeScreenOn('budget', true, win);
    expect(isNativeScreenOn('budget', win)).toBe(false);
  });
});

// native-appearance: "Back goes up one level in the iOS app" (sc-3736)
describe('nativeParentPath', () => {
  it.each([
    ['/accounts/1', '/accounts'],
    ['/categories/c1', '/budget'],
    ['/schedules/s1', '/schedules'],
    ['/paychecks/p1', '/schedules'],
    ['/schedules', '/settings'],
    ['/business-calendars', '/settings'],
    ['/business-calendars/b1', '/business-calendars'],
    ['/payees/p1', '/settings/payees'],
    ['/rules/r1', '/settings/rules'],
    ['/bank-sync/account/a1/edit', '/settings/bank-sync'],
    ['/settings/general', '/settings'],
    ['/reports/d1', '/reports'],
    ['/notifications', '/settings'],
  ])('puts %s under %s', (path, parent) => {
    expect(nativeParentPath(path)).toBe(parent);
  });

  it('has no parent for a tab root', () => {
    for (const root of ['/budget', '/accounts', '/reports', '/settings/']) {
      expect(nativeParentPath(root)).toBeNull();
    }
  });

  it('has no parent for an unmapped screen, so Back is hidden', () => {
    expect(nativeParentPath('/something-else/1')).toBeNull();
  });

  describe('a transaction page', () => {
    // The remembered origins are module state, so each case starts fresh
    async function load() {
      vi.resetModules();
      return import('./nativeChrome');
    }
    const from = (pathname: string) => ({ previousLocation: { pathname } });
    const fromTabBar = (pathname: string) => ({
      ...from(pathname),
      fromTabBar: true,
    });

    it('goes back to the account when it was not opened from a screen (deep link)', async () => {
      const chrome = await load();
      chrome.rememberNativeRoute('/transactions/t1', undefined);
      expect(chrome.nativeParentPath('/transactions/t1', 'acct')).toBe(
        '/accounts/acct',
      );
    });

    it('goes back to the selected tab root for a new transaction with nothing known', async () => {
      const chrome = await load();
      chrome.rememberNativeRoute('/reports/d1', undefined);
      chrome.rememberNativeRoute('/transactions/new', undefined);
      expect(chrome.nativeParentPath('/transactions/new')).toBe('/reports');
    });

    it.each([
      ['/accounts/acct'],
      ['/categories/c1'],
      ['/reports/d1'],
      ['/settings'],
    ])('goes back to %s, the screen it was opened from', async origin => {
      const chrome = await load();
      chrome.rememberNativeRoute('/transactions/t1', from(origin));
      expect(chrome.nativeParentPath('/transactions/t1', 'acct')).toBe(origin);
    });

    it('Add opens from the screen the tab bar was used on', async () => {
      const chrome = await load();
      chrome.rememberNativeRoute(
        '/transactions/new',
        fromTabBar('/categories/c1'),
      );
      expect(chrome.nativeParentPath('/transactions/new')).toBe(
        '/categories/c1',
      );
    });

    it('Accounts, account 7, a transaction, Reports, Accounts, Back: the account, on the Accounts tab', async () => {
      const chrome = await load();
      chrome.rememberNativeRoute('/accounts/7', undefined);
      chrome.rememberNativeRoute('/transactions/t1', from('/accounts/7'));
      chrome.rememberNativeRoute('/reports', fromTabBar('/transactions/t1'));
      // The Accounts tab restores its last screen, the transaction
      chrome.rememberNativeRoute('/transactions/t1', fromTabBar('/reports'));
      expect(chrome.nativeParentPath('/transactions/t1', '7')).toBe(
        '/accounts/7',
      );
    });

    it("a tab restoring a transaction never takes the other tab's screen", async () => {
      const chrome = await load();
      chrome.rememberNativeRoute('/reports/d1', undefined);
      chrome.rememberNativeRoute('/transactions/t9', fromTabBar('/reports/d1'));
      expect(chrome.nativeParentPath('/transactions/t9', 'acct')).toBe(
        '/accounts/acct',
      );
    });

    it('a deep link while the app is on /reports/d1 goes back to the account', async () => {
      const chrome = await load();
      chrome.rememberNativeRoute('/reports/d1', undefined);
      chrome.rememberNativeRoute('/transactions/t1', undefined);
      expect(chrome.nativeParentPath('/transactions/t1', 'acct')).toBe(
        '/accounts/acct',
      );
    });
  });
});
