import { MemoryRouter } from 'react-router';

import type { AccountEntity } from '@actual-app/core/types/models';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetTestProviders, TestProviders } from '#mocks';

import { AccountTransactions } from './AccountTransactions';

const state = vi.hoisted(() => ({
  query: undefined as { serialize: () => unknown } | undefined,
}));

// Stands in for the server: each condition becomes a marker filter
vi.mock('@actual-app/core/platform/client/connection', async importActual => ({
  ...(await importActual<object>()),
  send: vi.fn(
    async (_name: string, args: { conditions: { value: string }[] }) => ({
      filters: args.conditions.map(c => ({ marker: c.value })),
    }),
  ),
  listen: () => vi.fn(),
}));
vi.mock('#accounts', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSyncAndDownloadMutation: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('#hooks/useCachedSchedules', () => ({
  SchedulesProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock('#hooks/useTransactions', () => ({
  calculateRunningBalancesTopDown: vi.fn(),
  useTransactions: ({ query }: { query?: { serialize: () => unknown } }) => {
    state.query = query;
    return {
      transactions: [],
      runningBalances: new Map(),
      isPending: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    };
  },
}));
vi.mock('#hooks/useAccountPreviewTransactions', () => ({
  useAccountPreviewTransactions: () => ({
    previewTransactions: [],
    runningBalances: new Map(),
    isLoading: false,
  }),
}));
vi.mock('#hooks/useSheetValue', () => ({ useSheetValue: () => 0 }));
vi.mock('#components/schedules/ClearingAccount', () => ({
  ClearingAccountNote: () => null,
}));
vi.mock('#components/mobile/transactions/TransactionListWithBalances', () => ({
  TransactionListWithBalances: (props: {
    onSearch: (text: string) => void;
    onNotesTagClick?: (tag: string) => void;
    tagFilter?: string;
    onClearTagFilter?: () => void;
    filtered?: boolean;
  }) => (
    <div>
      <input
        aria-label="search"
        onChange={event => props.onSearch(event.target.value)}
      />
      <button onClick={() => props.onNotesTagClick?.('#vacation')}>
        tap #vacation
      </button>
      <button onClick={() => props.onNotesTagClick?.('#work')}>
        tap #work
      </button>
      {props.tagFilter && (
        <button onClick={props.onClearTagFilter}>
          clear {props.tagFilter}
        </button>
      )}
      {props.filtered && <span>Filters applied</span>}
    </div>
  ),
}));

const drillDown = { field: 'category', op: 'is', value: 'groceries' };

function renderAccount(filterConditions?: unknown[]) {
  render(
    <TestProviders>
      <MemoryRouter
        initialEntries={[
          { pathname: '/accounts/checking', state: { filterConditions } },
        ]}
      >
        <AccountTransactions
          account={{ id: 'checking', name: 'Checking' } as AccountEntity}
        />
      </MemoryRouter>
    </TestProviders>,
  );
}

const queryText = () => JSON.stringify(state.query?.serialize() ?? {});

describe('AccountTransactions tag and filter conditions', () => {
  beforeEach(() => {
    resetTestProviders();
    state.query = undefined;
  });

  it('applies filterConditions from navigation state to the account query', async () => {
    renderAccount([drillDown]);
    await waitFor(() => expect(queryText()).toContain('"marker":"groceries"'));
    expect(screen.getByText('Filters applied')).toBeInTheDocument();
  });

  it('shows no filter when none is passed', () => {
    renderAccount();
    expect(queryText()).not.toContain('marker');
    expect(screen.queryByText('Filters applied')).toBeNull();
  });

  it('tapping a tag filters the list and shows the tag chip, without "Filters applied"', async () => {
    renderAccount();
    await userEvent.click(screen.getByText('tap #vacation'));
    await waitFor(() => expect(queryText()).toContain('"marker":"#vacation"'));
    expect(screen.getByText('clear #vacation')).toBeInTheDocument();
    expect(screen.queryByText('Filters applied')).toBeNull();
  });

  it('clearing the chip removes the tag filter', async () => {
    renderAccount();
    await userEvent.click(screen.getByText('tap #vacation'));
    await userEvent.click(await screen.findByText('clear #vacation'));
    await waitFor(() => expect(queryText()).not.toContain('marker'));
    expect(screen.queryByText('clear #vacation')).toBeNull();
  });

  it('a second tag replaces the first', async () => {
    renderAccount();
    await userEvent.click(screen.getByText('tap #vacation'));
    await userEvent.click(screen.getByText('tap #work'));
    await waitFor(() => expect(queryText()).toContain('"marker":"#work"'));
    expect(queryText()).not.toContain('#vacation');
    expect(screen.getByText('clear #work')).toBeInTheDocument();
  });

  it('keeps drill-down conditions when a tag is tapped and cleared', async () => {
    renderAccount([drillDown]);
    await userEvent.click(screen.getByText('tap #vacation'));
    await waitFor(() => expect(queryText()).toContain('"marker":"#vacation"'));
    expect(queryText()).toContain('"marker":"groceries"');
    expect(screen.getByText('Filters applied')).toBeInTheDocument();
    await userEvent.click(screen.getByText('clear #vacation'));
    await waitFor(() => expect(queryText()).not.toContain('#vacation'));
    expect(queryText()).toContain('"marker":"groceries"');
  });

  it('a tag filter and search text both apply, and clearing either leaves the other', async () => {
    renderAccount();
    await userEvent.click(screen.getByText('tap #vacation'));
    await userEvent.type(screen.getByLabelText('search'), 'hotel');
    await waitFor(() => expect(queryText()).toContain('%hotel%'));
    expect(queryText()).toContain('"marker":"#vacation"');

    await userEvent.click(screen.getByText('clear #vacation'));
    // The search is re-applied after its debounce
    await waitFor(() => {
      expect(queryText()).toContain('%hotel%');
      expect(queryText()).not.toContain('#vacation');
    });

    await userEvent.click(screen.getByText('tap #work'));
    await waitFor(() => expect(queryText()).toContain('"marker":"#work"'));
    await userEvent.clear(screen.getByLabelText('search'));
    await waitFor(() => {
      expect(queryText()).not.toContain('%hotel%');
      expect(queryText()).toContain('"marker":"#work"');
    });
  });
});
