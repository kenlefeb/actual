import type { AccountEntity } from '@actual-app/core/types/models';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetTestProviders, TestProviders } from '#mocks';

import { AccountMenu } from './Header';

const state = vi.hoisted(() => ({ businessCalendars: false }));

vi.mock('#hooks/useFeatureFlag', () => ({
  useFeatureFlag: (flag: string) =>
    flag === 'businessCalendars' && state.businessCalendars,
}));

vi.mock('#hooks/useSyncServerStatus', () => ({
  useSyncServerStatus: () => 'no-server',
}));

const checking = {
  id: 'checking',
  name: 'Checking',
  offbudget: 0,
  closed: 0,
  sort_order: 0,
  last_reconciled: null,
  tombstone: 0,
  account_group_id: null,
  account_id: null,
  bank: null,
  bankName: null,
  bankId: null,
  mask: null,
  official_name: null,
  balance_current: null,
  balance_available: null,
  balance_limit: null,
  account_sync_source: null,
  last_sync: null,
  bank_sync_status: null,
} satisfies AccountEntity;

function renderMenu(account: AccountEntity = checking) {
  render(
    <TestProviders>
      <AccountMenu
        account={account}
        canSync={false}
        showNetWorthChart={false}
        showReconciled={false}
        isSorted={false}
        onMenuSelect={vi.fn()}
      />
    </TestProviders>,
  );
}

describe('account menu', () => {
  beforeEach(() => {
    resetTestProviders();
    state.businessCalendars = false;
  });

  it('Hidden when the feature is off: the account menu does not offer "Business days"', () => {
    renderMenu();
    expect(screen.getByText('Export')).toBeInTheDocument();
    expect(screen.queryByText('Business days')).not.toBeInTheDocument();
  });

  it('offers "Business days" when the feature is on', () => {
    state.businessCalendars = true;
    renderMenu();
    expect(screen.getByText('Business days')).toBeInTheDocument();
  });

  it('Menu option on desktop: offers "Move on budget…" for an open off-budget account', () => {
    renderMenu({ ...checking, offbudget: 1 });
    expect(screen.getByText('Move on budget…')).toBeInTheDocument();
  });

  it('Not offered for on-budget or closed accounts', () => {
    renderMenu();
    expect(screen.queryByText('Move on budget…')).not.toBeInTheDocument();
  });

  it('Not offered for a closed off-budget account', () => {
    renderMenu({ ...checking, offbudget: 1, closed: 1 });
    expect(screen.queryByText('Move on budget…')).not.toBeInTheDocument();
  });
});
