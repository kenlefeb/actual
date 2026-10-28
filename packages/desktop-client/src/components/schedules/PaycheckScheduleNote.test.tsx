import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { PaycheckScheduleNote } from './PaycheckScheduleNote';

vi.mock('#hooks/usePaychecks', () => ({
  usePaychecks: () => ({
    data: [
      {
        id: 'acme',
        name: 'Acme',
        definition: {
          paySchedule: 'pay',
          deposits: [{ id: 'checking', schedule: 'deposit' }],
        },
      },
    ],
  }),
}));

function renderNote(scheduleId: string) {
  render(
    <TestProviders>
      <PaycheckScheduleNote scheduleId={scheduleId} />
    </TestProviders>,
  );
}

describe('PaycheckScheduleNote', () => {
  it.each(['pay', 'deposit'])('points the %s schedule to its paycheck', id => {
    renderNote(id);
    expect(screen.getByRole('note')).toHaveTextContent('Part of paycheck');
    expect(screen.getByRole('note')).toHaveTextContent('Acme');
    expect(
      screen.getByRole('button', { name: 'Edit paycheck' }),
    ).toBeInTheDocument();
  });

  it('shows nothing for other schedules', () => {
    renderNote('rent');
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});
