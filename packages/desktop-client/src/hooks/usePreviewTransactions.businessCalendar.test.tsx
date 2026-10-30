import type { ReactNode } from 'react';

import { setBusinessCalendars } from '@actual-app/core/shared/business-calendar-lookup';
import { businessCalendarPresets } from '@actual-app/core/shared/business-calendar-presets';
import type {
  BusinessCalendarEntity,
  ScheduleEntity,
} from '@actual-app/core/types/models';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { usePreviewTransactions } from './usePreviewTransactions';

const calendars = vi.hoisted(() => ({
  data: [] as BusinessCalendarEntity[],
}));

// The mocks return the same objects on every render, as the real hooks do
// until their data changes. New objects each render made the hook's effect
// re-run forever, which would also hide a real render loop (sc-631).
vi.mock('./useBusinessCalendars', () => ({
  useBusinessCalendars: () => calendars,
}));

vi.mock('@actual-app/core/platform/client/connection', async importActual => ({
  ...(await importActual<object>()),
  send: vi.fn(async (_name: string, { transaction }) => transaction),
}));

// Weekly on Mondays, moved after non-business days; next date already moved
// off the New Year's Day observance (Monday January 2, 2017)
const schedule: ScheduleEntity = {
  id: 'paycheck',
  rule: 'rule-1',
  next_date: '2017-01-03',
  completed: false,
  posts_transaction: false,
  tombstone: false,
  custom_upcoming_length: 'oneMonth',
  _payee: 'payee-1',
  _account: 'acct-1',
  _amount: 10000,
  _amountOp: 'is',
  _date: '2017-01-03',
  _actions: [],
  _conditions: [
    {
      field: 'date',
      op: 'isapprox',
      value: {
        start: '2016-12-26',
        frequency: 'weekly',
        skipWeekend: true,
        weekendSolveMode: 'after',
        businessCalendarId: 'federal',
      },
    },
  ],
};

vi.mock('./useCachedSchedules', () => {
  // Built on first use: `schedule` isn't initialised yet when the factory runs
  let cached: object | undefined;
  return {
    useCachedSchedules: () =>
      (cached ??= {
        isLoading: false,
        error: undefined,
        schedules: [schedule],
        statuses: new Map([['paycheck', 'upcoming']]),
      }),
  };
});

function wrapper({ children }: { children: ReactNode }) {
  return <TestProviders>{children}</TestProviders>;
}

async function previewDates() {
  // React reports render loops ("Maximum update depth exceeded") through
  // console.error, so any error fails the test instead of scrolling past
  const consoleError = vi.spyOn(console, 'error');
  try {
    let renders = 0;
    const { result } = renderHook(
      () => {
        renders++;
        return usePreviewTransactions();
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // A render loop keeps re-rendering after loading ends; a settled hook doesn't
    const settled = renders;
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(renders).toBe(settled);
    expect(consoleError.mock.calls).toEqual([]);
    return result.current.previewTransactions.map(t => t.date).sort();
  } finally {
    consoleError.mockRestore();
  }
}

describe('usePreviewTransactions with business calendars', () => {
  afterEach(() => setBusinessCalendars([]));

  it('moves a preview occurrence off a holiday in the chosen calendar', async () => {
    calendars.data = [
      {
        id: 'federal',
        name: 'U.S. Federal Holidays',
        ...businessCalendarPresets[0].calendar,
      },
    ];
    // Monday January 16, 2017 is Martin Luther King Jr. Day
    expect(await previewDates()).toEqual([
      '2017-01-03',
      '2017-01-09',
      '2017-01-17',
      '2017-01-23',
      '2017-01-30',
    ]);
  });

  it('keeps the holiday date when the calendar is missing', async () => {
    calendars.data = [];
    expect(await previewDates()).toContain('2017-01-16');
  });
});
