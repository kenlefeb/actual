import type { ReactNode } from 'react';

import { setBusinessCalendars } from '@actual-app/core/shared/business-calendar-lookup';
import { setScheduleDates } from '@actual-app/core/shared/schedule-date-lookup';
import type {
  BusinessCalendarEntity,
  ScheduleEntity,
} from '@actual-app/core/types/models';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { usePreviewTransactions } from './usePreviewTransactions';

// What the queries serve; each update is a new object, as after a sync
const state = vi.hoisted(() => ({
  calendars: { data: [] as BusinessCalendarEntity[] },
  allSchedules: { data: [] as ScheduleEntity[], isLoading: false },
  cached: {} as object,
}));

vi.mock('./useBusinessCalendars', () => ({
  useBusinessCalendars: () => state.calendars,
}));

// Every schedule, for the relative-date lookup
vi.mock('./useQuery', () => ({
  useQuery: () => state.allSchedules,
}));

// The account's schedules, which leave out sources in other accounts
vi.mock('./useCachedSchedules', () => ({
  useCachedSchedules: () => state.cached,
}));

vi.mock('@actual-app/core/platform/client/connection', async importActual => ({
  ...(await importActual<object>()),
  send: vi.fn(async (_name: string, { transaction }) => transaction),
}));

function makeSchedule(
  fields: Pick<ScheduleEntity, 'id' | 'next_date' | '_date'>,
): ScheduleEntity {
  return {
    rule: `rule-${fields.id}`,
    completed: false,
    posts_transaction: false,
    tombstone: false,
    custom_upcoming_length: 'oneMonth',
    _payee: 'payee-1',
    _account: 'acct-1',
    _amount: 10000,
    _amountOp: 'is',
    _actions: [],
    _conditions: [{ field: 'date', op: 'isapprox', value: fields._date }],
    ...fields,
  };
}

function showSchedule(schedule: ScheduleEntity) {
  state.cached = {
    isLoading: false,
    error: undefined,
    schedules: [schedule],
    statuses: new Map([[schedule.id, 'upcoming']]),
  };
}

const bank: BusinessCalendarEntity = {
  id: 'bank',
  name: 'Bank',
  nonWorkingDays: [0, 6],
  holidays: [],
  exceptions: [],
};

function wrapper({ children }: { children: ReactNode }) {
  return <TestProviders>{children}</TestProviders>;
}

function renderPreview() {
  const hook = renderHook(() => usePreviewTransactions(), { wrapper });
  const dates = () => hook.result.current.previewTransactions.map(t => t.date);
  return { ...hook, dates };
}

describe('usePreviewTransactions after a change syncs in', () => {
  afterEach(() => {
    setBusinessCalendars([]);
    setScheduleDates([]);
  });

  it('moves the preview off a calendar exception added on another device', async () => {
    state.calendars = { data: [bank] };
    state.allSchedules = { data: [], isLoading: false };
    // Weekly on Mondays, moved after the Bank calendar's non-business days
    showSchedule(
      makeSchedule({
        id: 'weekly',
        next_date: '2017-01-02',
        _date: {
          start: '2017-01-02',
          frequency: 'weekly',
          skipWeekend: true,
          weekendSolveMode: 'after',
          businessCalendarId: 'bank',
        },
      }),
    );
    const { dates, rerender } = renderPreview();
    await waitFor(() => expect(dates()).toContain('2017-01-09'));

    // The calendars query refetches; the account's schedules don't change
    state.calendars = {
      data: [
        {
          ...bank,
          exceptions: [
            { date: '2017-01-09', isBusinessDay: false, name: 'Closed' },
          ],
        },
      ],
    };
    rerender();

    await waitFor(() => expect(dates()).toContain('2017-01-10'));
    expect(dates()).not.toContain('2017-01-09');
  });

  it('follows a source schedule in another account that moved', async () => {
    state.calendars = { data: [] };
    const deposit = makeSchedule({
      id: 'deposit',
      next_date: '2017-01-06',
      _date: {
        relativeTo: {
          scheduleId: 'payday',
          offset: 0,
          unit: 'days',
          direction: 'before',
        },
      },
    });
    const payday = (start: string) =>
      makeSchedule({
        id: 'payday',
        next_date: start,
        _date: { start, frequency: 'weekly' },
      });
    state.allSchedules = {
      data: [payday('2017-01-06'), deposit],
      isLoading: false,
    };
    showSchedule(deposit);
    const { dates, rerender } = renderPreview();
    await waitFor(() => expect(dates()).toContain('2017-01-13'));

    // Payday moves to Thursdays; only the all-schedules query changes
    state.allSchedules = {
      data: [payday('2017-01-05'), deposit],
      isLoading: false,
    };
    rerender();

    await waitFor(() => expect(dates()).toContain('2017-01-12'));
    expect(dates()).not.toContain('2017-01-13');
  });
});
