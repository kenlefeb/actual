import type { PropsWithChildren } from 'react';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestAppStore, TestProviders } from '#mocks';
import { clearServer, initServer } from '#mocks/connection';

import { usePendingAttachments } from './usePendingAttachments';

vi.mock(
  '@actual-app/core/platform/client/connection',
  () => import('#mocks/connection'),
);

const pdf = (name: string) => ({
  name,
  data: new Uint8Array([37, 80, 68, 70]),
});

function setup(initial?: Array<{ name: string; data: Uint8Array }>) {
  const store = createTestAppStore();
  const wrapper = ({ children }: PropsWithChildren) => (
    <TestProviders store={store}>{children}</TestProviders>
  );
  const view = renderHook(() => usePendingAttachments(initial), { wrapper });
  const messages = () =>
    store.getState().notifications.notifications.map(n => n.message);
  return { ...view, messages };
}

describe('usePendingAttachments', () => {
  afterEach(() => clearServer());

  it('holds a file that passes the check, without uploading', async () => {
    const check = vi.fn(() => ({ ok: true }));
    const addOne = vi.fn();
    initServer({
      'transaction-attachment-check': check,
      'transaction-attachment-add': addOne,
    });
    const { result } = setup();

    await act(() => result.current.add(pdf('a.pdf')));

    expect(result.current.files.map(f => f.name)).toEqual(['a.pdf']);
    expect(check).toHaveBeenCalledOnce();
    expect(addOne).not.toHaveBeenCalled();
  });

  it('Remove a held document', async () => {
    initServer({ 'transaction-attachment-check': () => ({ ok: true }) });
    const { result } = setup();
    await act(() => result.current.add(pdf('a.pdf')));
    await act(() => result.current.add(pdf('b.pdf')));

    act(() => result.current.remove(0));

    expect(result.current.files.map(f => f.name)).toEqual(['b.pdf']);
  });

  it('clears everything held', async () => {
    initServer({ 'transaction-attachment-check': () => ({ ok: true }) });
    const { result } = setup();
    await act(() => result.current.add(pdf('a.pdf')));

    act(() => result.current.clear());

    expect(result.current.files).toEqual([]);
  });

  it('starts with initial files', () => {
    const { result } = setup([pdf('photo.jpg')]);
    expect(result.current.files.map(f => f.name)).toEqual(['photo.jpg']);
  });

  it('Refused when picked: holds nothing and shows the message', async () => {
    initServer({
      'transaction-attachment-check': () => ({ error: 'unsupported-type' }),
    });
    const { result, messages } = setup();

    await act(() => result.current.add(pdf('a.docx')));

    expect(result.current.files).toEqual([]);
    expect(messages()).toEqual([
      'Only PDF, JPEG, PNG and WebP documents can be attached.',
    ]);
  });

  it('Offline pick: refused with the connection message', async () => {
    initServer({
      'transaction-attachment-check': () => ({ error: 'upload-failed' }),
    });
    const { result, messages } = setup();

    await act(() => result.current.add(pdf('a.pdf')));

    expect(result.current.files).toEqual([]);
    expect(messages()[0]).toContain('Check your connection');
  });

  it('Sixth document: says the limit is reached and holds no more', async () => {
    const check = vi.fn(() => ({ ok: true }));
    initServer({ 'transaction-attachment-check': check });
    const { result, messages } = setup(
      ['1', '2', '3', '4', '5'].map(n => pdf(`${n}.pdf`)),
    );

    await act(() => result.current.add(pdf('6.pdf')));

    expect(result.current.files).toHaveLength(5);
    expect(check).not.toHaveBeenCalled();
    expect(messages()[0]).toContain('limit of 5');
  });

  it('attachTo sends one batch on the given id and then clears', async () => {
    const batch = vi.fn(() => ({ attachments: [{}, {}], failed: [] }));
    initServer({
      'transaction-attachment-check': () => ({ ok: true }),
      'transaction-attachments-add-batch': batch,
    });
    const { result, messages } = setup();
    await act(() => result.current.add(pdf('a.pdf')));
    await act(() => result.current.add(pdf('b.pdf')));

    await act(() => result.current.attachTo('parent-1'));

    expect(batch).toHaveBeenCalledOnce();
    expect(batch).toHaveBeenCalledWith({
      transactionId: 'parent-1',
      files: [
        expect.objectContaining({ name: 'a.pdf' }),
        expect.objectContaining({ name: 'b.pdf' }),
      ],
    });
    expect(result.current.files).toEqual([]);
    expect(messages()).toEqual([]);
  });

  it('attachTo sends nothing when nothing is held', async () => {
    const batch = vi.fn();
    initServer({ 'transaction-attachments-add-batch': batch });
    const { result } = setup();

    await act(() => result.current.attachTo('parent-1'));

    expect(batch).not.toHaveBeenCalled();
  });

  it('One document fails: one message names it', async () => {
    initServer({
      'transaction-attachment-check': () => ({ ok: true }),
      'transaction-attachments-add-batch': () => ({
        attachments: [{}],
        failed: [{ name: 'a.pdf', error: 'upload-failed' }],
      }),
    });
    const { result, messages } = setup();
    await act(() => result.current.add(pdf('a.pdf')));
    await act(() => result.current.add(pdf('b.pdf')));

    await act(() => result.current.attachTo('parent-1'));

    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toContain('a.pdf');
    expect(messages()[0]).not.toContain('b.pdf');
  });

  it('Connection lost between pick and save: names every document', async () => {
    initServer({
      'transaction-attachment-check': () => ({ ok: true }),
      'transaction-attachments-add-batch': () => {
        throw new Error('offline');
      },
    });
    const { result, messages } = setup();
    await act(() => result.current.add(pdf('a.pdf')));

    await act(() => result.current.attachTo('parent-1'));

    expect(messages()[0]).toContain('a.pdf');
  });

  // A check that stays open until the test resolves it
  function deferredCheck() {
    const resolvers: Array<(r: unknown) => void> = [];
    initServer({
      'transaction-attachment-check': () =>
        new Promise(resolve => resolvers.push(resolve)),
      'transaction-attachments-add-batch': () => ({
        attachments: [],
        failed: [],
      }),
    });
    return resolvers;
  }

  it('Save while a check is in flight waits and includes the file', async () => {
    const batch = vi.fn(() => ({ attachments: [{}], failed: [] }));
    const resolvers: Array<(r: unknown) => void> = [];
    initServer({
      'transaction-attachment-check': () =>
        new Promise(resolve => resolvers.push(resolve)),
      'transaction-attachments-add-batch': batch,
    });
    const { result } = setup();

    let adding!: Promise<void>;
    act(() => {
      adding = result.current.add(pdf('a.pdf'));
    });
    let attaching!: Promise<void>;
    act(() => {
      attaching = result.current.attachTo('parent-1');
    });
    expect(batch).not.toHaveBeenCalled();
    await waitFor(() => expect(resolvers).toHaveLength(1));
    await act(async () => {
      resolvers[0]({ ok: true });
      await adding;
      await attaching;
    });

    expect(batch).toHaveBeenCalledWith({
      transactionId: 'parent-1',
      files: [expect.objectContaining({ name: 'a.pdf' })],
    });
  });

  it('Save drops a file whose check is refused while waiting', async () => {
    const batch = vi.fn(() => ({ attachments: [], failed: [] }));
    const resolvers: Array<(r: unknown) => void> = [];
    initServer({
      'transaction-attachment-check': () =>
        new Promise(resolve => resolvers.push(resolve)),
      'transaction-attachments-add-batch': batch,
    });
    const { result } = setup();
    let adding!: Promise<void>;
    act(() => {
      adding = result.current.add(pdf('a.docx'));
    });
    let attaching!: Promise<void>;
    act(() => {
      attaching = result.current.attachTo('parent-1');
    });
    await waitFor(() => expect(resolvers).toHaveLength(1));
    await act(async () => {
      resolvers[0]({ error: 'unsupported-type' });
      await adding;
      await attaching;
    });

    expect(batch).not.toHaveBeenCalled();
  });

  it('shows a file as checking until its check ends', async () => {
    const resolvers = deferredCheck();
    const { result } = setup();

    let adding!: Promise<void>;
    act(() => {
      adding = result.current.add(pdf('a.pdf'));
    });
    expect(result.current.checking).toEqual(['a.pdf']);

    await waitFor(() => expect(resolvers).toHaveLength(1));
    await act(async () => {
      resolvers[0]({ ok: true });
      await adding;
    });
    expect(result.current.checking).toEqual([]);
    expect(result.current.files).toHaveLength(1);
  });

  it('counts files being checked against the limit', async () => {
    const resolvers = deferredCheck();
    const { result, messages } = setup(
      ['1', '2', '3', '4'].map(n => pdf(`${n}.pdf`)),
    );

    act(() => {
      void result.current.add(pdf('5.pdf'));
    });
    expect(result.current.isFull).toBe(true);
    await act(() => result.current.add(pdf('6.pdf')));

    expect(resolvers).toHaveLength(1);
    expect(messages()[0]).toContain('limit of 5');
  });

  it('clear during a check discards that file and cannot let a sixth in', async () => {
    const resolvers: Array<(r: unknown) => void> = [];
    initServer({
      'transaction-attachment-check': () =>
        new Promise(resolve => resolvers.push(resolve)),
    });
    const { result } = setup();
    let stale!: Promise<void>;
    act(() => {
      stale = result.current.add(pdf('stale.pdf'));
    });
    act(() => result.current.clear());

    const fresh: Promise<void>[] = [];
    for (const n of ['1', '2', '3', '4', '5']) {
      act(() => {
        fresh.push(result.current.add(pdf(`${n}.pdf`)));
      });
    }
    await waitFor(() => expect(resolvers).toHaveLength(6));
    await act(async () => {
      resolvers.forEach(resolve => resolve({ ok: true }));
      await Promise.all([stale, ...fresh]);
    });

    expect(result.current.files).toHaveLength(5);
    expect(result.current.files.map(f => f.name)).not.toContain('stale.pdf');
  });
});
