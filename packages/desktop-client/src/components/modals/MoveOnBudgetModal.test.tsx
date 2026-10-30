import { send } from '@actual-app/core/platform/client/connection';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { MoveOnBudgetModal } from './MoveOnBudgetModal';

const state = vi.hoisted(() => ({ isNarrowWidth: false, transfers: 3 }));

vi.mock('@actual-app/components/hooks/useResponsive', () => ({
  useResponsive: () => ({
    isNarrowWidth: state.isNarrowWidth,
    isWideWidth: !state.isNarrowWidth,
  }),
}));
vi.mock('#hooks/useAccount', () => ({
  useAccount: () => ({ id: 'vanguard', name: 'Vanguard', offbudget: 1 }),
}));
vi.mock('#hooks/useCategories', () => ({
  useCategoriesById: () => ({
    data: { list: { savings: { id: 'savings', name: 'Savings' } } },
  }),
}));

function transfer(i: number) {
  return {
    id: `t${i}`,
    date: '2026-09-12',
    amount: 500_00,
    otherAccount: 'checking',
    otherAccountName: 'Checking',
    keptCategory: i === 0 ? 'savings' : null,
  };
}

vi.mock('@actual-app/core/platform/client/connection', async importActual => ({
  ...(await importActual<object>()),
  send: vi.fn(async (name: string) =>
    name === 'account-move-on-budget-preview'
      ? {
          before: 30,
          fromUncategorized: 4,
          categoriesCleared: 5,
          categoriesKept: 1,
          transfers: Array.from({ length: state.transfers }, (_, i) =>
            transfer(i),
          ),
          startingBalance: 2_000_00,
        }
      : undefined,
  ),
}));

function renderModal() {
  render(
    <TestProviders>
      <MoveOnBudgetModal accountId="vanguard" />
    </TestProviders>,
  );
}

describe('MoveOnBudgetModal', () => {
  beforeEach(() => {
    state.isNarrowWidth = false;
    state.transfers = 3;
    vi.mocked(send).mockClear();
  });

  // Tests fix "today" at 2017-01-01
  it('The default start date: the 1st of the current month', async () => {
    renderModal();
    expect(screen.getByLabelText('Budget it from')).toHaveValue('2017-01-01');
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith('account-move-on-budget-preview', {
        id: 'vanguard',
        startDate: '2017-01-01',
      }),
    );
  });

  it('Counts match the account', async () => {
    renderModal();
    expect(
      await screen.findByText(
        '30 transactions before 01/01/2017 become uncategorized.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('5 categories will be cleared.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '4 transactions from 01/01/2017 have no category, and 1 keep their category.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('2,000.00')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Transfers' });
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent(
      '09/12/2026 · Checking · 500.00 · keeps Savings',
    );
  });

  it('Many transfers: lists the newest 20, then "and N more"', async () => {
    state.transfers = 25;
    renderModal();
    expect(await screen.findByText('25 transfers:')).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Transfers' })).getAllByRole(
        'listitem',
      ),
    ).toHaveLength(20);
    expect(screen.getByText('and 5 more')).toBeInTheDocument();
  });

  it('Cancelling changes nothing', async () => {
    renderModal();
    await screen.findByText('5 categories will be cleared.');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(send).not.toHaveBeenCalledWith(
      'account-move-on-budget',
      expect.anything(),
    );
  });

  it('moves the account with the chosen start date after one confirmation', async () => {
    renderModal();
    const date = screen.getByLabelText('Budget it from');
    await userEvent.clear(date);
    await userEvent.type(date, '2026-07-01');
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith('account-move-on-budget-preview', {
        id: 'vanguard',
        startDate: '2026-07-01',
      }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Move on budget' }),
    );
    expect(send).toHaveBeenCalledWith('account-move-on-budget', {
      id: 'vanguard',
      startDate: '2026-07-01',
    });
  });

  it('gives every control a touch-sized height on a phone', async () => {
    state.isNarrowWidth = true;
    renderModal();
    await screen.findByText('5 categories will be cleared.');
    for (const control of [
      screen.getByLabelText('Budget it from'),
      screen.getByRole('button', { name: 'Cancel' }),
      screen.getByRole('button', { name: 'Move on budget' }),
    ]) {
      expect(control).toHaveStyle({ minHeight: '40px' });
    }
  });
});
