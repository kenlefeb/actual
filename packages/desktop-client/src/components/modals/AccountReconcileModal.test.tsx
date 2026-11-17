import { MemoryRouter } from 'react-router';

import { generateAccount } from '@actual-app/core/mocks';
import { send } from '@actual-app/core/platform/client/connection';
import type { AccountEntity } from '@actual-app/core/types/models';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { createTestAppStore, TestProviders } from '#mocks';

import { AccountReconcileModal } from './AccountReconcileModal';

const state = vi.hoisted(() => ({ account: null as unknown }));

vi.mock('@actual-app/core/platform/client/connection', () => ({
  send: vi.fn(),
}));
vi.mock('@actual-app/components/hooks/useResponsive', () => ({
  useResponsive: () => ({ isNarrowWidth: true }),
}));
vi.mock('#hooks/useAccount', () => ({ useAccount: () => state.account }));
vi.mock('#hooks/useFeatureFlag', () => ({ useFeatureFlag: () => false }));
vi.mock('#hooks/useSheetValue', () => ({ useSheetValue: () => 1000 }));
// A plain field: the real one is a calculator-style input
vi.mock('#components/mobile/transactions/AmountInput', () => ({
  AmountInput: ({
    value,
    onChange,
  }: {
    value: number;
    onChange: (amount: number) => void;
  }) => (
    <input
      aria-label="Statement balance"
      value={value.toFixed(2)}
      onChange={e => onChange(Number(e.target.value))}
    />
  ),
}));

const BANK = {
  amount: 46541,
  source: 'bank-sync',
  as_of: '2026-11-14',
  link: 'bank-sync',
} as const;
const CLEARED = {
  amount: 1000,
  source: 'cleared',
  as_of: null,
  link: null,
} as const;

function mockResolver(prefill: unknown, alternatives: unknown[]) {
  vi.mocked(send).mockImplementation((async (name: string) =>
    name === 'account-statement-balance-prefill'
      ? {
          prefill,
          alternatives,
          cleared_balance: 1000,
          record: null,
          account_type: 'checking',
        }
      : undefined) as never);
}

const saveCalls = () =>
  vi
    .mocked(send)
    .mock.calls.filter(([name]) => name === 'account-statement-balance-save');

function open() {
  const onReconcile = vi.fn();
  const store = createTestAppStore();
  render(
    <TestProviders store={store}>
      <MemoryRouter>
        <AccountReconcileModal accountId="a1" onReconcile={onReconcile} />
      </MemoryRouter>
    </TestProviders>,
  );
  return { onReconcile, store };
}

