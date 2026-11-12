import { useLocation } from 'react-router';

import { useNavigate } from '#hooks/useNavigate';
import { hasNativeTabBar, nativeParentPath } from '#native/nativeChrome';

// Fork-only (sc-3736). Back for mobile pages: up one level in the iOS app, the
// browser's history everywhere else. `hidden` is true where the app has no
// parent (a tab root). `account` is a transaction's fallback destination.
export function useGoBack(account?: string | null) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const parent = hasNativeTabBar()
    ? nativeParentPath(pathname, account)
    : undefined;
  return {
    hidden: parent === null,
    goBack: () => void (parent == null ? navigate(-1) : navigate(parent)),
  };
}
