import type { PaycheckEntity } from '@actual-app/core/types/models';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { usePaycheckMembership } from './usePaycheckMembership';

const state = vi.hoisted(() => ({ paychecks: [] as PaycheckEntity[] }));

vi.mock('./usePaychecks', () => ({
  usePaychecks: () => ({ data: state.paychecks }),
}));

describe('usePaycheckMembership', () => {
  it("indexes each paycheck's schedules and clearing account", () => {
    const acme = {
      id: 'acme',
      name: 'Acme',
      definition: {
        payee: null,
        clearingAccount: 'clearing',
        date: { start: '2026-11-01', frequency: 'monthly' },
        weekendSolveMode: 'before',
        grossAmount: 100000,
        incomeCategory: null,
        deductions: [],
        deposits: [
          {
            id: 'checking',
            account: 'checking',
            kind: 'remainder',
            value: 0,
            schedule: 'deposit',
          },
          { id: 'savings', account: 'savings', kind: 'fixed', value: 0 },
        ],
        paySchedule: 'pay',
      },
    } satisfies PaycheckEntity;
    state.paychecks = [acme];

    const { result } = renderHook(() => usePaycheckMembership());

    expect([...result.current.scheduleIds]).toEqual(['pay', 'deposit']);
    expect(result.current.byClearingAccount.get('clearing')).toBe(acme);
    expect(result.current.byClearingAccount.has('checking')).toBe(false);
  });
});
