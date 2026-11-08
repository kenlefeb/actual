import type { ComponentProps } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { TransactionListWithBalances } from './TransactionListWithBalances';

vi.mock('#hooks/useDisplayPayee', () => ({
  DisplayPayeeProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock('#hooks/useSheetValue', () => ({ useSheetValue: () => 0 }));
vi.mock('#components/spreadsheet/CellValue', () => ({
  CellValue: () => null,
  CellValueText: () => null,
}));
vi.mock('./TransactionList', () => ({
  TransactionList: ({
    onNotesTagClick,
  }: {
    onNotesTagClick?: (tag: string) => void;
  }) => (
    <button onClick={() => onNotesTagClick?.('#vacation')}>
      list tag handler
    </button>
  ),
}));

const balance = { name: 'balance', query: {} } as never;

function renderList(
  props: Partial<ComponentProps<typeof TransactionListWithBalances>>,
) {
  render(
    <TestProviders>
      <TransactionListWithBalances
        isLoading={false}
        transactions={[]}
        balance={balance}
        searchPlaceholder="Search"
        onSearch={vi.fn()}
        isLoadingMore={false}
        onLoadMore={vi.fn()}
        onOpenTransaction={vi.fn()}
        {...props}
      />
    </TestProviders>,
  );
}

describe.each([
  ['the usual layout', {}],
  [
    'the reconcile layout',
    { balanceCleared: balance, balanceUncleared: balance, isReconciling: true },
  ],
])('Tag filter chip in %s', (_name, layout) => {
  it('shows the tag and clears it from the chip', async () => {
    const onClearTagFilter = vi.fn();
    renderList({ ...layout, tagFilter: '#vacation', onClearTagFilter });

    expect(screen.getByText('#vacation')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove filter #vacation' }),
    );
    expect(onClearTagFilter).toHaveBeenCalled();
  });

  it('shows no chip without a tag filter', () => {
    renderList({ ...layout });
    expect(screen.queryByRole('button', { name: /Remove filter/ })).toBeNull();
  });

  it('hands the tag handler to the list', async () => {
    const onNotesTagClick = vi.fn();
    renderList({ ...layout, onNotesTagClick });
    await userEvent.click(screen.getByText('list tag handler'));
    expect(onNotesTagClick).toHaveBeenCalledWith('#vacation');
  });
});
