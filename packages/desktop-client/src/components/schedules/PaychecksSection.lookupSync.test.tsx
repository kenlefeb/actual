import { MemoryRouter } from 'react-router';

import { setBusinessCalendars } from '@actual-app/core/shared/business-calendar-lookup';
import type { Query } from '@actual-app/core/shared/query';
import {
  setScheduleDates,
  setScheduleNames,
} from '@actual-app/core/shared/schedule-date-lookup';
import type {
  AccountEntity,
  BusinessCalendarEntity,
  PaycheckEntity,
  RecurConfig,
  ScheduleEntity,
} from '@actual-app/core/types/models';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetTestProviders, TestProviders } from '#mocks';

import { PaychecksSection } from './PaychecksSection';

// Unlike PaychecksSection.test.tsx, this file keeps the real lookup hooks and
// changes what their queries serve, as a sync does. Each update is a new object
const state = vi.hoisted(() => ({
  calendars: { data: [] as BusinessCalendarEntity[] },
  allSchedules: { data: [] as Partial<ScheduleEntity>[], isLoading: false },
}));

// Tests otherwise pin today to 2017-01-01
vi.mock('@actual-app/core/shared/months', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  currentDay: () => '2026-11-02',
}));

vi.mock('#hooks/useBusinessCalendars', () => ({
  useBusinessCalendars: () => state.calendars,
}));

// Every schedule for the date lookup; no posted pay transactions
const noTransactions = { data: [], isLoading: false };
vi.mock('#hooks/useQuery', () => ({
  useQuery: (makeQuery: () => Query) =>
    makeQuery().state.table === 'schedules'
      ? state.allSchedules
      : noTransactions,
}));

vi.mock('#hooks/usePaychecks', () => ({
  usePaychecks: () => ({ data: [acme] }),
}));

vi.mock('#hooks/useAccounts', () => ({
  useAccounts: () => ({
    data: [{ id: 'checking', name: 'Checking' }] as Partial<AccountEntity>[],
  }),
}));

vi.mock('#paychecks', () => ({
  useSkipNextPaycheckMutation: () => ({ mutate: vi.fn() }),
  paycheckQueries: {
    clearingStatus: () => ({
      queryKey: ['clearing-status'],
      queryFn: async () => [],
    }),
  },
}));

const veteransDay = {
  id: 'veterans',
  name: 'Veterans Day',
  kind: 'fixed',
  month: 11,
  day: 11,
  observance: 'nearest-weekday',
} as const;

const fed: BusinessCalendarEntity = {
  id: 'fed',
  name: 'U.S. Federal Reserve',
  nonWorkingDays: [0, 6],
  holidays: [veteransDay],
  exceptions: [],
};

// The 15th and last day of each month, moved before weekends
const twiceMonthly: RecurConfig = {
  start: '2026-01-01',
  frequency: 'monthly',
  interval: 1,
  patterns: [
    { type: 'day', value: 15 },
    { type: 'day', value: -1 },
  ],
  skipWeekend: true,
  weekendSolveMode: 'before',
  endMode: 'never',
};

const acme = {
  id: 'acme',
  name: 'Acme',
  definition: {
    payee: null,
    clearingAccount: 'clearing',
    date: twiceMonthly,
    weekendSolveMode: 'before',
    grossAmount: 300000,
    incomeCategory: null,
    deductions: [],
    deposits: [
      {
        id: 'checking',
        account: 'checking',
        kind: 'remainder',
        value: 0,
        schedule: 'acme-checking',
      },
    ],
    paySchedule: 'acme-pay',
  },
} satisfies PaycheckEntity;

function schedules(payDate: RecurConfig): Partial<ScheduleEntity>[] {
  return [
    {
      id: 'acme-pay',
      next_date: '2026-11-13',
      completed: false,
      _date: payDate,
    },
    {
      id: 'acme-checking',
      next_date: '2026-11-10',
      completed: false,
      // Two Federal Reserve business days before each pay date
      _date: {
        relativeTo: {
          scheduleId: 'acme-pay',
          offset: 2,
          unit: 'business-days',
          direction: 'before',
        },
        businessCalendarId: 'fed',
      },
    },
  ];
}

function renderSection() {
  const view = () => (
    <TestProviders>
      <MemoryRouter>
        <PaychecksSection />
      </MemoryRouter>
    </TestProviders>
  );
  const { rerender } = render(view());
  return () => rerender(view());
}

const row = () => screen.getByRole('button', { name: 'Edit paycheck Acme' });

describe('PaychecksSection after a change syncs in', () => {
  beforeEach(() => {
    resetTestProviders();
    state.calendars = { data: [fed] };
    state.allSchedules = { data: schedules(twiceMonthly), isLoading: false };
  });

  afterEach(() => {
    setBusinessCalendars([]);
    setScheduleDates([]);
    setScheduleNames([]);
  });

  it('moves a deposit date when its calendar changes', () => {
    const rerender = renderSection();
    // Wednesday, November 11 is Veterans Day
    expect(row()).toHaveTextContent(
      'Checking · 3,000.00 · Tuesday, November 10',
    );

    state.calendars = { data: [{ ...fed, holidays: [] }] };
    rerender();

    expect(row()).toHaveTextContent(
      'Checking · 3,000.00 · Wednesday, November 11',
    );
  });

  it('moves later paychecks when the pay schedule changes', async () => {
    const rerender = renderSection();
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(screen.getByText('Monday, November 30, 2026')).toBeInTheDocument();

    // Pay moves to every Friday; the next pay date stays November 13
    state.allSchedules = {
      data: schedules({
        start: '2026-11-06',
        frequency: 'weekly',
        interval: 1,
        skipWeekend: true,
        weekendSolveMode: 'before',
        endMode: 'never',
      }),
      isLoading: false,
    };
    rerender();

    expect(screen.getByText('Friday, November 20, 2026')).toBeInTheDocument();
    expect(
      screen.queryByText('Monday, November 30, 2026'),
    ).not.toBeInTheDocument();
  });
});
