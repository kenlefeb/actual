import { MemoryRouter, Route, Routes } from 'react-router';

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetTestProviders, TestProviders } from '#mocks';
import * as modalsSlice from '#modals/modalsSlice';

import { TransactionEdit } from './TransactionEdit';

const state = vi.hoisted(() => ({ date: '2016-09-15' }));

vi.mock(
  '@actual-app/core/platform/client/connection',
  () => import('#mocks/connection'),
);
vi.mock('#queries/aqlQuery', () => ({
  aqlQuery: vi.fn(async () => ({
    data: [
      {
        id: 't1',
        date: state.date,
        account: 'vanguard',
        amount: -1000,
        category: null,
        payee: null,
        notes: '',
        cleared: false,
      },
    ],
  })),
}));
vi.mock('#hooks/useAccounts', () => ({
  useAccounts: () => ({
    data: [
      {
        id: 'vanguard',
        name: 'Vanguard',
        offbudget: 0,
        budget_start_date: '2016-10-01',
        budget_start_offset: null,
      },
    ],
  }),
}));
vi.mock('#hooks/useCategories', () => ({
  useCategories: () => ({
    data: {
      list: [{ id: 'groceries', name: 'Groceries' }],
      grouped: [],
    },
  }),
}));
vi.mock('#hooks/usePayees', () => ({ usePayees: () => ({ data: [] }) }));
vi.mock('#hooks/useDateFormat', () => ({
  useDateFormat: () => 'MM/dd/yyyy',
}));
vi.mock('#hooks/useLocalPref', () => ({
  useLocalPref: () => [false, vi.fn()],
}));
vi.mock('#hooks/useSyncedPref', () => ({
  useSyncedPref: () => [undefined, vi.fn()],
}));
vi.mock('#hooks/useLocationPermission', () => ({
  useLocationPermission: () => ({
    isGranted: false,
    isPending: false,
    requestPermission: vi.fn(),
  }),
}));
vi.mock('#hooks/useNearbyPayees', () => ({
  useNearbyPayees: () => ({ data: [] }),
}));

type Sheet = Extract<modalsSlice.Modal, { name: 'category-autocomplete' }>;
type Confirm = Extract<
  modalsSlice.Modal,
  { name: 'confirm-categorize-moved-history' }
>;

async function openCategorySheet() {
  const pushModal = vi.spyOn(modalsSlice, 'pushModal');
  render(
    <TestProviders>
      <MemoryRouter initialEntries={['/transactions/t1']}>
        <Routes>
          <Route
            path="/transactions/:transactionId"
            element={<TransactionEdit />}
          />
        </Routes>
      </MemoryRouter>
    </TestProviders>,
  );
  await userEvent.click(await screen.findByTestId('category-field'));
  const sheet = pushModal.mock.calls
    .map(c => c[0].modal)
    .find((m): m is Sheet => m.name === 'category-autocomplete')!;
  return { pushModal, options: sheet.options };
}

const confirmModals = (pushModal: { mock: { calls: unknown[][] } }) =>
  (pushModal.mock.calls as Array<[{ modal: modalsSlice.Modal }]>)
    .map(c => c[0].modal)
    .filter((m): m is Confirm => m.name === 'confirm-categorize-moved-history');

describe('Phone transaction edit page', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetTestProviders();
  });

  it('asks before categorizing moved history; Cancel leaves it uncategorized', async () => {
    state.date = '2016-09-15';
    const { pushModal, options } = await openCategorySheet();
    await act(async () => {
      options.onSelect('groceries', 'Groceries');
      options.onClose?.();
    });
    expect(confirmModals(pushModal)).toHaveLength(1);
    // Cancel never calls onConfirm
    expect(screen.queryByText('Groceries')).not.toBeInTheDocument();
  });

  it('Categorize anyway sets the category', async () => {
    state.date = '2016-09-15';
    const { pushModal, options } = await openCategorySheet();
    await act(async () => {
      options.onSelect('groceries', 'Groceries');
      options.onClose?.();
    });
    await act(async () => confirmModals(pushModal)[0].options.onConfirm());
    await waitFor(() =>
      expect(screen.getByTestId('category-field')).toHaveTextContent(
        'Groceries',
      ),
    );
  });

  it('does not ask from the start date on', async () => {
    state.date = '2016-10-05';
    const { pushModal, options } = await openCategorySheet();
    await act(async () => {
      options.onSelect('groceries', 'Groceries');
      options.onClose?.();
    });
    expect(confirmModals(pushModal)).toHaveLength(0);
    await waitFor(() =>
      expect(screen.getByTestId('category-field')).toHaveTextContent(
        'Groceries',
      ),
    );
  });
});
