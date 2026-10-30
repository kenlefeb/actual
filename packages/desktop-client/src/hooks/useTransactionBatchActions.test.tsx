import type { ReactNode } from 'react';

import { send } from '@actual-app/core/platform/client/connection';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';
import * as modalsSlice from '#modals/modalsSlice';

import { useTransactionBatchActions } from './useTransactionBatchActions';

vi.mock('@actual-app/core/platform/client/connection', () => ({
  send: vi.fn(async () => undefined),
}));
vi.mock('#queries/aqlQuery', () => ({
  aqlQuery: vi.fn(async () => ({
    data: [
      { id: 'old', date: '2016-09-15', account: 'vanguard', category: null },
      { id: 'new', date: '2016-10-05', account: 'vanguard', category: null },
    ],
  })),
}));
vi.mock('./useAccounts', () => ({
  useAccounts: () => ({
    data: [
      {
        id: 'vanguard',
        budget_start_date: '2016-10-01',
        budget_start_offset: null,
      },
    ],
  }),
}));

type Options = Extract<
  modalsSlice.Modal,
  { name: 'category-autocomplete' }
>['options'];

const wrapper = ({ children }: { children: ReactNode }) => (
  <TestProviders>{children}</TestProviders>
);

// Picks "groceries" in the category sheet for these transactions, as the sheet
// does: onSelect, then onClose
async function pickGroceries(ids: string[]) {
  const pushModal = vi.spyOn(modalsSlice, 'pushModal');
  const { result } = renderHook(() => useTransactionBatchActions(), {
    wrapper,
  });
  await act(async () => {
    await result.current.onBatchEdit({ name: 'category', ids });
  });
  const sheet = pushModal.mock.calls[0][0].modal as Extract<
    modalsSlice.Modal,
    { name: 'category-autocomplete' }
  >;
  const options: Options = sheet.options;
  await act(async () => {
    options.onSelect('groceries', 'Groceries');
    options.onClose?.();
  });
  return pushModal;
}

const updates = () =>
  vi.mocked(send).mock.calls.filter(c => c[0] === 'transactions-batch-update');

describe('Bulk categorize', () => {
  beforeEach(() => {
    vi.mocked(send).mockClear();
    vi.restoreAllMocks();
  });

  it('asks once for a batch that includes moved history; Cancel changes none', async () => {
    const pushModal = await pickGroceries(['old', 'new']);
    const confirms = pushModal.mock.calls.filter(
      c => c[0].modal.name === 'confirm-categorize-moved-history',
    );
    expect(confirms).toHaveLength(1);
    expect(updates()).toHaveLength(0);
  });

  it('Categorize anyway changes all of them', async () => {
    const pushModal = await pickGroceries(['old', 'new']);
    const confirm = pushModal.mock.calls
      .map(c => c[0].modal)
      .find(m => m.name === 'confirm-categorize-moved-history');
    await act(async () => {
      if (confirm?.name === 'confirm-categorize-moved-history') {
        confirm.options.onConfirm();
      }
    });
    await vi.waitFor(() => expect(updates()).toHaveLength(1));
    const changes = updates()[0][1] as unknown as {
      updated: Array<{ id: string }>;
    };
    expect(changes.updated.map(t => t.id).sort()).toEqual(['new', 'old']);
  });

  it('a batch from the start date on does not ask', async () => {
    const pushModal = await pickGroceries(['new']);
    expect(
      pushModal.mock.calls.some(
        c => c[0].modal.name === 'confirm-categorize-moved-history',
      ),
    ).toBe(false);
    await vi.waitFor(() => expect(updates()).toHaveLength(1));
  });
});
