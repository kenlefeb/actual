import type { ScheduleEntity } from '@actual-app/core/types/models';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { scheduleDateLookupQueries } from '#hooks/useScheduleDateLookup';
import { createTestQueryClient, TestProviders } from '#mocks';

import { ScheduleValue } from './ScheduleValue';

// What the shared schedules query serves; each update is a new list, as after a sync
const state = vi.hoisted(() => ({
  schedules: [] as Partial<ScheduleEntity>[],
}));

vi.mock('#queries/aqlQuery', () => ({
  aqlQuery: async () => ({ data: state.schedules, dependencies: [] }),
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
  // It reads no shared lookups: the next date comes from the schedules query
  it('shows the next date of a schedule that moved after it syncs', async () => {
    state.schedules = [payday('2026-11-13')];
    const queryClient = createTestQueryClient();
    render(
      <TestProviders queryClient={queryClient}>
        <ScheduleValue value="payday" />
      </TestProviders>,
    );
    expect(await screen.findByText('Acme (2026-11-13)')).toBeInTheDocument();

    state.schedules = [payday('2026-11-12')];
    await act(() =>
      queryClient.invalidateQueries({
        queryKey: scheduleDateLookupQueries.all(),
      }),
    );

    expect(await screen.findByText('Acme (2026-11-12)')).toBeInTheDocument();
  });
});
