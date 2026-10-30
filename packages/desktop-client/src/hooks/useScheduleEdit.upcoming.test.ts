import { sendCatch } from '@actual-app/core/platform/client/connection';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useScheduleEdit } from './useScheduleEdit';

const weekly = { start: '2026-10-03', frequency: 'weekly', patterns: [] };

vi.mock('@actual-app/core/platform/client/connection', async importActual => ({
  ...(await importActual<object>()),
  sendCatch: vi.fn(async () => ({ data: ['2026-10-10'] })),
}));

vi.mock('#queries/aqlQuery', () => ({
  aqlQuery: vi.fn(async () => ({
    data: [
      {
        id: 'rent',
        next_date: '2026-10-10',
        _date: weekly,
        _conditions: [{ op: 'isapprox', field: 'date', value: weekly }],
        _actions: [],
      },
    ],
  })),
}));

vi.mock('#queries/liveQuery', () => ({
  liveQuery: () => ({ unsubscribe: () => undefined }),
}));

describe('useScheduleEdit upcoming dates', () => {
  it('asks a saved schedule for its dates from its next date', async () => {
    const { result } = renderHook(() =>
      useScheduleEdit({ scheduleId: 'rent', adding: false }),
    );

    // The server starts from the stored next date when the dates are unchanged
    await waitFor(() =>
      expect(sendCatch).toHaveBeenCalledWith('schedule/get-upcoming-dates', {
        config: weekly,
        count: 3,
        scheduleId: 'rent',
      }),
    );
    await waitFor(() =>
      expect(result.current.state.upcomingDates).toEqual(['2026-10-10']),
    );
  });
});
