import type { ComponentProps } from 'react';

import { sendCatch } from '@actual-app/core/platform/client/connection';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { ScheduleEditForm } from './ScheduleEditForm';

const flags = vi.hoisted(() => ({ businessCalendars: false }));

vi.mock('#hooks/useFeatureFlag', () => ({
  useFeatureFlag: (name: string) =>
    name === 'businessCalendars' ? flags.businessCalendars : false,
}));

vi.mock('#hooks/useScheduleDateLookup', async importActual => ({
  ...(await importActual<object>()),
  useScheduleDateLookup: () => ({ schedules: [], isLoading: false }),
}));

vi.mock('#hooks/useBusinessCalendarLookup', () => ({
  useBusinessCalendarLookup: () => [],
}));

vi.mock('@actual-app/core/platform/client/connection', async importActual => ({
  ...(await importActual<object>()),
  sendCatch: vi.fn(async () => ({ data: ['2026-11-10'] })),
}));

type Props = ComponentProps<typeof ScheduleEditForm>;

function renderForm(
  date: Props['fields']['date'],
  repeats = false,
  schedule: Props['schedule'] = {},
) {
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
    schedule,
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
      screen.queryByRole('button', { name: 'Date' }),
    ).not.toBeInTheDocument();
  });

  it('offers relative dates when the feature is on', () => {
    flags.businessCalendars = true;
    renderForm('2026-11-10');
    expect(screen.getByRole('button', { name: 'Date' })).toHaveTextContent(
      'One date',
    );
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
    expect(screen.getByRole('button', { name: 'Date' })).toHaveTextContent(
      'Relative to another schedule',
    );
    expect(screen.getByRole('spinbutton', { name: 'Offset' })).toHaveValue(2);
  });

  it("previews a saved schedule's repeating dates from its next date", async () => {
    renderForm(
      { start: '2026-10-10', frequency: 'monthly', interval: 1, patterns: [] },
      true,
      { id: 'rent' },
    );
    await userEvent.click(screen.getByRole('button', { name: /Every month/ }));

    expect(sendCatch).toHaveBeenLastCalledWith(
      'schedule/get-upcoming-dates',
      expect.objectContaining({ scheduleId: 'rent' }),
    );
  });
});
