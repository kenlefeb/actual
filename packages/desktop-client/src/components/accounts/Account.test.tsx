import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { Account } from './Account';

vi.mock('@actual-app/core/platform/client/connection', async importActual => ({
  ...(await importActual<object>()),
  send: vi.fn(async (name: string) =>
    name === 'make-filters-from-conditions'
      ? { filters: [] }
      : { name: 'cell', value: 0 },
  ),
  listen: () => vi.fn(),
}));

// These tests pin how the desktop register reacts to a tag click: the
// register adds `notes hasTags '#tag'` to the list it is showing. The heavy
// children are stubs; they only report what the register passed them.
vi.mock('#queries/pagedQuery', () => ({
  pagedQuery: () => ({
    query: { select: () => ({}) },
    hasNext: false,
    totalCount: 0,
    run: vi.fn(),
    unsubscribe: vi.fn(),
    fetchNext: vi.fn(),
    optimisticUpdate: vi.fn(),
  }),
}));
vi.mock('#queries/aqlQuery', () => ({
  aqlQuery: async () => ({ data: [], dependencies: [] }),
}));
vi.mock('#hooks/useAccountPreviewTransactions', () => {
  const result = {
    previewTransactions: [],
    runningBalances: new Map(),
    isLoading: false,
  };
  return { useAccountPreviewTransactions: () => result };
});
vi.mock('#hooks/useCachedSchedules', () => ({
  SchedulesProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('#hooks/useTransactionFilters', () => {
  const filters: never[] = [];
  return { useTransactionFilters: () => filters };
});
vi.mock('#hooks/useTransactionTableColumns', async importOriginal => {
  const result = {
    transactionColumns: [],
    columnOrder: [],
    showBalances: false,
    showCleared: false,
    showGroup: false,
    saveColumns: vi.fn(),
  };
  return {
    ...(await importOriginal<object>()),
    useTransactionTableColumns: () => result,
  };
});
vi.mock('#hooks/useAccounts', () => {
  const result = { data: [{ id: 'checking', name: 'Checking' }] };
  return { useAccounts: () => result };
});
vi.mock('#hooks/useCategories', () => {
  const result = { data: { grouped: [], list: [] } };
  return { useCategories: () => result };
});
vi.mock('#hooks/usePayees', () => {
  const result = { data: [] };
  return { usePayees: () => result };
});
vi.mock('#hooks/useDateFormat', () => ({ useDateFormat: () => 'yyyy-MM-dd' }));
vi.mock('#hooks/useLocalPref', () => {
  const result = [undefined, vi.fn()];
  return { useLocalPref: () => result };
});
vi.mock('#hooks/useSyncedPref', () => {
  const result = [undefined, vi.fn()];
  return { useSyncedPref: () => result };
});
vi.mock('#components/schedules/ClearingAccount', () => ({
  ClearingAccountNote: () => null,
}));
vi.mock('./Header', () => ({
  AccountHeader: ({
    filterConditions,
  }: {
    filterConditions: { field: string; op: string; value: string }[];
  }) => (
    <ul aria-label="Filter pills">
      {filterConditions.map(c => (
        <li key={`${c.field}${c.op}${c.value}`}>
          {`${c.field} ${c.op} ${c.value}`}
        </li>
      ))}
    </ul>
  ),
}));
vi.mock('#components/transactions/TransactionList', () => ({
  TransactionList: ({
    onApplyFilter,
  }: {
    onApplyFilter: (condition: unknown) => void;
  }) => (
    <>
      {['#vacation', '#work'].map(tag => (
        <button
          key={tag}
          type="button"
          onClick={() =>
            onApplyFilter({
              field: 'notes',
              op: 'hasTags',
              value: tag,
              type: 'string',
            })
          }
        >
          {tag}
        </button>
      ))}
    </>
  ),
}));

function renderRegister(path: string) {
  render(
    <TestProviders>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/accounts/:id" element={<Account />} />
          <Route path="/accounts" element={<Account />} />
        </Routes>
      </MemoryRouter>
    </TestProviders>,
  );
}

describe('Account register tag filter (desktop)', () => {
  describe.each([
    ['a single account', '/accounts/checking'],
    ['all accounts', '/accounts'],
  ])('in %s', (_name, path) => {
    it('clicking a tag adds a notes hasTags pill', async () => {
      renderRegister(path);
      await userEvent.click(
        await screen.findByRole('button', { name: '#vacation' }),
      );
      expect(
        await screen.findByText('notes hasTags #vacation'),
      ).toBeInTheDocument();
    });

    it('the same tag twice is not duplicated', async () => {
      renderRegister(path);
      const tag = await screen.findByRole('button', { name: '#vacation' });
      await userEvent.click(tag);
      await userEvent.click(tag);
      expect(
        await screen.findAllByText('notes hasTags #vacation'),
      ).toHaveLength(1);
    });

    it('a second tag stacks as a second pill', async () => {
      renderRegister(path);
      await userEvent.click(
        await screen.findByRole('button', { name: '#vacation' }),
      );
      await userEvent.click(screen.getByRole('button', { name: '#work' }));
      expect(
        await screen.findByText('notes hasTags #work'),
      ).toBeInTheDocument();
      expect(screen.getByText('notes hasTags #vacation')).toBeInTheDocument();
    });
  });
});
