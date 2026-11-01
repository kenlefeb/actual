import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { updateScheduleConditions } from '#components/schedules/schedule-edit-utils';
import { liveQuery } from '#queries/liveQuery';

import { useScheduleEdit } from './useScheduleEdit';

vi.mock('@actual-app/core/platform/client/connection', async importActual => ({
  ...(await importActual<object>()),
  send: vi.fn(async () => ({ filters: [] })),
  sendCatch: vi.fn(async () => ({ data: [] })),
}));

vi.mock('#queries/liveQuery', () => ({
  liveQuery: vi.fn(() => ({ unsubscribe: () => undefined })),
}));

const relative = (scheduleId: string) => ({
  relativeTo: {
    scheduleId,
    offset: 2,
    unit: 'business-days' as const,
    direction: 'before' as const,
  },
});

function renderAddingRelative(scheduleId: string) {
  return renderHook(() =>
    useScheduleEdit({
      scheduleId: null,
      adding: true,
      initialSchedule: {
        _date: relative(scheduleId),
        _amount: 500,
        _amountOp: 'is',
        _conditions: [],
        _actions: [],
      },
    }),
  );
}

describe('relative date preview', () => {
  it('No error before a source is chosen', async () => {
    const { result } = renderAddingRelative('');

    await waitFor(() => expect(result.current.state.fields.date).toBeTruthy());
    expect(result.current.state.error).toBeNull();
    expect(result.current.state.transactions).toEqual([]);
    expect(liveQuery).not.toHaveBeenCalled();
  });

  it('Choosing a source previews as before', async () => {
    const { result } = renderAddingRelative('');
    await waitFor(() => expect(result.current.state.fields.date).toBeTruthy());

    act(() =>
      result.current.dispatch({
        type: 'set-field',
        field: 'date',
        value: relative('payday'),
      }),
    );

    await waitFor(() => expect(liveQuery).toHaveBeenCalled());
    expect(result.current.state.error).toBeNull();
  });

  it('Saving without a source is refused', () => {
    const result = updateScheduleConditions(
      { _conditions: [] },
      {
        payee: null,
        account: null,
        amount: 500,
        amountOp: 'is',
        date: relative(''),
        posts_transaction: false,
        custom_upcoming_length: null,
        name: null,
      },
    );

    expect(result).toMatchObject({
      error: 'Choose the schedule this date is relative to',
    });
  });
});
