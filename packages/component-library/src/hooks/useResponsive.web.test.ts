import { renderHook } from '@testing-library/react';

import { useResponsive } from './useResponsive';

// native-appearance: "iPhone keeps the phone layout in landscape" (sc-3706)
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15';
const IPAD =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';

function setup(width: number, height: number, ua: string, inApp: boolean) {
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('innerHeight', height);
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
  vi.stubGlobal(
    'webkit',
    inApp ? { messageHandlers: { actualNativeChrome: {} } } : undefined,
  );
  return renderHook(() => useResponsive()).result.current;
}

describe('useResponsive', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps the phone layout in landscape in the iPhone app', () => {
    const r = setup(956, 440, IPHONE, true);
    expect(r.isNarrowWidth).toBe(true);
    expect(r.isWideWidth).toBe(false);
  });

  it('is wide on iPad in the app', () => {
    expect(setup(1180, 820, IPAD, true).isWideWidth).toBe(true);
  });

  it('is wide in a phone browser in landscape', () => {
    expect(setup(956, 440, IPHONE, false).isNarrowWidth).toBe(false);
  });
});
