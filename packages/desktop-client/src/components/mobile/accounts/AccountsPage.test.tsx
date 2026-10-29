import { MemoryRouter } from 'react-router';

import type {
  AccountEntity,
  PaycheckEntity,
} from '@actual-app/core/types/models';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { AccountsPage } from './AccountsPage';

const state = vi.hoisted(() => ({ paychecksEnabled: true }));

vi.mock('@actual-app/components/hooks/useResponsive', () => ({
  useResponsive: () => ({ isNarrowWidth: true, isWideWidth: false }),
}));
vi.mock('#hooks/useFeatureFlag', () => ({
  useFeatureFlag: (name: string) =>
    name === 'paychecks' ? state.paychecksEnabled : false,
}));
vi.mock('#hooks/useAccounts', () => ({
  useAccounts: () => ({
    data: [
      { id: 'checking', name: 'Checking', offbudget: 0, closed: 0 },
      { id: 'clearing', name: 'Acme Paycheck', offbudget: 0, closed: 0 },
    ] as Partial<AccountEntity>[],
  }),
}));
vi.mock('#hooks/usePaychecks', () => ({
  usePaychecks: () => ({ data: [acme] }),
}));
vi.mock('#accounts', () => ({
  useMoveAccountMutation: () => ({ mutate: vi.fn() }),
  useSyncAndDownloadMutation: () => ({ mutateAsync: vi.fn() }),
}));
// Balances come from the spreadsheet, which these tests don't load
vi.mock('#components/spreadsheet/CellValue', () => ({
  CellValue: () => null,
  CellValueText: () => null,
}));

const acme = {
  id: 'acme',
  name: 'Acme',
  definition: {
    payee: null,
    clearingAccount: 'clearing',
    date: { start: '2026-11-01', frequency: 'monthly' },
    weekendSolveMode: 'before',
    grossAmount: 300000,
    incomeCategory: null,
    deductions: [],
    deposits: [
      { id: 'checking', account: 'checking', kind: 'remainder', value: 0 },
    ],
  },
} satisfies PaycheckEntity;

const label = 'Clearing account for paycheck "Acme"';

function renderPage() {
  render(
    <TestProviders>
      <MemoryRouter>
        <AccountsPage />
      </MemoryRouter>
    </TestProviders>,
  );
}

function row(name: string) {
  return screen
    .getAllByTestId('account-list-item')
    .find(
      item =>
        item.querySelector('[data-testid="account-name"]')?.textContent ===
        name,
    );
}

describe('AccountsPage', () => {
  beforeEach(() => {
    state.paychecksEnabled = true;
  });

  it('Acme Paycheck is marked on a phone', () => {
    renderPage();
    expect(row('Acme Paycheck')).toHaveTextContent(label);
    // The label stays outside the name, so the name reads cleanly
    expect(
      row('Acme Paycheck')?.querySelector('[data-testid="account-name"]'),
    ).toHaveTextContent(/^Acme Paycheck$/);
  });

  it('Checking is not marked on a phone', () => {
    renderPage();
    expect(row('Checking')).not.toHaveTextContent(label);
  });

  it('Not marked with paychecks turned off', () => {
    state.paychecksEnabled = false;
    renderPage();
    expect(row('Acme Paycheck')).not.toHaveTextContent(label);
    expect(row('Checking')).not.toHaveTextContent(label);
  });
});
