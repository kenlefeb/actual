import type { ScheduleEntity } from '@actual-app/core/types/models';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { ScheduleValue } from './ScheduleValue';

// What the schedules query serves; each update is a new object, as after a sync
const state = vi.hoisted(() => ({
  schedules: {
    schedules: [] as Partial<ScheduleEntity>[],
    isLoading: false,
  },
}));

vi.mock('#hooks/useSchedules', () => ({
  useSchedules: () => state.schedules,
}));

vi.mock('#hooks/usePayees', () => ({
  usePayees: () => ({ data: [] }),
  usePayeesById: () => ({ data: { acme: { id: 'acme', name: 'Acme' } } }),
}));

const payday = (next_date: string): Partial<ScheduleEntity> => ({
  id: 'payday',
  next_date,
  _payee: 'acme',
});

describe('ScheduleValue', () => {
  // It reads no shared lookups: the next date comes from its own query
  it('shows the next date of a schedule that moved after it syncs', () => {
    state.schedules = { schedules: [payday('2026-11-13')], isLoading: false };
    const view = () => (
      <TestProviders>
        <ScheduleValue value="payday" />
      </TestProviders>
    );
    const { rerender } = render(view());
    expect(screen.getByText('Acme (2026-11-13)')).toBeInTheDocument();

    state.schedules = { schedules: [payday('2026-11-12')], isLoading: false };
    rerender(view());

    expect(screen.getByText('Acme (2026-11-12)')).toBeInTheDocument();
  });
});
