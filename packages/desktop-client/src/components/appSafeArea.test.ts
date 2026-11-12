import { describe, expect, it } from 'vitest';

import { appSafeAreaPadding } from './appSafeArea';

describe('appSafeAreaPadding', () => {
  it('keeps the wide budget layout clear of the status bar, side insets and home indicator', () => {
    expect(
      appSafeAreaPadding({ isBudgetOpen: true, isNarrowWidth: false }),
    ).toEqual({
      paddingTop: 'env(safe-area-inset-top)',
      paddingBottom: 'env(safe-area-inset-bottom)',
      paddingLeft: 'env(safe-area-inset-left)',
      paddingRight: 'env(safe-area-inset-right)',
    });
  });

  it('leaves the top to the phone page header and the bottom to the phone tab bar', () => {
    expect(
      appSafeAreaPadding({ isBudgetOpen: true, isNarrowWidth: true }),
    ).toEqual({
      paddingLeft: 'env(safe-area-inset-left)',
      paddingRight: 'env(safe-area-inset-right)',
    });
  });

  it('pads the top of the file list but leaves its bottom to the manager screens', () => {
    for (const isNarrowWidth of [true, false]) {
      expect(
        appSafeAreaPadding({ isBudgetOpen: false, isNarrowWidth }),
      ).toEqual({
        paddingTop: 'env(safe-area-inset-top)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      });
    }
  });
});
