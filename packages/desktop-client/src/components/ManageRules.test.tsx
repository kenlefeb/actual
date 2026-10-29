import { setBusinessCalendars } from '@actual-app/core/shared/business-calendar-lookup';
import {
  setScheduleDates,
  setScheduleNames,
} from '@actual-app/core/shared/schedule-date-lookup';
import type { RuleEntity, ScheduleEntity } from '@actual-app/core/types/models';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { scheduleDateLookupQueries } from '#hooks/useScheduleDateLookup';
import { createTestQueryClient, TestProviders } from '#mocks';

import { ManageRules } from './ManageRules';

// What the backend serves: the rules list, and every schedule for the
// schedules query
const state = vi.hoisted(() => ({
  rules: [] as RuleEntity[],
  schedules: [] as Partial<ScheduleEntity>[],
}));

const { send } = vi.hoisted(() => ({
  send: vi.fn(async (name: string, args?: { table?: string }) => {
    if (name === 'rules-get') {
      return state.rules;
    }
    if (name === 'query') {
      return {
        data: args?.table === 'schedules' ? state.schedules : [],
        dependencies: [args?.table],
      };
    }
    return undefined;
  }),
}));

vi.mock('@actual-app/core/platform/client/connection', async importActual => ({
  ...(await importActual<object>()),
  send,
}));

vi.mock('#hooks/useBusinessCalendars', () => ({
  useBusinessCalendars: () => ({ data: [] }),
}));

vi.mock('#hooks/usePayees', () => ({
  usePayees: () => ({ data: [{ id: 'acme', name: 'Acme' }] }),
  usePayeesById: () => ({ data: { acme: { id: 'acme', name: 'Acme' } } }),
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
  rule: 'payday-rule',
  completed: false,
  next_date: '2026-11-06',
  _payee: 'acme',
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

// A schedule's own rule: a recurring date and a link back to the schedule
function scheduleRule(id: string, day: number): RuleEntity {
  return {
    id: `${id}-rule`,
    stage: null,
    conditionsOp: 'and',
    conditions: [
      {
        field: 'date',
        op: 'isapprox',
        value: { start: `2026-11-${day}`, frequency: 'monthly' },
      },
    ],
    actions: [{ op: 'link-schedule', value: id }],
  };
}

function scheduleFor(id: string, day: number): Partial<ScheduleEntity> {
  return {
    id,
    name: id,
    rule: `${id}-rule`,
    completed: false,
    next_date: `2026-11-${day}`,
    _payee: 'acme',
    _date: { start: `2026-11-${day}`, frequency: 'monthly' },
  };
}

const schedulesQueries = () =>
  send.mock.calls.filter(
    ([name, args]) => name === 'query' && args?.table === 'schedules',
  ).length;

function renderRules() {
  const queryClient = createTestQueryClient();
  render(
    <TestProviders queryClient={queryClient}>
      <ManageRules isModal={false} payeeId={null} />
    </TestProviders>,
  );
  return queryClient;
}

describe('ManageRules', () => {
  beforeEach(() => {
    send.mockClear();
  });

  afterEach(() => {
    setBusinessCalendars([]);
    setScheduleDates([]);
    setScheduleNames([]);
  });

  it('names a source schedule renamed after it syncs', async () => {
    state.rules = [depositRule];
    state.schedules = [payday('Payday')];
    const queryClient = renderRules();
    expect(
      await screen.findByText('2 business days before Payday'),
    ).toBeInTheDocument();

    // A sync refetches the shared schedules query
    state.schedules = [payday('Acme payday')];
    await act(() =>
      queryClient.invalidateQueries({
        queryKey: scheduleDateLookupQueries.all(),
      }),
    );

    // The row re-renders once it has subscribed to the store, which can land
    // after the update, so wait for it instead of reading the DOM at once
    expect(
      await screen.findByText('2 business days before Acme payday'),
    ).toBeInTheDocument();
  });

  it('opens one schedules query for a Rules page with several schedule rules', async () => {
    state.rules = [
      scheduleRule('rent', 10),
      scheduleRule('phone', 12),
      scheduleRule('gym', 14),
      depositRule,
    ];
    state.schedules = [
      scheduleFor('rent', 10),
      scheduleFor('phone', 12),
      scheduleFor('gym', 14),
      payday('Payday'),
    ];
    renderRules();
    expect(
      await screen.findByText('2 business days before Payday'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Acme (2026-11-14)')).toBeInTheDocument();

    expect(schedulesQueries()).toBe(1);
  });
});
