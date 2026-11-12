import { useWindowSize } from 'usehooks-ts';

import { breakpoints } from '#tokens';

// Fork-only (sc-3706): the iOS app (the native tab bar's message handler, see
// desktop-client/src/native/nativeChrome.ts) on an iPhone. iPad reports a
// Macintosh user agent, so it keeps its own wide layout.
function isIPhoneApp() {
  return (
    typeof window !== 'undefined' &&
    // oxlint-disable-next-line typescript/no-explicit-any
    (window as any).webkit?.messageHandlers?.actualNativeChrome != null &&
    /iPhone/.test(navigator.userAgent)
  );
}

export function useResponsive() {
  const size = useWindowSize({
    debounceDelay: 250,
  });
  const { height } = size;
  // The phone layout in landscape too: the short side decides on iPhone
  const width = isIPhoneApp() ? Math.min(size.width, height) : size.width;

  // Possible view modes: narrow, small, medium, wide
  // To check if we're at least small width, check !isNarrowWidth
  return {
    // atLeastMediumWidth is provided to avoid checking (isMediumWidth || isWideWidth)
    atLeastMediumWidth: width >= breakpoints.medium,
    isNarrowWidth: width < breakpoints.small,
    isSmallWidth: width >= breakpoints.small && width < breakpoints.medium,
    isMediumWidth: width >= breakpoints.medium && width < breakpoints.wide,
    // No atLeastWideWidth because that's identical to isWideWidth
    isWideWidth: width >= breakpoints.wide,
    height,
    width,
  };
}
