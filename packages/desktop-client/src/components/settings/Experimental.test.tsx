import * as connection from '@actual-app/core/platform/client/connection';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestAppStore, resetTestProviders, TestProviders } from '#mocks';
import { mergeSyncedPrefs } from '#prefs/prefsSlice';

import { ExperimentalFeatures } from './Experimental';

let paychecks: Array<{ id: string }> = [];

function renderSettings(prefs: Record<string, string>) {
  const store = createTestAppStore();
  store.dispatch(mergeSyncedPrefs(prefs));
  render(
    <TestProviders store={store}>
      <ExperimentalFeatures />
    </TestProviders>,
  );
  return store;
}

const LOCK_NOTE =
  'Paychecks use business calendars. Delete your paychecks to turn this off.';

describe('ExperimentalFeatures paychecks toggle', () => {
  beforeEach(() => {
    resetTestProviders();
    paychecks = [];
    vi.spyOn(connection, 'send').mockImplementation((async (name: string) =>
      name === 'paychecks-get'
        ? paychecks
        : undefined) as typeof connection.send);
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

  it('Turning off business calendars with no paycheck turns off paychecks', async () => {
    const store = renderSettings({
      'flags.paychecks': 'true',
      'flags.businessCalendars': 'true',
    });

    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Business calendars' }),
    );

    await waitFor(() =>
      expect(store.getState().prefs.synced).toMatchObject({
        'flags.paychecks': 'false',
        'flags.businessCalendars': 'false',
      }),
    );
  });

  it("Can't turn off while the Acme paycheck exists", async () => {
    paychecks = [{ id: 'acme' }];
    renderSettings({
      'flags.paychecks': 'true',
      'flags.businessCalendars': 'true',
    });

    const toggle = screen.getByRole('checkbox', { name: 'Business calendars' });
    // The toggle is also disabled while paychecks load; the note means loaded
    expect(await screen.findByText(LOCK_NOTE)).toBeInTheDocument();
    expect(toggle).toBeDisabled();
    expect(toggle).toBeChecked();
    // Screen readers can't focus a disabled checkbox, so the note describes it
    expect(toggle).toHaveAccessibleDescription(LOCK_NOTE);
  });

  it('Unlocked after the last paycheck is deleted', async () => {
    renderSettings({
      'flags.paychecks': 'true',
      'flags.businessCalendars': 'true',
    });

    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', { name: 'Business calendars' }),
      ).toBeEnabled(),
    );
    expect(screen.queryByText(LOCK_NOTE)).not.toBeInTheDocument();
  });

  it('can turn business calendars on in a budget left with a paycheck and calendars off', async () => {
    paychecks = [{ id: 'acme' }];
    const store = renderSettings({ 'flags.businessCalendars': 'false' });

    await waitFor(() =>
      expect(connection.send).toHaveBeenCalledWith('paychecks-get'),
    );
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Business calendars' }),
    );

    await waitFor(() =>
      expect(store.getState().prefs.synced['flags.businessCalendars']).toBe(
        'true',
      ),
    );
  });

  it('keeps business calendars locked while paychecks are still loading', async () => {
    let finishLoading: ((list: Array<{ id: string }>) => void) | undefined;
    vi.spyOn(connection, 'send').mockImplementation((async (name: string) =>
      name === 'paychecks-get'
        ? new Promise<Array<{ id: string }>>(resolve => {
            finishLoading = resolve;
          })
        : undefined) as typeof connection.send);
    renderSettings({
      'flags.paychecks': 'true',
      'flags.businessCalendars': 'true',
    });
    const toggle = screen.getByRole('checkbox', { name: 'Business calendars' });

    expect(toggle).toBeDisabled();
    expect(screen.queryByText(LOCK_NOTE)).not.toBeInTheDocument();

    finishLoading?.([]);
    await waitFor(() => expect(toggle).toBeEnabled());
  });
});
