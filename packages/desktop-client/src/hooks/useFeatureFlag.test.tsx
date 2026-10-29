import type { ReactNode } from 'react';

import * as connection from '@actual-app/core/platform/client/connection';
import type { SyncedPrefs } from '@actual-app/core/types/prefs';
import { renderHook } from '@testing-library/react';
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

  it('is off when unset with no calendars or paychecks', () => {
    const { result } = renderPaychecksFlag({});
    expect(result.current).toBe(false);
  });

  it('is on when unset and business calendars are on', () => {
    const { result } = renderPaychecksFlag({
      'flags.businessCalendars': 'true',
    });
    expect(result.current).toBe(true);
  });

  it('Upgrade with business calendars off: unset paychecks with a paycheck is off', () => {
    paychecks = [{ id: 'acme' }];
    for (const prefs of [{}, { 'flags.businessCalendars': 'false' }]) {
      const { result } = renderPaychecksFlag(prefs);
      expect(result.current).toBe(false);
    }
    expect(connection.send).not.toHaveBeenCalledWith('paychecks-get');
  });

  it('Acme stays hidden while business calendars are off: paychecks on needs business calendars on', () => {
    const { result } = renderPaychecksFlag({
      'flags.paychecks': 'true',
      'flags.businessCalendars': 'false',
    });
    expect(result.current).toBe(false);
  });

  it('is on when set on with business calendars on', () => {
    const { result } = renderPaychecksFlag({
      'flags.paychecks': 'true',
      'flags.businessCalendars': 'true',
    });
    expect(result.current).toBe(true);
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
