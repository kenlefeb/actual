import { MemoryRouter, Route, Routes } from 'react-router';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { MobileScheduleEditPage } from './MobileScheduleEditPage';

// paychecks spec, "No Delete for a paycheck's schedules"
const state = vi.hoisted(() => ({
  paychecks: true,
  navigate: vi.fn(),
}));

vi.mock('#hooks/useFeatureFlag', () => ({
  useFeatureFlag: (name: string) =>
    name === 'paychecks' ? state.paychecks : false,
}));

vi.mock('#hooks/useNavigate', () => ({ useNavigate: () => state.navigate }));

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

vi.mock('#components/schedules/ScheduleEditForm', () => ({
  ScheduleEditForm: () => <div>Schedule form</div>,
}));

function renderPage(id: string) {
  render(
    <TestProviders>
      <MemoryRouter initialEntries={[`/schedules/${id}`]}>
        <Routes>
          <Route path="/schedules/:id" element={<MobileScheduleEditPage />} />
        </Routes>
      </MemoryRouter>
    </TestProviders>,
  );
}

describe('MobileScheduleEditPage for a paycheck schedule', () => {
  beforeEach(() => {
    state.paychecks = true;
    state.navigate.mockClear();
  });

  it('Delete a deposit schedule from Schedules: offers Edit paycheck and no Delete', async () => {
    renderPage('acme-checking');

    expect(screen.getByRole('note')).toHaveTextContent('Part of paycheck');
    expect(screen.getByRole('note')).toHaveTextContent('Acme');
    expect(
      screen.queryByRole('button', { name: /delete/i }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'Edit paycheck' }),
    );
    expect(state.navigate).toHaveBeenCalledWith('/paychecks/acme');
  });

  it('shows no paycheck note for other schedules', () => {
    renderPage('rent');
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('shows no paycheck note when the paychecks feature is off', () => {
    state.paychecks = false;
    renderPage('acme-checking');
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});
