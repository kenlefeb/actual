import { setBusinessCalendars } from '@actual-app/core/shared/business-calendar-lookup';
import {
  setScheduleDates,
  setScheduleNames,
} from '@actual-app/core/shared/schedule-date-lookup';
import type { RuleEntity, ScheduleEntity } from '@actual-app/core/types/models';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { ManageRules } from './ManageRules';

const state = vi.hoisted(() => ({ rules: [] as RuleEntity[] }));

// Every schedule, as a live query serves it: a sync re-renders only the
// components reading it, so a memoized row doesn't hide a stale lookup
const allSchedules = vi.hoisted(() => {
  let value = { data: [] as Partial<ScheduleEntity>[], isLoading: false };
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(data: Partial<ScheduleEntity>[]) {
      value = { data, isLoading: false };
      listeners.forEach(listener => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock('@actual-app/core/platform/client/connection', async importActual => ({
  ...(await importActual<object>()),
  send: vi.fn(async (name: string) =>
    name === 'rules-get' ? state.rules : undefined,
  ),
}));

vi.mock('#hooks/useQuery', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useQuery: () =>
      useSyncExternalStore(allSchedules.subscribe, allSchedules.get),
  };
});

vi.mock('#hooks/useSchedules', () => ({
  useSchedules: () => ({ schedules: [], isLoading: false }),
}));

vi.mock('#hooks/useBusinessCalendars', () => ({
  useBusinessCalendars: () => ({ data: [] }),
}));

vi.mock('#hooks/usePayees', () => ({
  usePayees: () => ({ data: [] }),
}));

vi.mock('#hooks/useCategories', () => ({
  useCategories: () => ({ data: { list: [], grouped: [] } }),
}));

vi.mock('#hooks/useAccounts', () => ({
  useAccounts: () => ({ data: [] }),
}));

const payday = (name: string): Partial<ScheduleEntity> => ({
  id: 'payday',
  name,
  _date: { start: '2026-11-06', frequency: 'weekly' },
});

const depositRule: RuleEntity = {
  id: 'deposit-rule',
  stage: null,
  conditionsOp: 'and',
  conditions: [
    {
      field: 'date',
      op: 'isapprox',
      value: {
        relativeTo: {
          scheduleId: 'payday',
          offset: 2,
          unit: 'business-days',
          direction: 'before',
        },
      },
    },
  ],
  actions: [{ op: 'set', field: 'notes', value: 'Deposit' }],
};

describe('ManageRules', () => {
  afterEach(() => {
    setBusinessCalendars([]);
    setScheduleDates([]);
    setScheduleNames([]);
  });

  it('names a source schedule renamed after it syncs', async () => {
    state.rules = [depositRule];
    allSchedules.set([payday('Payday')]);
    render(
      <TestProviders>
        <ManageRules isModal={false} payeeId={null} />
      </TestProviders>,
    );
    expect(
      await screen.findByText('2 business days before Payday'),
    ).toBeInTheDocument();

    act(() => allSchedules.set([payday('Acme payday')]));

    expect(
      screen.getByText('2 business days before Acme payday'),
    ).toBeInTheDocument();
  });
});
