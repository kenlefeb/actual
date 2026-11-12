import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TestProviders } from '#mocks';
import { nativeParentPath, resetNativeRoutes } from '#native/nativeChrome';

import { useNativeTabBarRoutes } from './useNativeTabBarRoutes';

// native-appearance: "Back goes up one level in the iOS app" (sc-3736)
describe('useNativeTabBarRoutes', () => {
  afterEach(() => resetNativeRoutes());

  function renderAt(entry: { pathname: string; state?: unknown }) {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestProviders>
        <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>
      </TestProviders>
    );
    renderHook(() => useNativeTabBarRoutes(), { wrapper });
  }

  it('remembers the screen a transaction page was opened from', () => {
    renderAt({
      pathname: '/transactions/t1',
      state: { previousLocation: { pathname: '/categories/c1' } },
    });

    expect(nativeParentPath('/transactions/t1', 'acct')).toBe('/categories/c1');
  });

  it('knows nothing of a transaction page opened by a deep link', () => {
    renderAt({ pathname: '/transactions/t1' });

    expect(nativeParentPath('/transactions/t1', 'acct')).toBe('/accounts/acct');
  });
});
