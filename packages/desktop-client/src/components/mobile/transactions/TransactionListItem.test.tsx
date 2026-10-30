import type { ListBoxItemRenderProps } from 'react-aria-components';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { TransactionListItem } from './TransactionListItem';

const state = vi.hoisted(() => ({ account: {} as Record<string, unknown> }));

vi.mock('#hooks/useAccount', () => ({
  useAccount: (id: string) => (id === 'vanguard' ? state.account : undefined),
}));
vi.mock('#hooks/useCategories', () => ({
  useCategories: () => ({ data: { list: [] } }),
}));
vi.mock('#hooks/usePayee', () => ({ usePayee: () => ({ data: undefined }) }));
vi.mock('#hooks/useDisplayPayee', () => ({ useDisplayPayee: () => 'Payee' }));
vi.mock('#hooks/useCachedSchedules', () => ({
  useCachedSchedules: () => ({ schedules: [] }),
}));

function renderRow(id: string, date: string) {
  render(
    <TestProviders>
      <TransactionListItem
        transaction={
          {
            id,
            date,
            account: 'vanguard',
            amount: 100,
            category: null,
          } as never
        }
        onPress={vi.fn()}
        onLongPress={vi.fn()}
        {...({} as ListBoxItemRenderProps)}
      />
    </TestProviders>,
  );
}

describe('TransactionListItem category line', () => {
  it('says "Moved history" before the start date and for the offset line', () => {
    state.account = {
      offbudget: 0,
      budget_start_date: '2016-10-01',
      budget_start_offset: 'offset',
    };
    renderRow('t1', '2016-09-15');
    expect(screen.getByText('Moved history')).toBeInTheDocument();
  });

  it('says "Moved history" for the offset line', () => {
    renderRow('offset', '2016-10-01');
    expect(screen.getAllByText('Moved history').length).toBeGreaterThan(0);
  });

  it('says "Uncategorized" from the start date on', () => {
    renderRow('t2', '2016-10-05');
    expect(screen.getByText('Uncategorized')).toBeInTheDocument();
  });

  it('says "Uncategorized" for a never-moved account', () => {
    state.account = { offbudget: 0 };
    renderRow('t3', '2000-01-01');
    expect(screen.getByText('Uncategorized')).toBeInTheDocument();
  });
});
