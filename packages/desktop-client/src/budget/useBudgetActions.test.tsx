import type { ReactNode } from 'react';

import { act, renderHook, waitFor } from '@testing-library/react';

import { resetTestProviders, TestProviders } from '#mocks';
import { initServer } from '#mocks/connection';

import { useBudgetActions } from './mutations';

vi.mock(
  '@actual-app/core/platform/client/connection',
  () => import('#mocks/connection'),
);

// native-appearance: "iPhone uses a native tab bar": moving money gives a
// haptic tap in the iOS app (sc-3514)
describe('useBudgetActions haptics', () => {
  const postMessage = vi.fn();

  beforeEach(() => {
    resetTestProviders();
    postMessage.mockReset();
    (window as { webkit?: unknown }).webkit = {
      messageHandlers: { actualNativeChrome: { postMessage } },
    };
    initServer({
      'budget/transfer-category': () => null,
      'budget/budget-amount': () => null,
    } as Parameters<typeof initServer>[0]);
  });

  afterEach(() => {
    delete (window as { webkit?: unknown }).webkit;
  });

  function setup() {
    return renderHook(() => useBudgetActions(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <TestProviders>{children}</TestProviders>
      ),
    });
  }

  it('taps after money moves between categories', async () => {
    const { result } = setup();

    await act(() =>
      result.current.mutateAsync({
        month: '2026-03',
        type: 'transfer-category',
        args: { amount: 100, from: 'a', to: 'b', currencyCode: 'USD' },
      }),
    );

    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith({ type: 'haptic' }),
    );
  });

  it('does not tap for a plain budget amount', async () => {
    const { result } = setup();

    await act(() =>
      result.current.mutateAsync({
        month: '2026-03',
        type: 'budget-amount',
        args: { category: 'a', amount: 100 },
      }),
    );

    expect(postMessage).not.toHaveBeenCalled();
  });
});
