import React from 'react';
import { MemoryRouter } from 'react-router';

import { generateAccount } from '@actual-app/core/mocks';
import { send } from '@actual-app/core/platform/client/connection';
import { q } from '@actual-app/core/shared/query';
import type { AccountEntity } from '@actual-app/core/types/models';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useSheetValue } from '#hooks/useSheetValue';
import { createTestAppStore, TestProviders } from '#mocks';

import { ReconcileMenu, ReconcilingMessage } from './Reconcile';

vi.mock('#hooks/useSheetValue', () => ({
  useSheetValue: vi.fn(),
}));

vi.mock('@actual-app/core/platform/client/connection', () => ({
  send: vi.fn(),
}));

// Use actual arithmetic and util functions for real math behavior
// (we rely on default decimalPlaces=2 semantics for integer amounts)

describe('ReconcilingMessage math & UI', () => {
  // useSheetValue is mocked above via relative path

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeBalanceQuery() {
    return {
      name: 'balance-query-test' as const,
      query: q('transactions'),
    };
  }

  test('shows "All reconciled!" when target matches cleared', async () => {
    vi.mocked(useSheetValue).mockReturnValue(5000);

    const onDone = vi.fn();
    const onCreateTransaction = vi.fn();

    render(
      <TestProviders>
        <ReconcilingMessage
          balanceQuery={makeBalanceQuery()}
          targetBalance={5000}
          onDone={onDone}
          onCreateTransaction={onCreateTransaction}
        />
      </TestProviders>,
    );

    expect(screen.getByText('All reconciled!')).toBeInTheDocument();
    // No reconciliation transaction button when diff is zero
    expect(
      screen.queryByText('Create reconciliation transaction'),
    ).not.toBeInTheDocument();

    // Done button triggers callback
    await userEvent.click(screen.getByText('Lock transactions'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  test('computes positive difference and passes correct amount', async () => {
    // cleared = 30.00, bank = 100.00 => diff = +70.00
    vi.mocked(useSheetValue).mockReturnValue(3000);
    const onCreateTransaction = vi.fn();

    render(
      <TestProviders>
        <ReconcilingMessage
          balanceQuery={makeBalanceQuery()}
          targetBalance={10000}
          onDone={vi.fn()}
          onCreateTransaction={onCreateTransaction}
        />
      </TestProviders>,
    );

    // Formatted amounts present
    expect(screen.getByText('30.00')).toBeInTheDocument();
    expect(screen.getByText('100.00')).toBeInTheDocument();
    // Positive diff shows plus sign
    expect(screen.getByText('+70.00')).toBeInTheDocument();

    await userEvent.click(
      screen.getByText('Create reconciliation transaction'),
    );
    expect(onCreateTransaction).toHaveBeenCalledWith(7000);
  });

  test('computes negative difference and passes correct amount', async () => {
    // cleared = 120.00, bank = 100.00 => diff = -20.00
    vi.mocked(useSheetValue).mockReturnValue(12000);
    const onCreateTransaction = vi.fn();

    render(
      <TestProviders>
        <ReconcilingMessage
          balanceQuery={makeBalanceQuery()}
          targetBalance={10000}
          onDone={vi.fn()}
          onCreateTransaction={onCreateTransaction}
        />
      </TestProviders>,
    );

    expect(screen.getByText('120.00')).toBeInTheDocument();
    expect(screen.getByText('100.00')).toBeInTheDocument();
    expect(screen.getByText('-20.00')).toBeInTheDocument();

    await userEvent.click(
      screen.getByText('Create reconciliation transaction'),
    );
    expect(onCreateTransaction).toHaveBeenCalledWith(-2000);
  });
});

type Resolved = {
  prefill: unknown;
  alternatives: unknown[];
  cleared_balance: number;
  record: null;
  account_type: string | null;
};

const BANK = {
  amount: 46541,
  source: 'bank-sync',
  as_of: '2026-11-14',
  link: 'bank-sync',
} as const;
const cleared = (amount: number) =>
  ({ amount, source: 'cleared', as_of: null, link: null }) as const;

function mockResolver(over: Partial<Resolved> = {}) {
  const resolved: Resolved = {
    prefill: BANK,
    alternatives: [cleared(1000)],
    cleared_balance: 1000,
    record: null,
    account_type: 'checking',
    ...over,
  };
  vi.mocked(send).mockImplementation((async (name: string) =>
    name === 'account-statement-balance-prefill'
      ? resolved
      : undefined) as never);
}

const saveCalls = () =>
  vi
    .mocked(send)
    .mock.calls.filter(([name]) => name === 'account-statement-balance-save');

describe('ReconcileMenu source and recorded balance (native-reconcile-flow 1.2, 1.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSheetValue).mockReturnValue(1000);
    mockResolver();
  });

  const account = generateAccount('Checking', true, false) as AccountEntity;
  account.account_sync_source = 'simpleFin';

  function open() {
    const onReconcile = vi.fn();
    const onClose = vi.fn();
    const store = createTestAppStore();
    render(
      <TestProviders store={store}>
        <MemoryRouter>
          <ReconcileMenu
            account={account}
            onReconcile={onReconcile}
            onClose={onClose}
          />
        </MemoryRouter>
      </TestProviders>,
    );
    return { onReconcile, onClose, store };
  }

  test('pre-fills the recent bank balance, never the cleared balance, with an always-visible source line', async () => {
    open();
    expect(await screen.findByRole('textbox')).toHaveValue('465.41');
    expect(
      screen.getByText(/From SimpleFIN balance, synced/),
    ).toBeInTheDocument();
    // not hidden behind hover or focus
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  test('focusing the icon adds the explanation and Bank Sync Settings', async () => {
    open();
    await screen.findByRole('textbox');
    act(() => {
      screen.getByRole('button', { name: 'About this balance' }).focus();
    });
    expect(screen.getByRole('note')).toHaveTextContent(
      'May include pending items. Compare with your statement.',
    );
    expect(
      screen.getByRole('button', { name: 'Bank Sync Settings…' }),
    ).toBeInTheDocument();
  });

  test('confirming the unedited bank balance records bank-sync and reconciles', async () => {
    const { onReconcile, onClose } = open();
    await screen.findByRole('textbox');
    await userEvent.click(screen.getByRole('button', { name: 'Reconcile' }));
    expect(saveCalls()).toEqual([
      [
        'account-statement-balance-save',
        {
          account_id: account.id,
          amount: 46541,
          source: 'bank-sync',
          as_of: '2026-11-14',
        },
      ],
    ]);
    expect(onReconcile).toHaveBeenCalledWith(46541);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('editing reads Entered by you, and confirming records entered with the evaluated amount', async () => {
    const { onReconcile } = open();
    const input = await screen.findByRole('textbox');
    await userEvent.clear(input);
    await userEvent.type(input, '100+25.50-10');
    expect(screen.getByText('Entered by you')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reconcile' }));
    expect(saveCalls()[0][1]).toMatchObject({
      amount: 11550,
      source: 'entered',
    });
    expect(onReconcile).toHaveBeenCalledWith(11550);
  });

  test('Restore bank balance puts the pre-fill back', async () => {
    open();
    const input = await screen.findByRole('textbox');
    await userEvent.clear(input);
    await userEvent.type(input, '5');
    await userEvent.click(
      screen.getByRole('button', { name: 'Restore bank balance' }),
    );
    expect(input).toHaveValue('465.41');
    expect(screen.queryByText('Entered by you')).not.toBeInTheDocument();
    expect(screen.getByText(/From SimpleFIN balance/)).toBeInTheDocument();
  });

  test('a stale bank balance is offered, not pre-filled, and saves bank-sync with its own date', async () => {
    mockResolver({
      prefill: null,
      alternatives: [{ ...BANK, as_of: '2026-11-02' }, cleared(1000)],
    });
    const { onReconcile } = open();
    const input = await screen.findByRole('textbox');
    expect(input).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Reconcile' })).toBeDisabled();
    await userEvent.click(
      screen.getByRole('button', { name: /Use bank balance from/ }),
    );
    expect(input).toHaveValue('465.41');
    await userEvent.click(screen.getByRole('button', { name: 'Reconcile' }));
    expect(saveCalls()[0][1]).toMatchObject({
      source: 'bank-sync',
      as_of: '2026-11-02',
    });
    expect(onReconcile).toHaveBeenCalledWith(46541);
  });

  test('with no source the field is empty with a hint, and the cleared balance is a choice with its caveat', async () => {
    mockResolver({ prefill: null });
    open();
    expect(await screen.findByRole('textbox')).toHaveValue('');
    expect(
      screen.getByText(/Enter the closing balance from your statement/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconcile' })).toBeDisabled();
    expect(screen.getByText('No recent bank balance')).toBeInTheDocument();
    expect(
      screen.getAllByText(/closing balance from your statement/),
    ).toHaveLength(1);
    expect(
      screen.getByText('Your own cleared total — not an independent check'),
    ).toBeInTheDocument();
  });

  test('Use cleared balance records cleared, says why the assistant cannot use it, and still reconciles', async () => {
    mockResolver({ prefill: null });
    const { onReconcile, onClose, store } = open();
    await screen.findByRole('textbox');
    await userEvent.click(
      screen.getByRole('button', { name: 'Use cleared balance' }),
    );
    expect(screen.getByRole('textbox')).toHaveValue('10.00');
    await userEvent.click(screen.getByRole('button', { name: 'Reconcile' }));
    expect(saveCalls()[0][1]).toMatchObject({
      amount: 1000,
      source: 'cleared',
    });
    expect(store.getState().notifications.notifications[0].message).toMatch(
      /not a statement, so an assistant cannot use it/,
    );
    expect(onReconcile).toHaveBeenCalledWith(1000);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('no note after an unedited bank balance', async () => {
    const { store } = open();
    await screen.findByRole('textbox');
    await userEvent.click(screen.getByRole('button', { name: 'Reconcile' }));
    expect(store.getState().notifications.notifications).toHaveLength(0);
  });

  test('leaving without confirming saves nothing', async () => {
    open();
    await screen.findByRole('textbox');
    expect(saveCalls()).toHaveLength(0);
  });

  test('a failed save still reconciles', async () => {
    vi.mocked(send).mockImplementation((async (name: string) => {
      if (name === 'account-statement-balance-save') throw new Error('no');
      return {
        prefill: BANK,
        alternatives: [cleared(1000)],
        cleared_balance: 1000,
        record: null,
        account_type: null,
      };
    }) as never);
    const { onReconcile, store } = open();
    await screen.findByRole('textbox');
    await userEvent.click(screen.getByRole('button', { name: 'Reconcile' }));
    expect(onReconcile).toHaveBeenCalledWith(46541);
    expect(store.getState().notifications.notifications[0].message).toMatch(
      /Nothing was recorded for your assistant/,
    );
  });

  test('text with no digits does not reconcile', async () => {
    const { onReconcile, onClose } = open();
    const input = await screen.findByRole('textbox');
    await userEvent.clear(input);
    await userEvent.type(input, 'abcd');
    await userEvent.click(screen.getByRole('button', { name: 'Reconcile' }));
    expect(onReconcile).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(saveCalls()).toHaveLength(0);
  });
});
