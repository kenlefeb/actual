import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';
import { nativeParentPath, resetNativeRoutes } from '#native/nativeChrome';
import { useSelector } from '#redux';

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

  // native-bridge: "Web hand-offs are a closed set of messages" (sc-4931, D7a)
  describe('web hand-offs from the native Accounts screen', () => {
    afterEach(() => {
      delete (window as { webkit?: unknown }).webkit;
    });

    function renderInApp() {
      (window as unknown as { webkit: unknown }).webkit = {
        messageHandlers: { actualNativeChrome: { postMessage: vi.fn() } },
      };
      const wrapper = ({ children }: { children: ReactNode }) => (
        <TestProviders>
          <MemoryRouter initialEntries={['/accounts']}>{children}</MemoryRouter>
        </TestProviders>
      );
      return renderHook(
        () => {
          useNativeTabBarRoutes();
          return {
            location: useLocation(),
            modals: useSelector(s => s.modals.modalStack),
          };
        },
        { wrapper },
      );
    }

    it.each(['add-account', 'link-account'] as const)(
      'opens the add-account dialog for %s',
      action => {
        const { result } = renderInApp();
        act(() => window.__actualNativeChrome?.webAccountAction?.(action));
        expect(result.current.modals.map(m => m.name)).toEqual(['add-account']);
      },
    );

    it('opens the bank sync page', () => {
      const { result } = renderInApp();
      act(() =>
        window.__actualNativeChrome?.webAccountAction?.('bank-sync', 'c1'),
      );
      expect(result.current.location.pathname).toBe('/bank-sync');
    });

    it('opens the account page asking for its menu', () => {
      const { result } = renderInApp();
      act(() =>
        window.__actualNativeChrome?.webAccountAction?.(
          'account-settings',
          'c1',
        ),
      );
      expect(result.current.location.pathname).toBe('/accounts/c1');
      expect(result.current.location.state).toMatchObject({
        openAccountMenu: true,
      });
    });

    it('encodes the account id, so it cannot change the route', () => {
      const { result } = renderInApp();
      act(() =>
        window.__actualNativeChrome?.webAccountAction?.(
          'account-settings',
          '../settings a/b',
        ),
      );
      expect(result.current.location.pathname).toBe(
        '/accounts/..%2Fsettings%20a%2Fb',
      );
    });
  });
});
