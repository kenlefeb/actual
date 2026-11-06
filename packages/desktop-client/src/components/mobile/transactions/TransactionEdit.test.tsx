import { MemoryRouter, Route, Routes } from 'react-router';

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetTestProviders, TestProviders } from '#mocks';
import { initServer } from '#mocks/connection';
import * as modalsSlice from '#modals/modalsSlice';

import { TransactionEdit } from './TransactionEdit';

const state = vi.hoisted(() => ({
  date: '2016-09-15',
  subtransactions: undefined as unknown[] | undefined,
}));

vi.mock(
  '@actual-app/core/platform/client/connection',
  () => import('#mocks/connection'),
);
vi.mock('#queries/aqlQuery', () => ({
  // With grouped splits, a line's id returns its parent with every line
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
        is_parent: !!state.subtransactions,
        subtransactions: state.subtransactions,
      },
    ],
  })),
}));
vi.mock('#hooks/useMetadataPref', () => ({
  useMetadataPref: () => ['cloud-file', vi.fn()],
}));
vi.mock('#hooks/useQuery', () => ({
  useQuery: () => ({ data: [], isLoading: false }),
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

function renderEdit(path: string) {
  return render(
    <TestProviders>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/transactions/:transactionId"
            element={<TransactionEdit />}
          />
        </Routes>
      </MemoryRouter>
    </TestProviders>,
  );
}

async function pickPdf(container: HTMLElement) {
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(
    () => undefined,
  );
  await userEvent.click(
    await screen.findByRole('button', { name: 'Attach document' }),
  );
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: {
      files: [
        new File(['%PDF-1.4'], 'invoice.pdf', { type: 'application/pdf' }),
      ],
    },
  });
}

const confirmModals = (pushModal: { mock: { calls: unknown[][] } }) =>
  (pushModal.mock.calls as Array<[{ modal: modalsSlice.Modal }]>)
    .map(c => c[0].modal)
    .filter((m): m is Confirm => m.name === 'confirm-categorize-moved-history');

describe('Phone transaction edit page', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetTestProviders();
    state.subtransactions = undefined;
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

  it('New transaction on the phone', async () => {
    renderEdit('/transactions/new');

    await screen.findByText('New Transaction');
    expect(
      screen.queryByRole('button', { name: 'Attach document' }),
    ).toBeNull();
  });

  it('Attach without saving on the phone', async () => {
    const add = vi.fn(() => ({ attachment: {} }));
    initServer({ 'transaction-attachment-add': add });
    const { container } = renderEdit('/transactions/t1');

    await pickPdf(container);

    await waitFor(() =>
      expect(add).toHaveBeenCalledWith(
        expect.objectContaining({ transactionId: 't1', name: 'invoice.pdf' }),
      ),
    );
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeVisible();
  });

  it('Attach on a split transaction on the phone', async () => {
    state.subtransactions = [
      {
        id: 'line-1',
        parent_id: 't1',
        is_child: true,
        date: state.date,
        account: 'vanguard',
        amount: -400,
      },
      {
        id: 'line-2',
        parent_id: 't1',
        is_child: true,
        date: state.date,
        account: 'vanguard',
        amount: -600,
      },
    ];
    const add = vi.fn(() => ({ attachment: {} }));
    initServer({ 'transaction-attachment-add': add });
    // Opened from a split line in the list
    const { container } = renderEdit('/transactions/line-2');

    await pickPdf(container);

    await waitFor(() =>
      expect(add).toHaveBeenCalledWith(
        expect.objectContaining({ transactionId: 't1' }),
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
