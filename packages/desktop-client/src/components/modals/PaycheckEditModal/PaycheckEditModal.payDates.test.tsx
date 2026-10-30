import { sendCatch } from '@actual-app/core/platform/client/connection';
import type { PaycheckEntity } from '@actual-app/core/types/models';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { PaycheckEditModal } from './PaycheckEditModal';

// Unlike PaycheckEditModal.test.tsx, this file keeps the real recurrence
// picker, so the pay dates are edited the way the user edits them

const state = vi.hoisted(() => ({
  paychecks: [] as PaycheckEntity[],
  saveAsync: vi.fn(),
}));

vi.mock('#hooks/useAccounts', () => ({
  useAccounts: () => ({ data: [] }),
}));

vi.mock('#hooks/usePaychecks', () => ({
  usePaychecks: () => ({ data: state.paychecks, isPlaceholderData: false }),
}));

vi.mock('#hooks/useSchedules', () => ({
  useSchedules: () => ({ schedules: [{ next_date: '2026-11-13' }] }),
}));

vi.mock('#hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => false,
}));

vi.mock('#hooks/useBusinessCalendars', () => ({
  useBusinessCalendars: () => ({ data: [] }),
}));

vi.mock('#paychecks', () => ({
  useSavePaycheckMutation: () => ({ mutateAsync: state.saveAsync }),
  useDeletePaycheckMutation: () => ({ mutate: vi.fn() }),
  useSkipNextPaycheckMutation: () => ({ mutate: vi.fn() }),
  useSetAccountBusinessDaysMutation: () => ({ mutateAsync: vi.fn() }),
  paycheckQueries: {
    yearToDate: (id: string) => ({
      queryKey: ['year-to-date', id],
      queryFn: () => [],
    }),
  },
}));

// The picker previews upcoming dates from the server
vi.mock('@actual-app/core/platform/client/connection', async importActual => ({
  ...(await importActual<object>()),
  sendCatch: vi.fn(async () => ({ data: ['2026-11-06'] })),
}));

// Autocompletes and the date picker load data of their own
vi.mock('#components/util/GenericInput', () => ({
  GenericInput: ({
    value,
    'aria-label': label,
  }: {
    value: string;
    'aria-label'?: string;
  }) => <span aria-label={label}>{value}</span>,
}));

const acme = {
  id: 'acme',
  name: 'Acme',
  definition: {
    payee: 'acme',
    clearingAccount: 'clearing',
    date: { start: '2026-11-06', frequency: 'monthly', interval: 1 },
    weekendSolveMode: 'before',
    grossAmount: 300000,
    incomeCategory: 'income',
    deductions: [],
    deposits: [
      { id: 'checking', account: 'checking', kind: 'remainder', value: 0 },
    ],
  },
} satisfies PaycheckEntity;

describe('PaycheckEditModal pay dates', () => {
  it('Change how often pay arrives: the editor shows and saves a weekly pay pattern', async () => {
    state.paychecks = [acme];
    state.saveAsync.mockReset().mockResolvedValue(undefined);
    render(
      <TestProviders>
        <PaycheckEditModal paycheckId="acme" />
      </TestProviders>,
    );

    await userEvent.click(screen.getByRole('button', { name: /Every month/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Months' }));
    await userEvent.click(screen.getByText('Weeks'));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(
      screen.getByRole('button', { name: /Every week/ }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(state.saveAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'acme',
          definition: expect.objectContaining({
            date: expect.objectContaining({
              frequency: 'weekly',
              interval: 1,
              start: '2026-11-06',
            }),
          }),
        }),
      ),
    );
  });

  it('Skip next paycheck: the pay dates preview starts from the next pay date', async () => {
    state.paychecks = [
      { ...acme, definition: { ...acme.definition, paySchedule: 'acme-pay' } },
    ];
    render(
      <TestProviders>
        <PaycheckEditModal paycheckId="acme" />
      </TestProviders>,
    );

    await userEvent.click(screen.getByRole('button', { name: /Every month/ }));

    // The pay schedule's stored next date (after skips) is where it starts
    expect(sendCatch).toHaveBeenLastCalledWith(
      'schedule/get-upcoming-dates',
      expect.objectContaining({ scheduleId: 'acme-pay' }),
    );
  });
});
