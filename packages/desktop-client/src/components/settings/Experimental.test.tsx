import * as connection from '@actual-app/core/platform/client/connection';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestAppStore, resetTestProviders, TestProviders } from '#mocks';
import { mergeSyncedPrefs } from '#prefs/prefsSlice';

import { ExperimentalFeatures } from './Experimental';

describe('ExperimentalFeatures paychecks toggle', () => {
  beforeEach(() => {
    resetTestProviders();
    vi.spyOn(connection, 'send').mockImplementation((async (name: string) =>
      name === 'paychecks-get' ? [] : undefined) as typeof connection.send);
  });

  it('turns on business calendars with paychecks', async () => {
    const store = createTestAppStore();
    store.dispatch(
      mergeSyncedPrefs({
        'flags.paychecks': 'false',
        'flags.businessCalendars': 'false',
      }),
    );
    render(
      <TestProviders store={store}>
        <ExperimentalFeatures />
      </TestProviders>,
    );

    await userEvent.click(screen.getByRole('checkbox', { name: 'Paychecks' }));

    await waitFor(() =>
      expect(store.getState().prefs.synced).toMatchObject({
        'flags.paychecks': 'true',
        'flags.businessCalendars': 'true',
      }),
    );
  });

  it('leaves business calendars on when paychecks is turned off', async () => {
    const store = createTestAppStore();
    store.dispatch(
      mergeSyncedPrefs({
        'flags.paychecks': 'true',
        'flags.businessCalendars': 'true',
      }),
    );
    render(
      <TestProviders store={store}>
        <ExperimentalFeatures />
      </TestProviders>,
    );

    await userEvent.click(screen.getByRole('checkbox', { name: 'Paychecks' }));

    await waitFor(() =>
      expect(store.getState().prefs.synced['flags.paychecks']).toBe('false'),
    );
    expect(store.getState().prefs.synced['flags.businessCalendars']).toBe(
      'true',
    );
  });
});
