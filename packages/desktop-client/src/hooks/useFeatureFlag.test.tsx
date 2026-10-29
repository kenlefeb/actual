import type { ReactNode } from 'react';

import * as connection from '@actual-app/core/platform/client/connection';
import type { SyncedPrefs } from '@actual-app/core/types/prefs';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestAppStore, resetTestProviders, TestProviders } from '#mocks';
import { mergeSyncedPrefs } from '#prefs/prefsSlice';

import { useFeatureFlag } from './useFeatureFlag';

let paychecks: Array<{ id: string }> = [];

function renderPaychecksFlag(prefs: SyncedPrefs) {
  const store = createTestAppStore();
  store.dispatch(mergeSyncedPrefs(prefs));
  return renderHook(() => useFeatureFlag('paychecks'), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <TestProviders store={store}>{children}</TestProviders>
    ),
  });
}

describe('useFeatureFlag("paychecks")', () => {
  beforeEach(() => {
    resetTestProviders();
    paychecks = [];
    vi.spyOn(connection, 'send').mockImplementation((async (name: string) =>
      name === 'paychecks-get'
        ? paychecks
        : undefined) as typeof connection.send);
  });

  it('is off when unset with no calendars or paychecks', async () => {
    const { result } = renderPaychecksFlag({});
    await waitFor(() =>
      expect(connection.send).toHaveBeenCalledWith('paychecks-get'),
    );
    expect(result.current).toBe(false);
  });

  it('is on when unset and business calendars are on', () => {
    const { result } = renderPaychecksFlag({
      'flags.businessCalendars': 'true',
    });
    expect(result.current).toBe(true);
  });

  it('is on when unset and a paycheck exists (upgrade)', async () => {
    paychecks = [{ id: 'acme' }];
    const { result } = renderPaychecksFlag({});
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('stays off when explicitly turned off', async () => {
    paychecks = [{ id: 'acme' }];
    const { result } = renderPaychecksFlag({
      'flags.paychecks': 'false',
      'flags.businessCalendars': 'true',
    });
    expect(result.current).toBe(false);
    expect(connection.send).not.toHaveBeenCalledWith('paychecks-get');
  });
});
