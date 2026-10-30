import { MemoryRouter } from 'react-router';

import { setBusinessCalendars } from '@actual-app/core/shared/business-calendar-lookup';
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
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { scheduleDateLookupQueries } from '#hooks/useScheduleDateLookup';
import { createTestQueryClient, TestProviders } from '#mocks';

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

// Every schedule, for the shared schedules query of the date lookup
vi.mock('#queries/aqlQuery', () => ({
  aqlQuery: async () => ({ data: state.allSchedules.data, dependencies: [] }),
}));

// No posted pay transactions
vi.mock('#hooks/useQuery', () => ({
  useQuery: () => ({ data: [], isLoading: false }),
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
  const queryClient = createTestQueryClient();
  const view = () => (
    <TestProviders queryClient={queryClient}>
      <MemoryRouter>
        <PaychecksSection />
      </MemoryRouter>
    </TestProviders>
  );
  const { rerender } = render(view());
  return {
    rerender: () => rerender(view()),
    // As sync-events does when a schedules table syncs
    syncSchedules: () =>
      act(() =>
        queryClient.invalidateQueries({
          queryKey: scheduleDateLookupQueries.all(),
        }),
      ),
  };
}

const row = () => screen.getByRole('button', { name: 'Edit paycheck Acme' });

describe('PaychecksSection after a change syncs in', () => {
  beforeEach(() => {
    state.calendars = { data: [fed] };
    state.allSchedules = { data: schedules(twiceMonthly), isLoading: false };
  });

  afterEach(() => {
    setBusinessCalendars([]);
    setScheduleDates([]);
    setScheduleNames([]);
  });

  it('moves a deposit date when its calendar changes', async () => {
    const { rerender } = renderSection();
    // Wednesday, November 11 is Veterans Day; wait for the schedules query
    await waitFor(() =>
      expect(row()).toHaveTextContent(
        'Checking · 3,000.00 · Tuesday, November 10',
      ),
    );

    state.calendars = { data: [{ ...fed, holidays: [] }] };
    rerender();

    expect(row()).toHaveTextContent(
      'Checking · 3,000.00 · Wednesday, November 11',
    );
  });

  it('moves later paychecks when the pay schedule changes', async () => {
    const { syncSchedules } = renderSection();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Show more' }),
    );
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
    await syncSchedules();

    expect(
      await screen.findByText('Friday, November 20, 2026'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Monday, November 30, 2026'),
    ).not.toBeInTheDocument();
  });
});
