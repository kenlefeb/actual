import { useEffect } from 'react';
import { useLocation } from 'react-router';

import { useNavigate } from '#hooks/useNavigate';
import {
  installNativeChrome,
  postNativeClosed,
  postNativeRoute,
  rememberNativeRoute,
  showsNativeTabBar,
} from '#native/nativeChrome';
import { useSelector } from '#redux';

// Fork-only (sc-3514, ADR 11). Connects the iOS app's native tab bar to the
// router while a budget is open; does nothing in a browser. Unmounting
// (closing the budget) hides the tab bar.
export function useNativeTabBarRoutes() {
  const navigate = useNavigate();
  const { pathname, state } = useLocation();
  const hasSheet = useSelector(s => s.modals.modalStack.length > 0);
  const tabBar = showsNativeTabBar(pathname, hasSheet);
  // After the page shows, so a render never changes what Back means
  useEffect(() => rememberNativeRoute(pathname, state), [pathname, state]);

  useEffect(
    () =>
      installNativeChrome(
        window,
        path => void navigate(path, { state: { fromTabBar: true } }),
        () => postNativeRoute(window, pathname, tabBar),
      ),
    [navigate, pathname, tabBar],
  );
  useEffect(
    () => postNativeRoute(window, pathname, tabBar),
    [pathname, tabBar],
  );
  useEffect(() => () => postNativeClosed(window), []);
}
