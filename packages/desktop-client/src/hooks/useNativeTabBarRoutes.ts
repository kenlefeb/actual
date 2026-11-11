import { useEffect } from 'react';
import { useLocation } from 'react-router';

import { useNavigate } from '#hooks/useNavigate';
import {
  installNativeChrome,
  postNativeClosed,
  postNativeRoute,
} from '#native/nativeChrome';

// Fork-only (sc-3514, ADR 11). Connects the iOS app's native tab bar to the
// router while a budget is open; does nothing in a browser. Unmounting
// (closing the budget) hides the tab bar.
export function useNativeTabBarRoutes() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(
    () => installNativeChrome(window, path => void navigate(path)),
    [navigate],
  );
  useEffect(() => postNativeRoute(window, pathname), [pathname]);
  useEffect(() => () => postNativeClosed(window), []);
}
