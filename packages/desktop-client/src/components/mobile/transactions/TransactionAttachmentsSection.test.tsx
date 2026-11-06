import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestAppStore, TestProviders } from '#mocks';
import { clearServer, initServer } from '#mocks/connection';

import { TransactionAttachmentsSection } from './TransactionAttachmentsSection';

vi.mock(
  '@actual-app/core/platform/client/connection',
  () => import('#mocks/connection'),
);
vi.mock('@actual-app/components/hooks/useResponsive', () => ({
  useResponsive: () => ({ isNarrowWidth: true, isNarrowWidthLoaded: true }),
}));
const state = vi.hoisted(() => ({
  cloudFileId: 'cloud-file' as string | undefined,
  rows: [] as unknown[],
}));
vi.mock('#hooks/useMetadataPref', () => ({
  useMetadataPref: () => [state.cloudFileId, vi.fn()],
}));
vi.mock('#hooks/useQuery', () => ({
  useQuery: () => ({ data: state.rows, isLoading: false }),
}));
const undoMock = vi.hoisted(() => vi.fn());
vi.mock('#undo', () => ({ undo: undoMock, redo: vi.fn() }));

const receipt = {
  id: 'att-1',
  transaction_id: 'parent',
  name: 'receipt.pdf',
  mime: 'application/pdf',
};
const photo = {
  id: 'att-2',
  transaction_id: 'parent',
  name: 'photo.jpg',
  mime: 'image/jpeg',
};

function renderSection(store = createTestAppStore()) {
  const view = render(
    <TestProviders store={store}>
      <TransactionAttachmentsSection transactionId="parent" />
    </TestProviders>,
  );
  return { store, ...view };
}

const messages = (store: ReturnType<typeof createTestAppStore>) =>
  store.getState().notifications.notifications.map(n => n.message);

async function pick(container: HTMLElement, file: File) {
  await userEvent.click(
    screen.getByRole('button', { name: 'Attach document' }),
  );
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [file] },
  });
}

const pdf = () =>
  new File(['%PDF-1.4'], 'invoice.pdf', { type: 'application/pdf' });

