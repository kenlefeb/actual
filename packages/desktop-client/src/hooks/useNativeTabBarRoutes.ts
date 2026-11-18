import { useEffect } from 'react';
import { useLocation } from 'react-router';

import { useNavigate } from '#hooks/useNavigate';
import { replaceModal } from '#modals/modalsSlice';
import {
  installNativeChrome,
  postNativeClosed,
  postNativeRoute,
  rememberNativeRoute,
  showsNativeTabBar,
} from '#native/nativeChrome';
import { useDispatch, useSelector } from '#redux';

// Fork-only (sc-3514, ADR 11). Connects the iOS app's native tab bar to the
// router while a budget is open; does nothing in a browser. Unmounting
// (closing the budget) hides the tab bar.
export function useNativeTabBarRoutes() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
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
        // The native Accounts screen's hand-offs (D7a): only the web's own flows
        (action, accountId) => {
          if (action === 'add-account' || action === 'link-account') {
            dispatch(
              replaceModal({ modal: { name: 'add-account', options: {} } }),
            );
          } else if (action === 'bank-sync') {
            void navigate('/bank-sync', { state: { fromTabBar: true } });
          } else {
            void navigate(`/accounts/${encodeURIComponent(accountId ?? '')}`, {
              state: { fromTabBar: true, openAccountMenu: true },
            });
          }
        },
      ),
    [navigate, dispatch, pathname, tabBar],
  );
  useEffect(
    () => postNativeRoute(window, pathname, tabBar),
    [pathname, tabBar],
  );
  useEffect(() => () => postNativeClosed(window), []);
}
