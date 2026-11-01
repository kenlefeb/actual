import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { MoveOnBudgetModal } from './MoveOnBudgetModal';

// jsdom's date input turns 2026-02-31 into '', so use a plain text input to
// get the impossible date into the dialog
vi.mock('@actual-app/components/input', () => ({
  Input: ({
    onChangeValue,
    ...props
  }: {
    onChangeValue: (value: string) => void;
  } & Record<string, unknown>) => (
    <input {...props} onChange={e => onChangeValue(e.target.value)} />
  ),
}));
vi.mock('#hooks/useAccount', () => ({
  useAccount: () => ({ id: 'vanguard', name: 'Vanguard', offbudget: 1 }),
}));
vi.mock('#hooks/useCategories', () => ({
  useCategoriesById: () => ({ data: { list: {} } }),
}));
vi.mock('@actual-app/core/platform/client/connection', async importActual => ({
  ...(await importActual<object>()),
  send: vi.fn(async (name: string) =>
    name === 'account-move-on-budget-preview'
      ? {
          startingBalance: 2_000_00,
          before: 0,
          fromUncategorized: 0,
          categoriesCleared: 0,
          categoriesKept: 0,
          transfers: [],
        }
      : undefined,
  ),
}));

describe('MoveOnBudgetModal', () => {
  it('An impossible start date', async () => {
    render(
      <TestProviders>
        <MoveOnBudgetModal accountId="vanguard" />
      </TestProviders>,
    );
    await screen.findByText(/^Your budget gains/);
    const date = screen.getByLabelText('Budget it from');
    await userEvent.clear(date);
    await userEvent.type(date, '2026-02-31');

    expect(screen.getByText('Choose a start date')).toBeInTheDocument();
    expect(screen.queryByText(/Your budget/)).toBe(null);
    expect(
      screen.getByRole('button', { name: 'Move on budget' }),
    ).toBeDisabled();
  });
});
