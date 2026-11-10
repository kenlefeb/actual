import { MemoryRouter, Route, Routes } from 'react-router';

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestAppStore, resetTestProviders, TestProviders } from '#mocks';
import { initServer } from '#mocks/connection';
import * as modalsSlice from '#modals/modalsSlice';

import { TransactionEdit } from './TransactionEdit';

const state = vi.hoisted(() => ({
  date: '2016-09-15',
  subtransactions: undefined as unknown[] | undefined,
  notes: '',
  cloudFileId: 'cloud-file' as string | undefined,
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
        notes: state.notes,
        cleared: false,
        is_parent: !!state.subtransactions,
        subtransactions: state.subtransactions,
      },
    ],
  })),
}));
vi.mock('#hooks/useMetadataPref', () => ({
  useMetadataPref: () => [state.cloudFileId, vi.fn()],
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

const store = vi.hoisted(() => ({ current: undefined as unknown }));

function renderEdit(path: string) {
  const appStore = createTestAppStore();
  store.current = appStore;
  return render(
    <TestProviders store={appStore}>
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

const messages = () =>
  (store.current as ReturnType<typeof createTestAppStore>)
    .getState()
    .notifications.notifications.map(n => n.message ?? '')
    .join('\n');

const confirmModals = (pushModal: { mock: { calls: unknown[][] } }) =>
  (pushModal.mock.calls as Array<[{ modal: modalsSlice.Modal }]>)
    .map(c => c[0].modal)
    .filter((m): m is Confirm => m.name === 'confirm-categorize-moved-history');

describe('Phone transaction edit page', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetTestProviders();
    state.subtransactions = undefined;
    state.notes = '';
    state.cloudFileId = 'cloud-file';
    window.innerWidth = 1024;
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

  describe('Documents while adding', () => {
    const addPath = '/transactions/new?account=Vanguard';
    const checkOk = () => ({ ok: true });

    function serve(handlers: Record<string, (args: never) => unknown> = {}) {
      const update = vi.fn(() => ({ added: [], updated: [] }));
      initServer({
        'transaction-attachment-check': checkOk,
        'transactions-batch-update': update,
        ...handlers,
      } as Parameters<typeof initServer>[0]);
      return update;
    }

    const heldName = (name: string) => screen.findByText(name);

    it('New transaction on the phone', async () => {
      const { container } = renderEdit(addPath);
      const check = vi.fn(checkOk);
      const addOne = vi.fn();
      serve({
        'transaction-attachment-check': check,
        'transaction-attachment-add': addOne,
      });

      await pickPdf(container);

      expect(await heldName('invoice.pdf')).toBeVisible();
      expect(check).toHaveBeenCalledOnce();
      // Held on the device: nothing uploaded
      expect(addOne).not.toHaveBeenCalled();
    });

    it('Remove a held document', async () => {
      const { container } = renderEdit(addPath);
      serve();
      await pickPdf(container);
      await heldName('invoice.pdf');

      await userEvent.click(
        screen.getByRole('button', { name: 'Remove invoice.pdf' }),
      );

      expect(screen.queryByText('invoice.pdf')).toBeNull();
    });

    it('Refused when picked', async () => {
      const { container } = renderEdit(addPath);
      serve({
        'transaction-attachment-check': () => ({ error: 'unsupported-type' }),
      });

      await pickPdf(container);

      await waitFor(() =>
        expect(messages()).toContain(
          'Only PDF, JPEG, PNG and WebP documents can be attached.',
        ),
      );
      expect(screen.queryByText('invoice.pdf')).toBeNull();
    });

    it('Local-only budget while adding', async () => {
      state.cloudFileId = undefined;
      const click = vi
        .spyOn(HTMLInputElement.prototype, 'click')
        .mockImplementation(() => undefined);
      serve();
      renderEdit(addPath);

      await userEvent.click(
        await screen.findByRole('button', { name: 'Attach document' }),
      );

      expect(click).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(messages()).toContain(
          'Attaching documents needs a sync server.',
        ),
      );
    });

    it('Offline pick', async () => {
      const { container } = renderEdit(addPath);
      serve({
        'transaction-attachment-check': () => ({ error: 'upload-failed' }),
      });

      await pickPdf(container);

      await waitFor(() =>
        expect(messages()).toContain('Check your connection'),
      );
      expect(screen.queryByText('invoice.pdf')).toBeNull();
    });

    it('Sixth document', async () => {
      const { container } = renderEdit(addPath);
      serve();
      for (let i = 0; i < 5; i++) {
        await pickPdf(container);
        await waitFor(() =>
          expect(screen.getAllByText('invoice.pdf')).toHaveLength(i + 1),
        );
      }

      await pickPdf(container);

      await waitFor(() => expect(messages()).toContain('limit of 5'));
      expect(screen.getAllByText('invoice.pdf')).toHaveLength(5);
    });

    async function addAndWait() {
      await userEvent.click(
        await screen.findByRole('button', { name: 'Add transaction' }),
      );
    }

    it('Add with a document on the phone', async () => {
      const calls: string[] = [];
      const update = vi.fn(() => {
        calls.push('save');
        return { added: [], updated: [] };
      });
      const batch = vi.fn(() => {
        calls.push('attach');
        return { attachments: [{}], failed: [] };
      });
      serve({
        'transactions-batch-update': update,
        'transaction-attachments-add-batch': batch,
      });
      const { container } = renderEdit(addPath);
      await pickPdf(container);
      await heldName('invoice.pdf');

      await addAndWait();

      await waitFor(() => expect(batch).toHaveBeenCalledOnce());
      // The parent id the save minted, not the temp id, and after the save
      const added = (
        update.mock.calls[0] as unknown as [{ added: Array<{ id: string }> }]
      )[0].added;
      expect(added[0].id).not.toBe('temp');
      expect(batch).toHaveBeenCalledWith({
        transactionId: added[0].id,
        files: [expect.objectContaining({ name: 'invoice.pdf' })],
      });
      expect(calls).toEqual(['save', 'attach']);
    });

    it('Add without documents sends no batch', async () => {
      const batch = vi.fn();
      serve({ 'transaction-attachments-add-batch': batch });
      renderEdit(addPath);

      await addAndWait();

      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: 'Add transaction' }),
        ).not.toBeNull(),
      );
      expect(batch).not.toHaveBeenCalled();
    });

    it('Cancel while adding', async () => {
      const batch = vi.fn();
      const update = serve({ 'transaction-attachments-add-batch': batch });
      const view = renderEdit(addPath);
      await pickPdf(view.container);
      await heldName('invoice.pdf');

      view.unmount();

      expect(update).not.toHaveBeenCalled();
      expect(batch).not.toHaveBeenCalled();
    });

    it('Connection lost between pick and save', async () => {
      const update = serve({
        'transaction-attachments-add-batch': () => {
          throw new Error('offline');
        },
      });
      const { container } = renderEdit(addPath);
      await pickPdf(container);
      await heldName('invoice.pdf');

      await addAndWait();

      await waitFor(() => expect(messages()).toContain("weren't attached"));
      expect(update).toHaveBeenCalledOnce();
    });

    it('One document fails', async () => {
      serve({
        'transaction-attachments-add-batch': () => ({
          attachments: [{}],
          failed: [{ name: 'invoice.pdf', error: 'upload-failed' }],
        }),
      });
      const { container } = renderEdit(addPath);
      await pickPdf(container);
      await heldName('invoice.pdf');

      await addAndWait();

      await waitFor(() =>
        expect(messages()).toMatch(/weren't attached.*invoice\.pdf/),
      );
    });

    it('Schedule path drops held files', async () => {
      const batch = vi.fn();
      const update = serve({
        'transaction-attachments-add-batch': batch,
        'schedule/create': () => 'schedule-1',
      });
      const { container } = renderEdit(`${addPath}&date=2099-01-01`);
      await pickPdf(container);
      await heldName('invoice.pdf');

      await userEvent.click(
        await screen.findByRole('button', { name: 'Schedule' }),
      );

      expect(update).not.toHaveBeenCalled();
      expect(batch).not.toHaveBeenCalled();
    });
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

  describe('Notes show once', () => {
    const notesGroup = () => screen.queryByRole('group', { name: 'Notes' });
    const notesBox = () => screen.queryByRole('textbox', { name: 'Notes' });
    const splitRows = (notes: string) => [
      {
        id: 'line-1',
        parent_id: 't1',
        is_child: true,
        date: state.date,
        account: 'vanguard',
        amount: -400,
        notes,
      },
      {
        id: 'line-2',
        parent_id: 't1',
        is_child: true,
        date: state.date,
        account: 'vanguard',
        amount: -600,
        notes: '',
      },
    ];

    it('Open a transaction that has notes', async () => {
      state.notes = 'TEST';
      renderEdit('/transactions/t1');

      const group = await screen.findByRole('group', { name: 'Notes' });
      expect(group).toHaveTextContent('TEST');
      expect(notesBox()).toBeNull();
      expect(screen.getAllByText('TEST')).toHaveLength(1);
    });

    it('Empty notes', async () => {
      renderEdit('/transactions/t1');

      expect(
        await screen.findByPlaceholderText('Add a note (optional)'),
      ).toBeVisible();
      expect(notesGroup()).toBeNull();
    });

    it('Type into an empty note', async () => {
      renderEdit('/transactions/t1');

      await userEvent.click(
        await screen.findByRole('textbox', { name: 'Notes' }),
      );
      await userEvent.keyboard('a');

      const box = screen.getByRole('textbox', { name: 'Notes' });
      expect(box).toHaveFocus();
      expect(box).toHaveValue('a');
      expect(notesGroup()).toBeNull();
    });

    it('Tap to edit', async () => {
      state.notes = 'TEST';
      renderEdit('/transactions/t1');

      await userEvent.click(
        await screen.findByRole('group', { name: 'Notes' }),
      );

      const box = screen.getByRole('textbox', { name: 'Notes' });
      expect(box).toHaveFocus();
      expect(box).toHaveValue('TEST');
      expect(notesGroup()).toBeNull();
    });

    it('Blur returns to the formatted view', async () => {
      state.notes = 'one';
      renderEdit('/transactions/t1');

      await userEvent.click(
        await screen.findByRole('group', { name: 'Notes' }),
      );
      await userEvent.clear(screen.getByRole('textbox', { name: 'Notes' }));
      await userEvent.type(
        screen.getByRole('textbox', { name: 'Notes' }),
        'line a{Enter}line b{Enter}{Enter}line d',
      );
      await userEvent.tab();

      expect(notesBox()).toBeNull();
      const group = screen.getByRole('group', { name: 'Notes' });
      expect(group.textContent).toBe('line a\nline b\n\nline d');
      // Editing again shows the saved value with every line break
      await userEvent.click(group);
      expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue(
        'line a\nline b\n\nline d',
      );
    });

    it('Clear the note', async () => {
      state.notes = 'TEST';
      renderEdit('/transactions/t1');

      await userEvent.click(
        await screen.findByRole('group', { name: 'Notes' }),
      );
      await userEvent.clear(screen.getByRole('textbox', { name: 'Notes' }));
      await userEvent.tab();

      expect(
        screen.getByPlaceholderText('Add a note (optional)'),
      ).toBeVisible();
      expect(notesGroup()).toBeNull();
    });

    it('Tag and link in the formatted notes', async () => {
      window.innerWidth = 400;
      state.notes = 'see #receipt https://example.com/r.pdf';
      renderEdit('/transactions/t1');

      const group = await screen.findByRole('group', { name: 'Notes' });
      const link = within(group).getByRole('link');
      expect(link).toHaveAttribute('target', '_blank');
      expect(within(group).getByText('#receipt')).toBeVisible();

      await userEvent.click(link);
      expect(notesBox()).toBeNull();
      expect(screen.getByRole('group', { name: 'Notes' })).toBeVisible();
    });

    it('Another field is being edited', async () => {
      state.notes = 'TEST';
      renderEdit('/transactions/t1');
      const group = await screen.findByRole('group', { name: 'Notes' });

      // Opening the category sheet makes category the active edit
      await userEvent.click(screen.getByTestId('category-field'));
      await userEvent.click(group);

      expect(group).toHaveAttribute('aria-disabled', 'true');
      expect(notesBox()).toBeNull();
    });

    it('Keyboard activation', async () => {
      state.notes = 'TEST';
      renderEdit('/transactions/t1');

      const group = await screen.findByRole('group', { name: 'Notes' });
      expect(group).toHaveAttribute('tabindex', '0');
      act(() => group.focus());
      await userEvent.keyboard('{Enter}');
      expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveFocus();
      await userEvent.tab();
      expect(notesBox()).toBeNull();

      act(() => screen.getByRole('group', { name: 'Notes' }).focus());
      await userEvent.keyboard(' ');
      expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveFocus();
    });

    it('Notes on a split row', async () => {
      state.subtransactions = splitRows('row note');
      renderEdit('/transactions/line-1');

      const group = await screen.findByRole('group', { name: 'Notes' });
      expect(group).toHaveTextContent('row note');
      expect(screen.getAllByText('row note')).toHaveLength(1);

      await userEvent.click(group);
      const box = screen.getAllByRole('textbox', { name: 'Notes' })[0];
      expect(box).toHaveFocus();
      expect(box).toHaveValue('row note');

      // The split row has no onBlur handler of its own
      await userEvent.tab();
      expect(screen.getByRole('group', { name: 'Notes' })).toHaveTextContent(
        'row note',
      );
    });
  });
});
