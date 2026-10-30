import { send } from '@actual-app/core/platform/client/connection';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { MoveOnBudgetModal } from './MoveOnBudgetModal';

const COUNTS = {
  before: 30,
  fromUncategorized: 4,
  categoriesCleared: 5,
  categoriesKept: 1,
};

const state = vi.hoisted(() => ({
  isNarrowWidth: false,
  transfers: 3,
  counts: {} as Record<string, number>,
}));

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
          startingBalance: 2_000_00,
          ...state.counts,
          transfers: Array.from({ length: state.transfers }, (_, i) =>
            transfer(i),
          ),
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
    state.counts = { ...COUNTS };
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

  it('Counts match the account, after the starting balance', async () => {
    renderModal();
    const lead = await screen.findByText(/^Your budget gains/);
    expect(lead).toHaveTextContent(
      'Your budget gains 2,000.00 on 01/01/2017, in Starting Balances.',
    );
    const lines = [
      "30 transactions before 01/01/2017 are covered by the starting balance. They show as moved history and aren't counted as uncategorized.",
      '4 transactions from 01/01/2017 need a category.',
      '1 keeps its category.',
      '5 categories will be cleared.',
      "The account balance and earlier months don't change.",
    ].map(text => screen.getByText(text));
    // In this order, after the lead
    const ordered = [lead, ...lines];
    for (const [earlier, later] of ordered
      .slice(1)
      .map((line, i) => [ordered[i], line])) {
      expect(
        earlier.compareDocumentPosition(later) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    const list = screen.getByRole('list', { name: 'Transfers' });
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent(
      '09/12/2026 · Checking · 500.00 · keeps Savings',
    );
  });

  it('uses singular wording for counts of one', async () => {
    state.transfers = 21;
    state.counts = {
      before: 1,
      fromUncategorized: 1,
      categoriesCleared: 1,
      categoriesKept: 1,
    };
    renderModal();
    expect(
      await screen.findByText(
        "1 transaction before 01/01/2017 is covered by the starting balance. It shows as moved history and isn't counted as uncategorized.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('1 transaction from 01/01/2017 needs a category.'),
    ).toBeInTheDocument();
    expect(screen.getByText('1 keeps its category.')).toBeInTheDocument();
    expect(screen.getByText('1 category will be cleared.')).toBeInTheDocument();
    expect(screen.getByText('and 1 more')).toBeInTheDocument();
  });

  it('hides zero counts but always shows the starting balance', async () => {
    state.transfers = 0;
    state.counts = {
      before: 0,
      fromUncategorized: 0,
      categoriesCleared: 0,
      categoriesKept: 0,
    };
    renderModal();
    expect(await screen.findByText(/^Your budget gains/)).toBeInTheDocument();
    expect(screen.queryByText(/covered by the starting balance/)).toBe(null);
    expect(screen.queryByText(/need.? a category/)).toBe(null);
    expect(screen.queryByText(/its category|their category/)).toBe(null);
    expect(screen.queryByText(/will be cleared/)).toBe(null);
    expect(screen.queryByRole('list', { name: 'Transfers' })).toBe(null);
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

  it('describes a negative starting balance as a reduction', async () => {
    state.counts = { ...COUNTS, startingBalance: -20_00 };
    renderModal();
    expect(
      await screen.findByText(/^Your budget is reduced by/),
    ).toHaveTextContent(
      'Your budget is reduced by 20.00 on 01/01/2017, in Starting Balances.',
    );
    expect(screen.queryByText(/^Your budget gains/)).toBe(null);
  });

  it("keeps the phone scroll area's children at their height, so it scrolls", async () => {
    state.isNarrowWidth = true;
    state.transfers = 25;
    renderModal();
    await screen.findByText('25 transfers:');
    const area = screen.getByTestId('move-on-budget-scroll');
    // jsdom doesn't compute vh, so check the scrolling itself
    expect(area).toHaveStyle({ overflowY: 'auto' });
    expect(area.children.length).toBeGreaterThan(1);
    for (const child of Array.from(area.children)) {
      expect(child).toHaveStyle({ flexShrink: '0' });
    }
  });

  it("says the budget doesn't change when the starting balance is zero", async () => {
    state.counts = { ...COUNTS, startingBalance: 0 };
    renderModal();
    expect(
      await screen.findByText("Your budget doesn't change."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Your budget gains/)).toBe(null);
  });
});
