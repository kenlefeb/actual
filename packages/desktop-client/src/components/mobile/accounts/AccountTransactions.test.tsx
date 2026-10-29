import { MemoryRouter } from 'react-router';

import type {
  AccountEntity,
  PaycheckClearingStatus,
  PaycheckEntity,
} from '@actual-app/core/types/models';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetTestProviders, TestProviders } from '#mocks';

import { AccountTransactions } from './AccountTransactions';

const state = vi.hoisted(() => ({
  paychecksEnabled: true,
  clearing: [] as PaycheckClearingStatus[],
}));

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
      { id: 'checking', name: 'Checking' },
      { id: 'savings', name: 'Savings' },
      { id: 'clearing', name: 'Acme Paycheck' },
    ] as Partial<AccountEntity>[],
  }),
}));
vi.mock('#hooks/usePaychecks', () => ({
  usePaychecks: () => ({ data: [acme] }),
}));
vi.mock('#paychecks', () => ({
  paycheckQueries: {
    clearingStatus: () => ({
      queryKey: ['clearing-status'],
      queryFn: async () => state.clearing,
    }),
  },
}));
vi.mock('#accounts', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSyncAndDownloadMutation: () => ({ mutateAsync: vi.fn() }),
}));
// The register itself loads transactions this test doesn't need
vi.mock('#hooks/useCachedSchedules', () => ({
  SchedulesProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock('#hooks/useTransactions', () => ({
  calculateRunningBalancesTopDown: vi.fn(),
  useTransactions: () => ({
    transactions: [],
    runningBalances: new Map(),
    isPending: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
}));
vi.mock('#hooks/useAccountPreviewTransactions', () => ({
  useAccountPreviewTransactions: () => ({
    previewTransactions: [],
    runningBalances: new Map(),
    isLoading: false,
  }),
}));
vi.mock('#hooks/useSheetValue', () => ({ useSheetValue: () => 0 }));
vi.mock('#components/mobile/transactions/TransactionListWithBalances', () => ({
  TransactionListWithBalances: () => <div data-testid="transaction-list" />,
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

const stillHolding = {
  paycheck: 'acme',
  clearingAccount: 'clearing',
  balance: 225000,
  payDate: '2026-11-13',
  missingDeposits: [
    { id: 'checking', account: 'checking', expectedDate: '2026-11-10' },
    { id: 'savings', account: 'savings', expectedDate: '2026-11-13' },
  ],
  isWarning: true,
} satisfies PaycheckClearingStatus;

const note =
  'Clearing account for paycheck "Acme". It should return to zero after each payday.';
const warning =
  '2,250.00 is still in "Acme Paycheck", waiting on the deposits to Checking and Savings.';

// The innermost element whose whole text is `text`
function textElement(text: string) {
  return screen
    .getAllByText((_, element) => element?.textContent === text)
    .at(-1) as HTMLElement;
}

function renderAccount(id: string, name: string) {
  render(
    <TestProviders>
      <MemoryRouter>
        <AccountTransactions account={{ id, name } as AccountEntity} />
      </MemoryRouter>
    </TestProviders>,
  );
}

describe('AccountTransactions', () => {
  beforeEach(() => {
    resetTestProviders();
    state.paychecksEnabled = true;
    state.clearing = [];
  });

  it('Acme Paycheck is marked on a phone', () => {
    renderAccount('clearing', 'Acme Paycheck');
    expect(screen.getByRole('complementary')).toHaveTextContent(note);
    // Above the transactions
    expect(
      screen
        .getByRole('complementary')
        .compareDocumentPosition(screen.getByTestId('transaction-list')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('Acme Paycheck still holds 2,250.00 after payday on a phone', async () => {
    state.clearing = [stillHolding];
    renderAccount('clearing', 'Acme Paycheck');
    await waitFor(() =>
      expect(screen.getByRole('complementary')).toHaveTextContent(warning),
    );
    const shownWarning = textElement(warning);
    const shownNote = textElement(note);
    // Its own block after the note, not inside the note's sentence
    expect(shownWarning.closest('div')).not.toContainElement(shownNote);
    expect(
      shownNote.compareDocumentPosition(shownWarning) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('No warning on a phone while imports may still arrive', async () => {
    state.clearing = [{ ...stillHolding, isWarning: false }];
    renderAccount('clearing', 'Acme Paycheck');
    expect(screen.getByRole('complementary')).toHaveTextContent(note);
    await waitFor(() =>
      expect(screen.getByRole('complementary')).not.toHaveTextContent(
        'is still in',
      ),
    );
  });

  it('Checking is not marked on a phone', () => {
    renderAccount('checking', 'Checking');
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('Not marked with paychecks turned off', () => {
    state.paychecksEnabled = false;
    state.clearing = [stillHolding];
    renderAccount('clearing', 'Acme Paycheck');
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });
});
