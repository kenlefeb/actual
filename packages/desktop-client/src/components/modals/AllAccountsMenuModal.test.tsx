import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { AllAccountsMenuModal } from './AllAccountsMenuModal';

const state = vi.hoisted(() => ({ amazon: false }));

vi.mock('@actual-app/components/hooks/useResponsive', () => ({
  useResponsive: () => ({ isNarrowWidth: true }),
}));
vi.mock('#hooks/useSyncedPref', () => ({
  useSyncedPref: () => [undefined, vi.fn()],
}));
vi.mock('#hooks/useFeatureFlag', () => ({
  useFeatureFlag: (name: string) =>
    name === 'amazonOrderItemization' ? state.amazon : false,
}));

function renderMenu() {
  render(
    <TestProviders>
      <AllAccountsMenuModal />
    </TestProviders>,
  );
}

describe('AllAccountsMenuModal', () => {
  beforeEach(() => {
    state.amazon = false;
    window.Actual = {
      ...window.Actual,
      // The user cancels the picker
      openFileDialog: vi.fn(async () => []),
    };
  });

  it('Hidden on the phone when the feature is off', () => {
    renderMenu();

    expect(
      screen.queryByRole('button', { name: 'Import Amazon orders' }),
    ).not.toBeInTheDocument();
  });

  it('Offered on the phone when the feature is on', async () => {
    state.amazon = true;
    renderMenu();

    await userEvent.click(
      screen.getByRole('button', { name: 'Import Amazon orders' }),
    );

    await waitFor(() =>
      expect(window.Actual.openFileDialog).toHaveBeenCalledWith({
        filters: [expect.objectContaining({ extensions: ['csv'] }) as unknown],
      }),
    );
  });
});
