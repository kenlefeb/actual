import { MemoryRouter } from 'react-router';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { ScheduleEditModal } from './ScheduleEditModal';

// paychecks spec, "No Delete for a paycheck's schedules"
vi.mock('#hooks/useFeatureFlag', () => ({
  useFeatureFlag: (name: string) => name === 'paychecks',
}));

vi.mock('#hooks/usePaychecks', () => ({
  usePaychecks: () => ({
    data: [
      {
        id: 'acme',
        name: 'Acme',
        definition: {
          clearingAccount: 'clearing',
          paySchedule: 'acme-pay',
          deposits: [{ id: 'checking', schedule: 'acme-checking' }],
        },
      },
    ],
  }),
}));

vi.mock('#hooks/useScheduleEdit', () => ({
  useScheduleEdit: ({ scheduleId }: { scheduleId?: string }) => ({
    state: {
      schedule: { id: scheduleId, posts_transaction: false },
      fields: { name: 'Acme → Checking' },
      upcomingDates: [],
      transactions: [],
      error: null,
    },
    dispatch: vi.fn(),
    isLoading: false,
  }),
}));

vi.mock('./ScheduleEditForm', () => ({
  ScheduleEditForm: () => <div>Schedule form</div>,
}));

describe('ScheduleEditModal for a paycheck schedule', () => {
  it('Delete a deposit schedule from Schedules: offers Edit paycheck and no Delete', () => {
    render(
      <TestProviders>
        <MemoryRouter>
          <ScheduleEditModal id="acme-checking" />
        </MemoryRouter>
      </TestProviders>,
    );
    expect(screen.getByRole('note')).toHaveTextContent('Acme');
    expect(
      screen.getByRole('button', { name: 'Edit paycheck' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /delete/i }),
    ).not.toBeInTheDocument();
  });
});
