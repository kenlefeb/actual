import { useLocation } from 'react-router';

import { useNavigate } from '#hooks/useNavigate';
import { hasNativeTabBar, nativeParentPath } from '#native/nativeChrome';

// Fork-only (sc-3736). Back for mobile pages: up one level in the iOS app, the
// browser's history everywhere else. `hidden` is true on a tab root in the app.
export function useGoBack() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const parent = hasNativeTabBar() ? nativeParentPath(pathname) : undefined;
  return {
    hidden: parent === null,
    goBack: () => void (parent == null ? navigate(-1) : navigate(parent)),
  };
}
