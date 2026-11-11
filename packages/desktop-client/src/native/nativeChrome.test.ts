import {
  hasNativeTabBar,
  installNativeChrome,
  nativeHaptic,
  postNativeClosed,
  postNativeRoute,
} from './nativeChrome';
import type { ChromeWindow } from './nativeChrome';

// native-appearance: "iPhone uses a native tab bar" (sc-3514)
function iosApp() {
  const postMessage = vi.fn();
  const win: ChromeWindow = {
    webkit: { messageHandlers: { actualNativeChrome: { postMessage } } },
    location: { pathname: '/accounts/a1' },
  };
  return { win, postMessage };
}

const browser = (): ChromeWindow => ({ location: { pathname: '/budget' } });

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
    postNativeRoute(win, '/reports');
    expect(postMessage).toHaveBeenCalledWith({
      type: 'route',
      path: '/reports',
    });
  });
});

describe('installNativeChrome', () => {
  it('does nothing in a browser', () => {
    const win = browser();
    const navigate = vi.fn();
    installNativeChrome(win, navigate);
    expect(win.__actualNativeChrome).toBeUndefined();
  });

  it('navigates to an allowlisted section when a tab is tapped', () => {
    const { win } = iosApp();
    const navigate = vi.fn();
    installNativeChrome(win, navigate);

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
    installNativeChrome(win, navigate);

    expect(() => win.__actualNativeChrome?.navigate(path)).toThrow(
      'not allowlisted',
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it('re-reports the current route when the app returns to the foreground', () => {
    const { win, postMessage } = iosApp();
    installNativeChrome(win, vi.fn());

    win.__actualNativeChrome?.report();

    expect(postMessage).toHaveBeenCalledWith({
      type: 'route',
      path: '/accounts/a1',
    });
  });

  it('removes the page call on cleanup', () => {
    const { win } = iosApp();
    const cleanup = installNativeChrome(win, vi.fn());

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
