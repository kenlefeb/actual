import type { PaycheckEntity } from '@actual-app/core/types/models';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { PaycheckEditModal } from './PaycheckEditModal';

const state = vi.hoisted(() => ({
  paychecks: [] as PaycheckEntity[],
  mutate: vi.fn(),
}));

vi.mock('#hooks/usePaychecks', () => ({
  usePaychecks: () => ({ data: state.paychecks, isPlaceholderData: false }),
}));

vi.mock('#hooks/useSchedules', () => ({
  useSchedules: () => ({ schedules: [{ next_date: '2026-11-13' }] }),
}));

vi.mock('#paychecks', () => ({
  useSavePaycheckMutation: () => ({ mutate: state.mutate }),
  useDeletePaycheckMutation: () => ({ mutate: state.mutate }),
  useSkipNextPaycheckMutation: () => ({ mutate: state.mutate }),
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
vi.mock('#components/select/RecurringSchedulePicker', () => ({
  RecurringSchedulePicker: () => null,
}));

function acme(deposits: PaycheckEntity['definition']['deposits']) {
  return {
    id: 'acme',
    name: 'Acme',
    definition: {
      payee: 'acme',
      clearingAccount: 'clearing',
      date: { start: '2026-11-01', frequency: 'monthly' },
      weekendSolveMode: 'before',
      grossAmount: 300000,
      incomeCategory: 'income',
      deductions: [
        { id: 'tax', name: 'Federal tax', amount: 45000, category: 'taxes' },
        { id: 'health', name: 'Health', amount: 12000, category: 'insurance' },
        {
          id: '401k',
          name: '401(k)',
          amount: 18000,
          transferAccount: 'retirement',
        },
      ],
      deposits,
    },
  } satisfies PaycheckEntity;
}

function renderModal() {
  render(
    <TestProviders>
      <PaycheckEditModal paycheckId="acme" />
    </TestProviders>,
  );
}

describe('PaycheckEditModal', () => {
  it('shows net pay and each deposit as the user edits', () => {
    state.paychecks = [
      acme([
        { id: 'savings', account: 'savings', kind: 'percent', value: 10 },
        { id: 'checking', account: 'checking', kind: 'remainder', value: 0 },
      ]),
    ];
    renderModal();
    expect(screen.getByText('Net pay:').parentElement).toHaveTextContent(
      '2,250.00',
    );
    expect(screen.getByLabelText('Deposit 1 amount')).toHaveTextContent(
      '225.00',
    );
    expect(screen.getByLabelText('Deposit 2 amount')).toHaveTextContent(
      '2,025.00',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains why a paycheck cannot be saved once edited', async () => {
    state.paychecks = [
      acme([
        { id: 'checking', account: 'checking', kind: 'fixed', value: 200000 },
      ]),
    ];
    renderModal();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Name'), ' Corp');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Deposits must add up to net pay or include a remainder.',
    );
    expect(
      screen.getByRole('button', { name: 'Skip next paycheck' }),
    ).toBeDisabled();
  });

  it('notes the exact-amount merge for deposits that post automatically', () => {
    state.paychecks = [
      acme([
        {
          id: 'checking',
          account: 'checking',
          kind: 'remainder',
          value: 0,
          postAutomatically: true,
        },
      ]),
    ];
    renderModal();
    expect(
      screen.getByText(/merges with the posted one only when its amount/),
    ).toBeInTheDocument();
  });

  it('offers skipping and deleting an existing paycheck', () => {
    state.paychecks = [
      acme([
        { id: 'checking', account: 'checking', kind: 'remainder', value: 0 },
      ]),
    ];
    renderModal();
    expect(
      screen.getByRole('button', { name: 'Skip next paycheck' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Delete paycheck' }),
    ).toBeInTheDocument();
  });

  it('names each picker for screen readers', () => {
    state.paychecks = [
      acme([
        { id: 'checking', account: 'checking', kind: 'remainder', value: 0 },
      ]),
    ];
    renderModal();
    expect(screen.getByLabelText('Employer')).toHaveTextContent('acme');
    expect(screen.getByLabelText('Income category')).toHaveTextContent(
      'income',
    );
    expect(screen.getByLabelText('Deduction 1 category')).toHaveTextContent(
      'taxes',
    );
    expect(
      screen.getByLabelText('Deduction 3 transfer account'),
    ).toHaveTextContent('retirement');
    expect(screen.getByLabelText('Deposit 1 account')).toHaveTextContent(
      'checking',
    );
  });

  it('keeps the decimal point while a percent is typed', async () => {
    state.paychecks = [
      acme([
        { id: 'savings', account: 'savings', kind: 'percent', value: 0 },
        { id: 'checking', account: 'checking', kind: 'remainder', value: 0 },
      ]),
    ];
    renderModal();
    const percent = screen.getByLabelText('Deposit 1 percent');
    await userEvent.clear(percent);
    await userEvent.type(percent, '12.5');
    expect(percent).toHaveValue(12.5);
    expect(screen.getByLabelText('Deposit 1 amount')).toHaveTextContent(
      '281.25',
    );
  });

  it('asks before skipping and names the paycheck date', async () => {
    state.paychecks = [
      acme([
        { id: 'checking', account: 'checking', kind: 'remainder', value: 0 },
      ]),
    ];
    state.mutate.mockClear();
    renderModal();
    await userEvent.click(
      screen.getByRole('button', { name: 'Skip next paycheck' }),
    );
    expect(
      screen.getByText('Skip the paycheck on 11/13/2026?'),
    ).toBeInTheDocument();
    expect(state.mutate).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(state.mutate).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole('button', { name: 'Skip next paycheck' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Skip it' }));
    expect(state.mutate).toHaveBeenCalledWith(
      { id: 'acme' },
      expect.anything(),
    );
  });
});
