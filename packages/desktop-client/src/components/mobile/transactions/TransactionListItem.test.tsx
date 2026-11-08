import type { ListBoxItemRenderProps } from 'react-aria-components';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AttachmentsProvider } from '#components/transactions/TransactionAttachments';
import { TestProviders } from '#mocks';

import { TransactionListItem } from './TransactionListItem';

vi.mock('@actual-app/components/hooks/useResponsive', () => ({
  useResponsive: () => ({ isNarrowWidth: true, isNarrowWidthLoaded: true }),
}));

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
const attachmentRows = vi.hoisted(() => ({ value: [] as unknown[] }));
vi.mock('#hooks/useQuery', () => ({
  useQuery: () => ({ data: attachmentRows.value, isLoading: false }),
}));

function renderRow(
  id: string,
  date: string,
  extra: Record<string, unknown> = {},
  onPress = vi.fn(),
  props: Record<string, unknown> = {},
) {
  render(
    <TestProviders>
      <AttachmentsProvider>
        <TransactionListItem
          transaction={
            {
              id,
              date,
              account: 'vanguard',
              amount: 100,
              category: null,
              ...extra,
            } as never
          }
          onPress={onPress}
          onLongPress={vi.fn()}
          {...props}
          {...({} as ListBoxItemRenderProps)}
        />
      </AttachmentsProvider>
    </TestProviders>,
  );
}

describe('Paperclip on phone transaction rows', () => {
  afterEach(() => {
    attachmentRows.value = [];
  });

  it('Paperclip on a phone row', async () => {
    attachmentRows.value = [
      {
        id: 'a1',
        transaction_id: 't1',
        name: 'r.pdf',
        mime: 'application/pdf',
      },
    ];
    const onPress = vi.fn();
    renderRow('t1', '2026-11-05', {}, onPress);

    expect(screen.getByLabelText('Has attached documents')).toBeInTheDocument();
    // The row is still the press target that opens the edit screen
    await userEvent.click(screen.getByText('Payee'));
    expect(onPress).toHaveBeenCalled();
  });

  it('No paperclip on a phone row', () => {
    renderRow('t1', '2026-11-05');

    expect(screen.queryByLabelText('Has attached documents')).toBeNull();
  });

  it("Split line shows the parent's paperclip", () => {
    attachmentRows.value = [
      {
        id: 'a1',
        transaction_id: 'parent',
        name: 'r.pdf',
        mime: 'application/pdf',
      },
    ];
    renderRow('child', '2026-11-05', { parent_id: 'parent', is_child: true });

    expect(screen.getByLabelText('Has attached documents')).toBeInTheDocument();
  });
});

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

describe('Tapping a tag in a phone row', () => {
  it('reports the tag and does not open the transaction', async () => {
    const onPress = vi.fn();
    const onNotesTagClick = vi.fn();
    renderRow('t1', '2026-11-05', { notes: 'Hotel #vacation' }, onPress, {
      onNotesTagClick,
    });

    await userEvent.click(
      screen.getByRole('button', { name: 'Filter by #vacation' }),
    );

    expect(onNotesTagClick).toHaveBeenCalledWith('#vacation');
    expect(onPress).not.toHaveBeenCalled();
  });

  it('still opens the transaction when the plain text is tapped', async () => {
    const onPress = vi.fn();
    renderRow('t1', '2026-11-05', { notes: 'Hotel #vacation' }, onPress, {
      onNotesTagClick: vi.fn(),
    });

    await userEvent.click(screen.getByText(/Hotel/));

    expect(onPress).toHaveBeenCalled();
  });

  it('offers no tag button when the list passes no handler', () => {
    renderRow('t1', '2026-11-05', { notes: 'Hotel #vacation' });

    expect(screen.queryByRole('button', { name: /Filter by/ })).toBeNull();
  });
});
