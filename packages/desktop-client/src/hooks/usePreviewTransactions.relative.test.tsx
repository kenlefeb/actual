import type { ReactNode } from 'react';

import { setScheduleDates } from '@actual-app/core/shared/schedule-date-lookup';
import type { ScheduleEntity } from '@actual-app/core/types/models';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { usePreviewTransactions } from './usePreviewTransactions';

function makeSchedule(
  fields: Pick<ScheduleEntity, 'id' | 'next_date' | '_date'> &
    Partial<ScheduleEntity>,
): ScheduleEntity {
  return {
    rule: `rule-${fields.id}`,
    completed: false,
    posts_transaction: false,
    tombstone: false,
    _payee: 'payee-1',
    _account: 'acct-1',
    _amount: 10000,
    _amountOp: 'is',
    _actions: [],
    _conditions: [{ field: 'date', op: 'isapprox', value: fields._date }],
    ...fields,
  };
}

// Weekly payday on Fridays; deposit 2 business days before (weekends only)
const payday = makeSchedule({
  id: 'payday',
  next_date: '2017-01-06',
  _date: { start: '2016-12-30', frequency: 'weekly' },
});
const deposit = makeSchedule({
  id: 'deposit',
  next_date: '2017-01-04',
  custom_upcoming_length: 'oneMonth',
  _date: {
    relativeTo: {
      scheduleId: 'payday',
      offset: 2,
      unit: 'business-days',
      direction: 'before',
    },
  },
});

vi.mock('./useBusinessCalendars', () => ({
  useBusinessCalendars: () => ({ data: [] }),
}));

// The lookup reads every schedule, including sources filtered out elsewhere
vi.mock('#queries/aqlQuery', () => ({
  aqlQuery: async () => ({ data: [payday, deposit], dependencies: [] }),
}));

vi.mock('./useCachedSchedules', () => ({
  useCachedSchedules: () => ({
    isLoading: false,
    error: undefined,
    schedules: [deposit],
    statuses: new Map([['deposit', 'upcoming']]),
  }),
}));

vi.mock('@actual-app/core/platform/client/connection', async importActual => ({
  ...(await importActual<object>()),
  send: vi.fn(async (_name: string, { transaction }) => transaction),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <TestProviders>{children}</TestProviders>;
}

describe('usePreviewTransactions with relative schedules', () => {
  afterEach(() => setScheduleDates([]));

  it('previews occurrences computed from the source schedule', async () => {
    const { result } = renderHook(() => usePreviewTransactions(), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.previewTransactions.map(t => t.date).sort()).toEqual([
      '2017-01-04',
      '2017-01-11',
      '2017-01-18',
      '2017-01-25',
      // The one-month window runs through Feb 1 (payday Fri Feb 3)
      '2017-02-01',
    ]);
  });
});
