import { setBusinessCalendars } from '@actual-app/core/shared/business-calendar-lookup';
import {
  setScheduleDates,
  setScheduleNames,
} from '@actual-app/core/shared/schedule-date-lookup';
import type {
  BusinessCalendarEntity,
  RelativeDateConfig,
  ScheduleEntity,
} from '@actual-app/core/types/models';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { scheduleDateLookupQueries } from '#hooks/useScheduleDateLookup';
import { createTestQueryClient, TestProviders } from '#mocks';

import { Value } from './Value';

// What the queries serve; each update is a new object, as after a sync
const state = vi.hoisted(() => ({
  calendars: { data: [] as BusinessCalendarEntity[] },
  allSchedules: { data: [] as Partial<ScheduleEntity>[], isLoading: false },
}));

vi.mock('#hooks/useBusinessCalendars', () => ({
  useBusinessCalendars: () => state.calendars,
}));

// Every schedule, for the schedule-name lookup
vi.mock('#queries/aqlQuery', () => ({
  aqlQuery: async () => ({ data: state.allSchedules.data, dependencies: [] }),
}));

const bank: BusinessCalendarEntity = {
  id: 'bank',
  name: 'Bank',
  nonWorkingDays: [0, 6],
  holidays: [],
  exceptions: [],
};

const payday = (name: string): Partial<ScheduleEntity> => ({
  id: 'payday',
  name,
  _date: { start: '2026-11-06', frequency: 'weekly' },
});

const twoDaysBefore: RelativeDateConfig = {
  relativeTo: {
    scheduleId: 'payday',
    offset: 2,
    unit: 'business-days',
    direction: 'before',
  },
  businessCalendarId: 'bank',
};

function renderValue(value: unknown) {
  const queryClient = createTestQueryClient();
  const view = () => (
    <TestProviders queryClient={queryClient}>
      <Value value={value} field="date" />
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

describe('Value', () => {
  beforeEach(() => {
    state.calendars = { data: [bank] };
    state.allSchedules = { data: [payday('Payday')], isLoading: false };
  });

  afterEach(() => {
    setBusinessCalendars([]);
    setScheduleDates([]);
    setScheduleNames([]);
  });

  it('describes a relative date instead of parsing it as a date', async () => {
    renderValue({ ...twoDaysBefore, businessCalendarId: undefined });
    expect(
      await screen.findByText('2 business days before Payday'),
    ).toBeInTheDocument();
  });

  it('names a source schedule renamed after it syncs', async () => {
    const { syncSchedules } = renderValue(twoDaysBefore);
    expect(
      await screen.findByText('2 business days before Payday (Bank)'),
    ).toBeInTheDocument();

    state.allSchedules = { data: [payday('Acme payday')], isLoading: false };
    await syncSchedules();

    expect(
      await screen.findByText('2 business days before Acme payday (Bank)'),
    ).toBeInTheDocument();
  });

  it('names a calendar renamed after it syncs', async () => {
    const recurring = {
      start: '2026-11-06',
      frequency: 'weekly',
      skipWeekend: true,
      weekendSolveMode: 'before',
      businessCalendarId: 'bank',
    };
    const { rerender } = renderValue(recurring);
    expect(
      await screen.findByText(/non-business days in Bank\)/),
    ).toBeInTheDocument();

    state.calendars = { data: [{ ...bank, name: 'Credit union' }] };
    rerender();

    expect(
      screen.getByText(/non-business days in Credit union\)/),
    ).toBeInTheDocument();
  });
});
