import { useEffect } from 'react';
import { useLocation } from 'react-router';

import { useNavigate } from '#hooks/useNavigate';
import {
  installNativeChrome,
  postNativeClosed,
  postNativeRoute,
  rememberNativeScreen,
  showsNativeTabBar,
} from '#native/nativeChrome';
import { useSelector } from '#redux';

// Fork-only (sc-3514, ADR 11). Connects the iOS app's native tab bar to the
// router while a budget is open; does nothing in a browser. Unmounting
// (closing the budget) hides the tab bar.
export function useNativeTabBarRoutes() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const hasSheet = useSelector(state => state.modals.modalStack.length > 0);
  const tabBar = showsNativeTabBar(pathname, hasSheet);
  rememberNativeScreen(pathname);

  useEffect(
    () =>
      installNativeChrome(
        window,
        path => void navigate(path),
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
