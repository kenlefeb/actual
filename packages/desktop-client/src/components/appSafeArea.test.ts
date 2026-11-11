import { describe, expect, it } from 'vitest';

import { appSafeAreaPadding } from './appSafeArea';

describe('appSafeAreaPadding', () => {
  it('keeps the wide layout and the file list clear of the status bar and side insets', () => {
    expect(appSafeAreaPadding({ hasMobilePageHeader: false })).toEqual({
      paddingTop: 'env(safe-area-inset-top)',
      paddingLeft: 'env(safe-area-inset-left)',
      paddingRight: 'env(safe-area-inset-right)',
    });
  });

  it('leaves the top to the phone page header, which already pads it', () => {
    expect(appSafeAreaPadding({ hasMobilePageHeader: true })).toEqual({
      paddingLeft: 'env(safe-area-inset-left)',
      paddingRight: 'env(safe-area-inset-right)',
    });
  });
});
