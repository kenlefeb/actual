import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { AccountMenuModal } from './AccountMenuModal';

const state = vi.hoisted(() => ({
  account: { id: 'checking', name: 'Checking', closed: false },
  businessCalendars: true,
}));

vi.mock('@actual-app/components/hooks/useResponsive', () => ({
  useResponsive: () => ({ isNarrowWidth: true }),
}));
vi.mock('#hooks/useAccount', () => ({ useAccount: () => state.account }));
vi.mock('#hooks/useAccounts', () => ({
  useAccounts: () => ({ data: [state.account] }),
}));
vi.mock('#hooks/useNotes', () => ({ useNotes: () => null }));
vi.mock('#hooks/useSyncedPref', () => ({
  useSyncedPref: () => [undefined, vi.fn()],
}));
vi.mock('#hooks/useFeatureFlag', () => ({
  useFeatureFlag: (name: string) =>
    name === 'businessCalendars' ? state.businessCalendars : false,
}));

function renderMenu(onEditBusinessDays = vi.fn()) {
  render(
    <TestProviders>
      <AccountMenuModal
        accountId="checking"
        onSave={vi.fn()}
        onCloseAccount={vi.fn()}
        onReopenAccount={vi.fn()}
        onEditNotes={vi.fn()}
        onReconcile={vi.fn()}
        onEditBusinessDays={onEditBusinessDays}
      />
    </TestProviders>,
  );
  return onEditBusinessDays;
}

function rowLabels() {
  return screen.getAllByRole('button').map(button => button.textContent);
}

describe('AccountMenuModal', () => {
  beforeEach(() => {
    state.businessCalendars = true;
  });

  it('offers Business days after Reconcile and opens it for the account', async () => {
    const onEditBusinessDays = renderMenu();
    const labels = rowLabels();
    expect(labels.indexOf('Business days')).toBe(
      labels.indexOf('Reconcile') + 1,
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Business days' }),
    );
    expect(onEditBusinessDays).toHaveBeenCalledWith('checking');
  });

  it('hides Business days when the feature is off', () => {
    state.businessCalendars = false;
    renderMenu();
    expect(
      screen.queryByRole('button', { name: 'Business days' }),
    ).not.toBeInTheDocument();
  });
});
