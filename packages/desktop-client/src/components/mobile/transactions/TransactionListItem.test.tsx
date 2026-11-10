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

describe('Notes line of a phone row', () => {
  const notes = 'Hotel #vacation https://example.com';

  it.each([
    ['a normal row', {}],
    ['a reconciling row', { isReconciling: true }],
  ])('keeps the tag and the link out of the row button in %s', (_, props) => {
    renderRow('t1', '2026-11-05', { notes }, vi.fn(), {
      onNotesTagClick: vi.fn(),
      ...props,
    });

    const tag = screen.getByRole('button', { name: 'Filter by #vacation' });
    const link = screen.getByRole('link', { name: 'https://example.com' });

    expect(tag.closest('button')).toBeNull();
    expect(link.closest('button')).toBeNull();
  });

  it('keeps the payee and the amount in the row button', () => {
    renderRow('t1', '2026-11-05', { notes }, vi.fn(), {
      onNotesTagClick: vi.fn(),
    });

    const rowButton = screen.getByText('Payee').closest('button');
    expect(rowButton).not.toBeNull();
    expect(rowButton).toHaveTextContent('1.00');
  });

  it('opens the transaction when the notes line is tapped away from a tag', async () => {
    const onPress = vi.fn();
    renderRow('t1', '2026-11-05', { notes }, onPress, {
      onNotesTagClick: vi.fn(),
    });

    await userEvent.click(screen.getByText(/Hotel/));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('selects the transaction when the notes line is long-pressed', async () => {
    const onLongPress = vi.fn();
    renderRow('t1', '2026-11-05', { notes }, vi.fn(), {
      onNotesTagClick: vi.fn(),
      onLongPress,
    });

    await userEvent.pointer({
      keys: '[MouseLeft>]',
      target: screen.getByText(/Hotel/),
    });
    await new Promise(resolve => setTimeout(resolve, 700));

    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('does nothing when a tag is long-pressed', async () => {
    const onPress = vi.fn();
    const onLongPress = vi.fn();
    const onNotesTagClick = vi.fn();
    renderRow('t1', '2026-11-05', { notes }, onPress, {
      onNotesTagClick,
      onLongPress,
    });

    const tag = screen.getByRole('button', { name: 'Filter by #vacation' });
    await userEvent.pointer({ keys: '[MouseLeft>]', target: tag });
    await new Promise(resolve => setTimeout(resolve, 700));
    await userEvent.pointer({ keys: '[/MouseLeft]', target: tag });

    expect(onLongPress).not.toHaveBeenCalled();
    expect(onPress).not.toHaveBeenCalled();
  });

  it('still opens the transaction on a row tap after a link tap that opened a new window', async () => {
    const onPress = vi.fn();
    renderRow('t1', '2026-11-05', { notes }, onPress, {
      onNotesTagClick: vi.fn(),
    });

    // The link opens a new window, so the page never sees the press end
    await userEvent.pointer({
      keys: '[MouseLeft>]',
      target: screen.getByRole('link', { name: 'https://example.com' }),
    });
    expect(onPress).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText('Payee'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('keeps the link a link', () => {
    renderRow('t1', '2026-11-05', { notes }, vi.fn(), {
      onNotesTagClick: vi.fn(),
    });

    expect(
      screen.getByRole('link', { name: 'https://example.com' }),
    ).toHaveAttribute('href', 'https://example.com');
  });
});