describe('Documents on the phone edit screen', () => {
  let click: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    state.cloudFileId = 'cloud-file';
    state.rows = [];
    click = vi
      .spyOn(HTMLInputElement.prototype, 'click')
      .mockImplementation(() => undefined);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    undoMock.mockReset();
    await clearServer();
  });

  it('List documents on the phone', () => {
    state.rows = [receipt, photo];
    renderSection();

    expect(screen.getByText('receipt.pdf')).toBeInTheDocument();
    expect(screen.getByText('photo.jpg')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Open/ })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /^Remove/ })).toHaveLength(2);
  });

  it('Attach a PDF from Files on the phone', async () => {
    const add = vi.fn(() => ({ attachment: {} }));
    initServer({ 'transaction-attachment-add': add });
    const { container, store } = renderSection();

    await pick(container, pdf());

    await waitFor(() => expect(add).toHaveBeenCalled());
    expect(add).toHaveBeenCalledWith({
      transactionId: 'parent',
      name: 'invoice.pdf',
      data: new Uint8Array(new TextEncoder().encode('%PDF-1.4')),
    });
    expect(messages(store)).toEqual([]);
  });

  it.each([
    [
      'Wrong type on the phone',
      { error: 'unsupported-type' },
      'Only PDF, JPEG, PNG and WebP documents can be attached.',
    ],
    [
      'Oversize file on the phone',
      { error: 'too-large', limitMB: 10 },
      "This document is larger than the 10 MB limit, so it wasn't attached.",
    ],
    [
      'Quota reached on the phone',
      { error: 'quota' },
      "This budget's document storage is full, so the document wasn't attached.",
    ],
    [
      'Upload fails on the phone',
      { error: 'upload-failed' },
      "The document wasn't attached. Check your connection to the server and try again.",
    ],
  ])('%s', async (_name, result, message) => {
    initServer({ 'transaction-attachment-add': () => result });
    const { container, store } = renderSection();

    await pick(container, pdf());

    await waitFor(() => expect(messages(store)).toEqual([message]));
    expect(screen.queryByText('invoice.pdf')).toBeNull();
  });

  it('Local-only budget on the phone', async () => {
    state.cloudFileId = undefined;
    const { store } = renderSection();

    await userEvent.click(
      screen.getByRole('button', { name: 'Attach document' }),
    );

    expect(click).not.toHaveBeenCalled();
    expect(messages(store)).toEqual([
      'Attaching documents needs a sync server.',
    ]);
  });

  it('Remove on the phone', async () => {
    state.rows = [receipt];
    const remove = vi.fn(() => ({}));
    initServer({ 'transaction-attachment-remove': remove });
    const { store } = renderSection();

    await userEvent.click(
      screen.getByRole('button', { name: 'Remove receipt.pdf' }),
    );

    await waitFor(() => expect(remove).toHaveBeenCalledWith({ id: 'att-1' }));
    const notification = store.getState().notifications.notifications[0];
    expect(notification.message).toBe('Document removed.');
    expect(notification.button?.title).toBe('Undo');
  });

  it('Open shows the document in the viewer on the phone', async () => {
    state.rows = [receipt];
    initServer({
      'transaction-attachment-open': () => ({
        name: 'receipt.pdf',
        mime: 'application/pdf',
        data: new Uint8Array([37, 80, 68, 70]),
      }),
    });
    URL.createObjectURL = vi.fn(() => 'blob:doc');
    const { store } = renderSection();

    await userEvent.click(
      screen.getByRole('button', { name: 'Open receipt.pdf' }),
    );

    await waitFor(() =>
      expect(store.getState().modals.modalStack).toEqual([
        {
          name: 'transaction-attachment-viewer',
          options: {
            name: 'receipt.pdf',
            mime: 'application/pdf',
            url: 'blob:doc',
          },
        },
      ]),
    );
  });

  it('Never opened, offline on the phone', async () => {
    state.rows = [receipt];
    initServer({
      'transaction-attachment-open': () => ({ error: 'download-failed' }),
    });
    const { store } = renderSection();

    await userEvent.click(
      screen.getByRole('button', { name: 'Open receipt.pdf' }),
    );

    await waitFor(() =>
      expect(messages(store)).toEqual([
        "This document can't be loaded right now.",
      ]),
    );
    expect(store.getState().modals.modalStack).toEqual([]);
  });

  it('hands the document to the OS viewer in the desktop app', async () => {
    state.rows = [receipt];
    const data = new Uint8Array([37, 80, 68, 70]);
    initServer({
      'transaction-attachment-open': () => ({
        name: 'receipt.pdf',
        mime: 'application/pdf',
        data,
      }),
    });
    const openAttachment = vi.fn(async () => undefined);
    const previous = window.Actual;
    window.Actual = { ...previous, openAttachment } as typeof window.Actual;
    const { store } = renderSection();

    try {
      await userEvent.click(
        screen.getByRole('button', { name: 'Open receipt.pdf' }),
      );

      await waitFor(() =>
        expect(openAttachment).toHaveBeenCalledWith(
          'receipt.pdf',
          'application/pdf',
          data,
        ),
      );
      expect(store.getState().modals.modalStack).toEqual([]);
    } finally {
      window.Actual = previous;
    }
  });

  it('Undo a removal on the phone', async () => {
    state.rows = [receipt];
    initServer({ 'transaction-attachment-remove': () => ({}) });
    const { store } = renderSection();

    await userEvent.click(
      screen.getByRole('button', { name: 'Remove receipt.pdf' }),
    );
    await waitFor(() =>
      expect(store.getState().notifications.notifications).toHaveLength(1),
    );
    await store.getState().notifications.notifications[0].button!.action();

    expect(undoMock).toHaveBeenCalled();
  });
});
