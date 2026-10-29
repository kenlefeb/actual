import type {
  AccountEntity,
  PaycheckClearingStatus,
  PaycheckEntity,
} from '@actual-app/core/types/models';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetTestProviders, TestProviders } from '#mocks';

import { ClearingAccountIcon, ClearingAccountNote } from './ClearingAccount';

const state = vi.hoisted(() => ({
  isEnabled: true,
  paychecks: [] as PaycheckEntity[],
  clearing: [] as PaycheckClearingStatus[],
}));

vi.mock('#hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => state.isEnabled,
}));

vi.mock('#hooks/usePaychecks', () => ({
  usePaychecks: () => ({ data: state.paychecks }),
}));

vi.mock('#hooks/useAccounts', () => ({
  useAccounts: () => ({
    data: [
      { id: 'checking', name: 'Checking' },
      { id: 'savings', name: 'Savings' },
      { id: 'clearing', name: 'Acme Paycheck' },
    ] as Partial<AccountEntity>[],
  }),
}));

vi.mock('#paychecks', () => ({
  paycheckQueries: {
    clearingStatus: () => ({
      queryKey: ['clearing-status'],
      queryFn: async () => state.clearing,
    }),
  },
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
      { id: 'savings', account: 'savings', kind: 'percent', value: 10 },
      { id: 'checking', account: 'checking', kind: 'remainder', value: 0 },
    ],
  },
} satisfies PaycheckEntity;

const missingChecking = {
  paycheck: 'acme',
  clearingAccount: 'clearing',
  balance: 202500,
  payDate: '2026-11-13',
  missingDeposits: [
    { id: 'checking', account: 'checking', expectedDate: '2026-11-10' },
  ],
  isWarning: true,
} satisfies PaycheckClearingStatus;

const note =
  'Clearing account for paycheck "Acme". It should return to zero after each payday.';

describe('clearing accounts', () => {
  beforeEach(() => {
    resetTestProviders();
    state.isEnabled = true;
    state.paychecks = [acme];
    state.clearing = [];
  });

  it('marks a clearing account with a paycheck icon', () => {
    render(
      <TestProviders>
        <ClearingAccountIcon accountId="clearing" />
        <ClearingAccountIcon accountId="checking" />
      </TestProviders>,
    );
    expect(
      screen.getAllByText('Clearing account for paycheck "Acme"'),
    ).toHaveLength(1);
  });

  it('marks nothing with the feature off', () => {
    state.isEnabled = false;
    render(
      <TestProviders>
        <ClearingAccountIcon accountId="clearing" />
        <ClearingAccountNote accountId="clearing" />
      </TestProviders>,
    );
    expect(screen.queryByText(/Clearing account/)).not.toBeInTheDocument();
    expect(screen.queryByText(note)).not.toBeInTheDocument();
  });

  it('notes in the register that the account returns to zero', () => {
    render(
      <TestProviders>
        <ClearingAccountNote accountId="clearing" />
      </TestProviders>,
    );
    expect(screen.getByRole('complementary')).toHaveTextContent(note);
  });

  it('warns in the register about the balance and the missing deposit', async () => {
    state.clearing = [missingChecking];
    render(
      <TestProviders>
        <ClearingAccountNote accountId="clearing" />
      </TestProviders>,
    );
    await waitFor(() =>
      expect(screen.getByRole('complementary')).toHaveTextContent(
        '2,025.00 is still in "Acme Paycheck", waiting on the deposit to Checking.',
      ),
    );
  });

  it('names every missing deposit', async () => {
    state.clearing = [
      {
        ...missingChecking,
        balance: 225000,
        missingDeposits: [
          { id: 'savings', account: 'savings', expectedDate: '2026-11-13' },
          ...missingChecking.missingDeposits,
        ],
      },
    ];
    render(
      <TestProviders>
        <ClearingAccountNote accountId="clearing" />
      </TestProviders>,
    );
    await waitFor(() =>
      expect(screen.getByRole('complementary')).toHaveTextContent(
        'waiting on the deposits to Savings and Checking.',
      ),
    );
  });
});
