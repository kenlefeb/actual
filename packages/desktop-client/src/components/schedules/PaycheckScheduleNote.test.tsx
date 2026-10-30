import { MemoryRouter } from 'react-router';

import { theme } from '@actual-app/components/theme';
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
      <MemoryRouter>
        <PaycheckScheduleNote scheduleId={scheduleId} />
      </MemoryRouter>
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

  it('uses the AA-contrast note colour (sc-1116)', () => {
    renderNote('pay');
    expect(screen.getByRole('note')).toHaveStyle({
      color: theme.clearingNoteText,
    });
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
