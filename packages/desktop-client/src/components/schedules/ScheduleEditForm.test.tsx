import type { ComponentProps } from 'react';

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { ScheduleEditForm } from './ScheduleEditForm';

const flags = vi.hoisted(() => ({ businessCalendars: false }));

vi.mock('#hooks/useFeatureFlag', () => ({
  useFeatureFlag: (name: string) =>
    name === 'businessCalendars' ? flags.businessCalendars : false,
}));

vi.mock('#hooks/useScheduleDateLookup', () => ({
  useScheduleDateLookup: () => ({ schedules: [], isLoading: false }),
}));

vi.mock('#hooks/useBusinessCalendarLookup', () => ({
  useBusinessCalendarLookup: () => [],
}));

type Props = ComponentProps<typeof ScheduleEditForm>;

function renderForm(date: Props['fields']['date'], repeats = false) {
  const props: Props = {
    fields: {
      payee: null,
      account: null,
      amount: 0,
      amountOp: 'is',
      date,
      posts_transaction: false,
      custom_upcoming_length: null,
      name: 'Deposit',
    },
    dispatch: vi.fn(),
    upcomingDates: null,
    repeats,
    schedule: {},
    adding: true,
    isCustom: false,
    onEditRule: vi.fn(),
    transactions: [],
    transactionsMode: 'matched',
    error: null,
    selectedInst: { items: new Set(), dispatch: vi.fn() },
    onSwitchTransactions: vi.fn(),
    onLinkTransactions: vi.fn(async () => undefined),
    onUnlinkTransactions: vi.fn(async () => undefined),
  };
  render(
    <TestProviders>
      <ScheduleEditForm {...props} />
    </TestProviders>,
  );
  return props.dispatch;
}

describe('ScheduleEditForm date type', () => {
  beforeEach(() => {
    flags.businessCalendars = false;
  });

  it('keeps the Repeats checkbox when the feature is off', () => {
    renderForm('2026-11-10');
    expect(
      screen.getByRole('checkbox', { name: 'Repeats' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'One date' }),
    ).not.toBeInTheDocument();
  });

  it('offers relative dates when the feature is on', () => {
    flags.businessCalendars = true;
    renderForm('2026-11-10');
    expect(
      screen.getByRole('button', { name: 'One date' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'Repeats' }),
    ).not.toBeInTheDocument();
  });

  it('keeps an existing relative date editable with the feature off', () => {
    renderForm({
      relativeTo: {
        scheduleId: 'payday',
        offset: 2,
        unit: 'business-days',
        direction: 'before',
      },
    });
    expect(
      screen.getByRole('button', { name: 'Relative to another schedule' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Offset' })).toHaveValue(2);
  });
});