describe('AccountReconcileModal on phone web (native-reconcile-flow 1.2, 1.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const account = generateAccount('Checking', true, false) as AccountEntity;
    account.id = 'a1';
    account.account_sync_source = 'simpleFin';
    state.account = account;
    mockResolver(BANK, [CLEARED]);
  });

  it('pre-fills the recent bank balance, not the cleared balance, with the source line visible', async () => {
    open();
    expect(await screen.findByLabelText('Statement balance')).toHaveValue(
      '465.41',
    );
    expect(
      screen.getByText(/From SimpleFIN balance, synced/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('a tap on the icon shows the note and a second tap hides it', async () => {
    open();
    await screen.findByLabelText('Statement balance');
    const icon = screen.getByRole('button', { name: 'About this balance' });
    await userEvent.click(icon);
    expect(screen.getByRole('note')).toHaveTextContent(
      'May include pending items. Compare with your statement.',
    );
    await userEvent.click(icon);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('confirming the unedited bank balance records bank-sync and reconciles', async () => {
    const { onReconcile } = open();
    await screen.findByLabelText('Statement balance');
    await userEvent.click(screen.getByRole('button', { name: 'Reconcile' }));
    expect(saveCalls()).toEqual([
      [
        'account-statement-balance-save',
        {
          account_id: 'a1',
          amount: 46541,
          source: 'bank-sync',
          as_of: '2026-11-14',
        },
      ],
    ]);
    expect(onReconcile).toHaveBeenCalledWith(46541);
  });

  it('editing reads Entered by you, Restore bank balance restores, and an edit records entered', async () => {
    const { onReconcile } = open();
    const field = await screen.findByLabelText('Statement balance');
    fireEvent.change(field, { target: { value: '12.50' } });
    expect(screen.getByText('Entered by you')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Restore bank balance' }),
    );
    // the field is remounted with the restored value
    const restored = screen.getByLabelText('Statement balance');
    expect(restored).toHaveValue('465.41');
    expect(screen.queryByText('Entered by you')).not.toBeInTheDocument();
    fireEvent.change(restored, { target: { value: '12.50' } });
    await userEvent.click(screen.getByRole('button', { name: 'Reconcile' }));
    expect(saveCalls()[0][1]).toMatchObject({
      amount: 1250,
      source: 'entered',
      as_of: null,
    });
    expect(onReconcile).toHaveBeenCalledWith(1250);
  });

  it('with no source the field is empty with one hint and Reconcile is off, until the cleared balance is chosen', async () => {
    mockResolver(null, [CLEARED]);
    const { onReconcile, store } = open();
    await screen.findByRole('button', { name: 'Enter amount' });
    // not a made-up 0.00
    expect(
      screen.queryByLabelText('Statement balance'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconcile' })).toBeDisabled();
    expect(
      screen.getAllByText(/closing balance from your statement/),
    ).toHaveLength(1);
    expect(
      screen.getByText('Your own cleared total — not an independent check'),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Use cleared balance' }),
    );
    expect(screen.getByLabelText('Statement balance')).toHaveValue('10.00');
    await userEvent.click(screen.getByRole('button', { name: 'Reconcile' }));
    expect(saveCalls()[0][1]).toMatchObject({
      amount: 1000,
      source: 'cleared',
    });
    expect(store.getState().notifications.notifications[0].message).toMatch(
      /not a statement, so an assistant cannot use it/,
    );
    expect(onReconcile).toHaveBeenCalledWith(1000);
  });

  it('tapping the empty field lets you type a balance', async () => {
    mockResolver(null, [CLEARED]);
    open();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Enter amount' }),
    );
    expect(screen.getByLabelText('Statement balance')).toBeInTheDocument();
    // one tap never records a balance of 0.00
    expect(screen.getByRole('button', { name: 'Reconcile' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Statement balance'), {
      target: { value: '12.50' },
    });
    expect(screen.getByRole('button', { name: 'Reconcile' })).toBeEnabled();
  });

  it('the info button is at least 44 points square', async () => {
    open();
    await screen.findByLabelText('Statement balance');
    expect(
      screen.getByRole('button', { name: 'About this balance' }),
    ).toHaveStyle({ minWidth: '44px', minHeight: '44px' });
  });

  it('tells the person when the balance could not be recorded, and still reconciles', async () => {
    vi.mocked(send).mockImplementation((async (name: string) => {
      if (name === 'account-statement-balance-save') throw new Error('no');
      return {
        prefill: BANK,
        alternatives: [CLEARED],
        cleared_balance: 1000,
        record: null,
        account_type: null,
      };
    }) as never);
    const { onReconcile, store } = open();
    await screen.findByLabelText('Statement balance');
    await userEvent.click(screen.getByRole('button', { name: 'Reconcile' }));
    expect(onReconcile).toHaveBeenCalledWith(46541);
    expect(store.getState().notifications.notifications[0].message).toMatch(
      /Nothing was recorded for your assistant/,
    );
  });

  it('a stale bank balance is offered and saves with its own date', async () => {
    mockResolver(null, [{ ...BANK, as_of: '2026-11-02' }, CLEARED]);
    const { onReconcile } = open();
    await userEvent.click(
      await screen.findByRole('button', { name: /Use bank balance from/ }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Reconcile' }));
    expect(saveCalls()[0][1]).toMatchObject({
      source: 'bank-sync',
      as_of: '2026-11-02',
    });
    expect(onReconcile).toHaveBeenCalledWith(46541);
  });

  it('saves nothing when it is not confirmed', async () => {
    open();
    await screen.findByLabelText('Statement balance');
    expect(saveCalls()).toHaveLength(0);
  });
});
