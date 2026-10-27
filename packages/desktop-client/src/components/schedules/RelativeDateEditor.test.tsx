import type {
  RelativeDateConfig,
  ScheduleEntity,
} from '@actual-app/core/types/models';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { RelativeDateEditor } from './RelativeDateEditor';
import { updateScheduleConditions } from './schedule-edit-utils';

const lookup = vi.hoisted(() => ({
  schedules: [] as Array<Partial<ScheduleEntity>>,
  isLoading: false,
}));

vi.mock('#hooks/useScheduleDateLookup', () => ({
  useScheduleDateLookup: () => lookup,
}));

vi.mock('#hooks/useBusinessCalendarLookup', () => ({
  useBusinessCalendarLookup: () => [],
}));

const relative = (scheduleId: string): RelativeDateConfig => ({
  relativeTo: {
    scheduleId,
    offset: 2,
    unit: 'business-days',
    direction: 'before',
  },
});

function renderEditor(value: RelativeDateConfig, onChange = vi.fn()) {
  render(
    <TestProviders>
      <RelativeDateEditor value={value} scheduleId="self" onChange={onChange} />
    </TestProviders>,
  );
  return onChange;
}

describe('RelativeDateEditor', () => {
  beforeEach(() => {
    lookup.isLoading = false;
    lookup.schedules = [
      {
        id: 'payday',
        name: 'Payday',
        tombstone: false,
        _date: { start: '2026-01-15', frequency: 'monthly' },
      },
      {
        id: 'deposit',
        name: 'Deposit',
        tombstone: false,
        _date: relative('payday'),
      },
      {
        id: 'self',
        name: 'This schedule',
        tombstone: false,
        _date: '2026-01-01',
      },
    ];
  });

  it('offers only non-relative other schedules as sources', async () => {
    const onChange = renderEditor(relative(''));
    await userEvent.click(
      screen.getByRole('button', { name: 'Choose a schedule' }),
    );

    expect(screen.getByText('Payday')).toBeInTheDocument();
    expect(screen.queryByText('Deposit')).not.toBeInTheDocument();
    expect(screen.queryByText('This schedule')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('Payday'));
    expect(onChange).toHaveBeenCalledWith(relative('payday'));
  });

  it('says when the source schedule was deleted', () => {
    renderEditor(relative('gone'));
    expect(screen.getByRole('note')).toHaveTextContent(
      'Source schedule was deleted',
    );
  });

  it('does not report a missing source while schedules load', () => {
    lookup.isLoading = true;
    lookup.schedules = [];
    renderEditor(relative('payday'));
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});

describe('saving relative dates', () => {
  const fields = {
    payee: null,
    account: null,
    amount: 100,
    amountOp: 'is',
    posts_transaction: false,
    custom_upcoming_length: null,
    name: 'Deposit',
  };

  it('requires a source schedule', () => {
    expect(
      updateScheduleConditions(
        { _conditions: [] },
        { ...fields, date: relative('') },
      ).error,
    ).toBe('Choose the schedule this date is relative to');
  });

  it('saves the relative date as the date condition', () => {
    const { error, conditions } = updateScheduleConditions(
      { _conditions: [] },
      { ...fields, date: relative('payday') },
    );
    expect(error).toBeUndefined();
    expect(conditions).toContainEqual({
      op: 'isapprox',
      field: 'date',
      value: relative('payday'),
    });
  });
});
