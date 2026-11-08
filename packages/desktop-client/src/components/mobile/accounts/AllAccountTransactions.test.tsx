import { MemoryRouter } from 'react-router';

import { send } from '@actual-app/core/platform/client/connection';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetTestProviders, TestProviders } from '#mocks';

import { AllAccountTransactions } from './AllAccountTransactions';

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
vi.mock('#hooks/useCachedSchedules', () => ({
  SchedulesProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock('#hooks/useTransactions', () => ({
  useTransactions: ({ query }: { query?: { serialize: () => unknown } }) => {
    state.query = query;
    return {
      transactions: [],
      isPending: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    };
  },
}));
vi.mock('#hooks/usePreviewTransactions', () => ({
  usePreviewTransactions: () => ({
    previewTransactions: [],
    isLoading: false,
  }),
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

function renderAll(filterConditions?: unknown[]) {
  render(
    <TestProviders>
      <MemoryRouter
        initialEntries={[
          { pathname: '/accounts', state: { filterConditions } },
        ]}
      >
        <AllAccountTransactions />
      </MemoryRouter>
    </TestProviders>,
  );
}

const queryText = () => JSON.stringify(state.query?.serialize() ?? {});

describe('AllAccountTransactions tag and filter conditions', () => {
  beforeEach(() => {
    resetTestProviders();
    state.query = undefined;
  });

  it('still applies drill-down filterConditions and shows "Filters applied"', async () => {
    renderAll([drillDown]);
    await waitFor(() => expect(queryText()).toContain('"marker":"groceries"'));
    expect(screen.getByText('Filters applied')).toBeInTheDocument();
  });

  it('tapping a tag filters the list and shows the tag chip, without "Filters applied"', async () => {
    renderAll();
    await userEvent.click(screen.getByText('tap #vacation'));
    await waitFor(() => expect(queryText()).toContain('"marker":"#vacation"'));
    expect(screen.getByText('clear #vacation')).toBeInTheDocument();
    expect(screen.queryByText('Filters applied')).toBeNull();
  });

  it('clearing the chip returns to the unfiltered list', async () => {
    renderAll();
    await userEvent.click(screen.getByText('tap #vacation'));
    await userEvent.click(await screen.findByText('clear #vacation'));
    await waitFor(() => expect(queryText()).not.toContain('marker'));
    expect(queryText()).not.toBe('{}');
    expect(screen.queryByText('clear #vacation')).toBeNull();
  });

  it('a second tag replaces the first', async () => {
    renderAll();
    await userEvent.click(screen.getByText('tap #vacation'));
    await userEvent.click(screen.getByText('tap #work'));
    await waitFor(() => expect(queryText()).toContain('"marker":"#work"'));
    expect(queryText()).not.toContain('#vacation');
  });

  it('keeps drill-down conditions when a tag is tapped and cleared', async () => {
    renderAll([drillDown]);
    await userEvent.click(screen.getByText('tap #vacation'));
    await waitFor(() => expect(queryText()).toContain('"marker":"#vacation"'));
    expect(queryText()).toContain('"marker":"groceries"');
    await userEvent.click(screen.getByText('clear #vacation'));
    await waitFor(() => expect(queryText()).not.toContain('#vacation'));
    expect(queryText()).toContain('"marker":"groceries"');
    expect(screen.getByText('Filters applied')).toBeInTheDocument();
  });

  it('a tag filter and search text both apply', async () => {
    renderAll();
    await userEvent.click(screen.getByText('tap #vacation'));
    await userEvent.type(screen.getByLabelText('search'), 'hotel');
    await waitFor(() => expect(queryText()).toContain('%hotel%'));
    expect(queryText()).toContain('"marker":"#vacation"');
  });

  it('holds back the list while the new filter is being resolved', async () => {
    renderAll();
    await waitFor(() => expect(state.query).toBeDefined());
    const pending: { resolve?: (value: { filters: unknown[] }) => void } = {};
    vi.mocked(send).mockImplementationOnce(
      () => new Promise(r => (pending.resolve = r)) as never,
    );

    await userEvent.click(screen.getByText('tap #vacation'));
    expect(state.query).toBeUndefined();

    pending.resolve?.({ filters: [{ marker: '#vacation' }] });
    await waitFor(() => expect(queryText()).toContain('"marker":"#vacation"'));
  });
});
