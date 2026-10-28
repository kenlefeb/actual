import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const flags = vi.hoisted(() => ({ paychecks: true }));

vi.mock('#hooks/useFeatureFlag', () => ({
  useFeatureFlag: (name: string) =>
    name === 'paychecks' ? flags.paychecks : false,
}));

function renderNote(scheduleId: string) {
  render(
    <TestProviders>
      <PaycheckScheduleNote scheduleId={scheduleId} />
    </TestProviders>,
  );
}

describe('PaycheckScheduleNote', () => {
  beforeEach(() => {
    flags.paychecks = true;
  });

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

  it('shows nothing when the paychecks feature is off', () => {
    flags.paychecks = false;
    renderNote('pay');
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});
