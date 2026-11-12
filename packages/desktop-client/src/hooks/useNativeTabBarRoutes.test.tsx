import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TestProviders } from '#mocks';
import { nativeParentPath, rememberNativeScreen } from '#native/nativeChrome';

import { useNativeTabBarRoutes } from './useNativeTabBarRoutes';

// native-appearance: "Back goes up one level in the iOS app" (sc-3736)
describe('useNativeTabBarRoutes', () => {
  afterEach(() => rememberNativeScreen(null));

  it('remembers the screen a transaction page was opened from', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestProviders>
        <MemoryRouter initialEntries={['/categories/c1']}>
          {children}
        </MemoryRouter>
      </TestProviders>
    );
    renderHook(() => useNativeTabBarRoutes(), { wrapper });

    expect(nativeParentPath('/transactions/t1', 'acct')).toBe('/categories/c1');
  });
});
