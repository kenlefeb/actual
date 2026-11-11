import React from 'react';

import type { TransactionEntity } from '@actual-app/core/types/models';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SelectedProviderWithItems } from '#hooks/useSelected';
import { createTestAppStore, TestProviders } from '#mocks';
import { clearServer, initServer } from '#mocks/connection';

import { SelectedTransactionsButton } from './SelectedTransactionsButton';
import {
  attachmentsForTransaction,
  AttachmentsIndicator,
  useAttachDocument,
} from './TransactionAttachments';
import type { AttachmentSummary } from './TransactionAttachments';

vi.mock(
  '@actual-app/core/platform/client/connection',
  () => import('#mocks/connection'),
);
vi.mock('#hooks/useSchedules', () => ({
  useSchedules: () => ({ schedules: [], isLoading: false }),
}));
const cloudFileId = vi.hoisted(() => ({
  value: undefined as string | undefined,
}));
vi.mock('#hooks/useMetadataPref', () => ({
  useMetadataPref: () => [cloudFileId.value, vi.fn()],
}));

const transactions = [
  { id: 't1', account: 'a', date: '2026-11-05', amount: -100 },
  { id: 't2', account: 'a', date: '2026-11-05', amount: -200 },
] as TransactionEntity[];

function renderMenu(selected: string[], store = createTestAppStore()) {
  const noop = () => undefined;
  render(
    <TestProviders store={store}>
      <SelectedProviderWithItems
        name="transactions"
        items={transactions}
        initialSelectedIds={selected}
        fetchAllIds={async () => transactions.map(t => t.id)}
      >
        <SelectedTransactionsButton
          getTransaction={id => transactions.find(t => t.id === id)}
          onShow={noop}
          onDuplicate={noop}
          onDelete={noop}
          onEdit={noop}
          onLinkSchedule={noop}
          onUnlinkSchedule={noop}
          onCreateRule={noop}
          onRunRules={noop}
          onSetTransfer={noop}
          onScheduleAction={noop}
          showMakeTransfer={false}
          onMakeAsSplitTransaction={noop}
          onMakeAsNonSplitTransactions={noop}
          onMergeTransactions={noop}
        />
      </SelectedProviderWithItems>
    </TestProviders>,
  );
  return store;
}

describe('Attach document… menu item', () => {
  beforeEach(() => {
    cloudFileId.value = 'cloud-file';
  });

  it('is offered for one selected transaction', async () => {
    renderMenu(['t1']);
    await userEvent.click(screen.getByTestId('transactions-select-button'));

    expect(screen.getByText('Attach document…')).toBeInTheDocument();
  });

  it('Several transactions selected', async () => {
    renderMenu(['t1', 't2']);
    await userEvent.click(screen.getByTestId('transactions-select-button'));

    expect(screen.queryByText('Attach document…')).not.toBeInTheDocument();
  });

  it('Local-only budget', async () => {
    cloudFileId.value = undefined;
    const click = vi.spyOn(HTMLInputElement.prototype, 'click');
    const store = renderMenu(['t1']);

    await userEvent.click(screen.getByTestId('transactions-select-button'));
    await userEvent.click(screen.getByText('Attach document…'));

    expect(click).not.toHaveBeenCalled();
    expect(
      store.getState().notifications.notifications.map(n => n.message),
    ).toEqual(['Attaching documents needs a sync server.']);
  });
});

describe('Paperclip in the register', () => {
  const receipt: AttachmentSummary = {
    id: 'att-1',
    transaction_id: 'parent',
    name: 'receipt.pdf',
    mime: 'application/pdf',
  };

  it('Indicator shown', async () => {
    render(
      <TestProviders>
        <AttachmentsIndicator attachments={[receipt]} />
      </TestProviders>,
    );

    await userEvent.click(screen.getByLabelText('Attached documents'));

    expect(screen.getByText('receipt.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  // The iOS app's WebView opens no new windows, so window.open does nothing
  it('opens a document inside the iOS app', async () => {
    initServer({
      'transaction-attachment-open': () => ({
        name: 'receipt.pdf',
        mime: 'application/pdf',
        data: new Uint8Array([37, 80, 68, 70]),
      }),
    });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    URL.createObjectURL = vi.fn(() => 'blob:receipt');
    Object.assign(window, { Capacitor: {} });
    const store = createTestAppStore();
    try {
      render(
        <TestProviders store={store}>
          <AttachmentsIndicator attachments={[receipt]} />
        </TestProviders>,
      );

      await userEvent.click(screen.getByLabelText('Attached documents'));
      await userEvent.click(screen.getByRole('button', { name: 'Open' }));

      await waitFor(() =>
        expect(store.getState().modals.modalStack).toEqual([
          {
            name: 'transaction-attachment-viewer',
            options: {
              name: 'receipt.pdf',
              mime: 'application/pdf',
              url: 'blob:receipt',
            },
          },
        ]),
      );
      expect(open).not.toHaveBeenCalled();
    } finally {
      delete (window as { Capacitor?: unknown }).Capacitor;
      void clearServer();
    }
  });

  it('No indicator', () => {
    render(
      <TestProviders>
        <AttachmentsIndicator attachments={[]} />
      </TestProviders>,
    );

    expect(screen.queryByLabelText('Attached documents')).toBeNull();
  });

  it("shows a split line its parent's documents", () => {
    const byTransaction = new Map([['parent', [receipt]]]);

    expect(
      attachmentsForTransaction(byTransaction, {
        id: 'child',
        parent_id: 'parent',
      }),
    ).toEqual([receipt]);
    expect(attachmentsForTransaction(byTransaction, { id: 'other' })).toEqual(
      [],
    );
  });
});

describe('Accepted types', () => {
  afterEach(() => clearServer());

  function AttachHarness() {
    const { attach, fileInput } = useAttachDocument();
    return (
      <>
        <button onClick={() => attach('t1')}>attach</button>
        {fileInput}
      </>
    );
  }

  it('HEIC from the Files app', async () => {
    cloudFileId.value = 'cloud-file';
    initServer({ 'transaction-attachment-add': () => ({ error: 'heic' }) });
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(
      () => undefined,
    );
    const store = createTestAppStore();
    const { container } = render(
      <TestProviders store={store}>
        <AttachHarness />
      </TestProviders>,
    );

    await userEvent.click(screen.getByText('attach'));
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: {
        files: [new File(['x'], 'IMG_0001.heic', { type: 'image/heic' })],
      },
    });

    await waitFor(() =>
      expect(
        store.getState().notifications.notifications.map(n => n.message),
      ).toEqual([
        "HEIC images aren't supported yet. Choose the photo from your Photos library, or save it as JPEG or PNG, and attach that.",
      ]),
    );
  });
});
