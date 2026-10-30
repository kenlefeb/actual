import type { ReactNode } from 'react';

import { send } from '@actual-app/core/platform/client/connection';
import type {
  RuleActionEntity,
  TransactionEntity,
} from '@actual-app/core/types/models';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';
import * as modalsSlice from '#modals/modalsSlice';

import { useApplyRuleActions } from './useApplyRuleActions';

vi.mock('@actual-app/core/platform/client/connection', () => ({
  send: vi.fn(async () => ({ errors: [] })),
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

const wrapper = ({ children }: { children: ReactNode }) => (
  <TestProviders>{children}</TestProviders>
);

const old = {
  id: 'old',
  date: '2016-09-15',
  account: 'vanguard',
} as TransactionEntity;
const recent = {
  id: 'new',
  date: '2016-10-05',
  account: 'vanguard',
} as TransactionEntity;

const category = [{ field: 'category' }] as RuleActionEntity[];
const notes = [{ field: 'notes' }] as RuleActionEntity[];

function setup() {
  const pushModal = vi.spyOn(modalsSlice, 'pushModal');
  const { result } = renderHook(() => useApplyRuleActions(), { wrapper });
  const onApplied = vi.fn();
  const confirms = () =>
    pushModal.mock.calls.filter(
      c => c[0].modal.name === 'confirm-categorize-moved-history',
    );
  return { apply: result.current, onApplied, confirms };
}

describe('Applying a rule from the Rules page', () => {
  beforeEach(() => {
    vi.mocked(send).mockClear();
    vi.restoreAllMocks();
  });

  it('asks once, before sending anything, when a category would hit moved history', () => {
    const { apply, onApplied, confirms } = setup();
    apply([old, recent], category, onApplied);
    expect(confirms()).toHaveLength(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends the whole selection in one call once confirmed', async () => {
    const { apply, onApplied, confirms } = setup();
    apply([old, recent], category, onApplied);
    const modal = confirms()[0][0].modal as Extract<
      modalsSlice.Modal,
      { name: 'confirm-categorize-moved-history' }
    >;
    expect(modal.options.isBatch).toBe(true);
    await act(async () => modal.options.onConfirm());
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('rule-apply-actions', {
      transactions: [old, recent],
      actions: category,
    });
    expect(onApplied).toHaveBeenCalled();
  });

  it('applies nothing when the dialog is cancelled', () => {
    const { apply, onApplied } = setup();
    apply([old, recent], category, onApplied);
    expect(send).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
  });

  it.each([
    ['a category with no moved history', [recent], category],
    ['a non-category action on moved history', [old, recent], notes],
  ])('sends at once, with no dialog, for %s', async (_name, txns, actions) => {
    const { apply, onApplied, confirms } = setup();
    await act(async () => apply(txns, actions, onApplied));
    expect(confirms()).toHaveLength(0);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
