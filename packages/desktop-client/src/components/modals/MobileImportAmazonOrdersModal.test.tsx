import { send } from '@actual-app/core/platform/client/connection';
import { getUndoState } from '@actual-app/core/platform/client/undo';
import type {
  AmazonChargeReview,
  CandidateTransaction,
} from '@actual-app/core/server/amazon-orders/types';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Notifications } from '#components/Notifications';
import { createTestAppStore, TestProviders } from '#mocks';
import { undo } from '#undo';

import { MobileImportAmazonOrdersModal } from './MobileImportAmazonOrdersModal';

vi.mock('@actual-app/core/platform/client/connection', async () => ({
  ...(await import('#mocks/connection')),
  send: vi.fn(),
}));
vi.mock('@actual-app/components/hooks/useResponsive', () => ({
  useResponsive: () => ({ isNarrowWidth: true }),
}));
vi.mock('#undo', () => ({ undo: vi.fn(), redo: vi.fn() }));

function transaction(
  id: string,
  fields: Partial<CandidateTransaction> = {},
): CandidateTransaction {
  return {
    id,
    account: 'card',
    accountName: 'Card',
    date: '2026-11-06',
    amount: -3240,
    payeeName: 'AMZN Mktp US',
    importedPayee: null,
    notes: null,
    category: null,
    cleared: true,
    reconciled: false,
    ...fields,
  };
}

function review(
  orderId: string,
  status: AmazonChargeReview['status'],
  fields: Partial<AmazonChargeReview> = {},
): AmazonChargeReview {
  return {
    charge: {
      id: `${orderId}|2026-11-04`,
      orderId,
      shipDate: '2026-11-04',
      amount: 3240,
      items: [
        {
          name: 'Lamp',
          quantity: 1,
          price: 3000,
          tax: 240,
          shipping: 0,
          discount: 0,
        },
        {
          name: 'Bulb',
          quantity: 2,
          price: 0,
          tax: 0,
          shipping: 0,
          discount: 0,
        },
      ],
      giftCardOrPoints: status === 'gift-card-or-points',
      totalDifference: 0,
    },
    status,
    reason: null,
    transaction: null,
    candidates: [],
    ...fields,
  };
}

const matched = [
  review('111-0000001', 'matched', { transaction: transaction('t1') }),
  review('111-0000002', 'matched', {
    transaction: transaction('t2', { reconciled: true }),
  }),
  review('111-0000003', 'matched', { transaction: transaction('t3') }),
];
const reviews: AmazonChargeReview[] = [
  ...matched,
  review('111-0000004', 'ambiguous', {
    candidates: [
      transaction('t4', { accountName: 'Card' }),
      transaction('t5', { accountName: 'Other card' }),
    ],
  }),
  review('111-0000005', 'gift-card-or-points'),
  review('111-0000006', 'unmatched'),
  review('111-0000007', 'already-split', { transaction: transaction('t7') }),
  review('111-0000008', 'already-itemized', {
    transaction: transaction('t8'),
  }),
];

function renderModal(onApplied = vi.fn()) {
  render(
    <TestProviders store={createTestAppStore()}>
      {/* The app's own notifications, as FinancesApp mounts them */}
      <Notifications />
      <MobileImportAmazonOrdersModal reviews={reviews} onApplied={onApplied} />
    </TestProviders>,
  );
  return onApplied;
}

function card(orderId: string) {
  return screen.getByTestId(`amazon-charge-${orderId}`);
}

function applyOn(orderId: string) {
  return within(card(orderId)).getByRole('button', { name: 'Apply' });
}

// Resolves amazon-orders-apply as applying every sent match, except the
// charges listed in `skip`
function applyAllSent(skip: Record<string, 'split'> = {}) {
  vi.mocked(send).mockImplementation((async (
    _name: string,
    args: {
      matches: Array<{ charge: { id: string }; transactionId: string }>;
    },
  ) => ({
    applied: args.matches
      .filter(m => !skip[m.charge.id])
      .map(m => m.transactionId),
    skipped: args.matches
      .filter(m => skip[m.charge.id])
      .map(m => ({
        chargeId: m.charge.id,
        transactionId: m.transactionId,
        reason: skip[m.charge.id],
      })),
  })) as unknown as typeof send);
}

describe('MobileImportAmazonOrdersModal', () => {
  beforeEach(() => {
    vi.mocked(send).mockReset();
    vi.mocked(undo).mockClear();
    applyAllSent();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Matched charge on the phone', () => {
    renderModal();
    const matchedCard = card('111-0000001');

    expect(within(matchedCard).getByText('111-0000001')).toBeInTheDocument();
    expect(within(matchedCard).getByText('11/04/2026')).toBeInTheDocument();
    expect(within(matchedCard).getByText(/32\.40/)).toBeInTheDocument();
    expect(
      within(matchedCard).getByText('Lamp ×1, Bulb ×2'),
    ).toBeInTheDocument();
    expect(
      within(matchedCard).getByText('Card · 11/06/2026 · AMZN Mktp US'),
    ).toBeInTheDocument();
  });

  it('Reconciled match on the phone', () => {
    renderModal();

    expect(
      within(card('111-0000002')).getByText('Reconciled'),
    ).toBeInTheDocument();
    expect(
      within(card('111-0000001')).queryByText('Reconciled'),
    ).not.toBeInTheDocument();
  });

  it('shows the groups in the desktop order, with their titles', () => {
    renderModal();

    const titles = screen
      .getAllByTestId('amazon-group-title')
      .map(title => title.textContent);
    expect(titles).toEqual([
      'Matched (3)',
      'Ambiguous (1)',
      'Not matched (1)',
      'Not matched: paid partly by gift card or points (1)',
      'Already split (1)',
      'Already itemized (1)',
    ]);
  });

  it('Ambiguous charge on the phone', () => {
    renderModal();
    const ambiguous = card('111-0000004');

    expect(within(ambiguous).queryByRole('button')).not.toBeInTheDocument();
    expect(within(ambiguous).queryByRole('combobox')).not.toBeInTheDocument();
    expect(
      screen.getByText('Resolve on desktop: choose its transaction there.'),
    ).toBeInTheDocument();
  });

  it('Gift card charge on the phone', () => {
    renderModal();

    for (const orderId of [
      '111-0000005',
      '111-0000006',
      '111-0000007',
      '111-0000008',
    ]) {
      expect(within(card(orderId)).queryByRole('button')).toBeNull();
    }
    // Not matched, gift card or points, Already split, Already itemized
    expect(screen.getAllByText('Resolve on desktop.')).toHaveLength(4);
  });

  it('Close without applying on the phone', async () => {
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(send).not.toHaveBeenCalled();
  });

  it('Import stays on the phone', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('Apply one charge on the phone', async () => {
    const onApplied = renderModal();

    await userEvent.click(applyOn('111-0000002'));

    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('amazon-orders-apply', {
      matches: [{ charge: matched[1].charge, transactionId: 't2' }],
    });
    expect(
      await within(card('111-0000002')).findByText('Applied'),
    ).toBeInTheDocument();
    expect(
      within(card('111-0000002')).queryByRole('button', { name: 'Apply' }),
    ).not.toBeInTheDocument();
    expect(applyOn('111-0000001')).toBeEnabled();
    expect(applyOn('111-0000003')).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Apply all (2)' }),
    ).toBeInTheDocument();
  });

  it('Apply all on the phone', async () => {
    renderModal();

    await userEvent.click(
      screen.getByRole('button', { name: 'Apply all (3)' }),
    );

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith('amazon-orders-apply', {
      matches: matched.map(r => ({
        charge: r.charge,
        transactionId: r.transaction!.id,
      })),
    });
    expect(
      await within(card('111-0000003')).findByText('Applied'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Apply all/ }),
    ).not.toBeInTheDocument();
  });

  it('Undo on the phone', async () => {
    renderModal();

    await userEvent.click(
      screen.getByRole('button', { name: 'Apply all (3)' }),
    );
    expect(
      await screen.findByText('Itemized 3 Amazon charges'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(undo).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(applyOn('111-0000001')).toBeEnabled());
    expect(applyOn('111-0000002')).toBeEnabled();
    expect(applyOn('111-0000003')).toBeEnabled();
  });

  it('Only the latest apply offers Undo on the phone', async () => {
    renderModal();

    await userEvent.click(applyOn('111-0000001'));
    await screen.findByText('Itemized 1 Amazon charge');
    await userEvent.click(applyOn('111-0000002'));
    await within(card('111-0000002')).findByText('Applied');

    // Only the latest apply offers Undo, and it restores only that charge
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(undo).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(applyOn('111-0000002')).toBeEnabled());
    expect(
      within(card('111-0000001')).getByText('Applied'),
    ).toBeInTheDocument();
  });

  it('Changed after the review, on the phone', async () => {
    applyAllSent({ [matched[0].charge.id]: 'split' });
    renderModal();

    await userEvent.click(applyOn('111-0000001'));

    expect(
      await within(card('111-0000001')).findByText(
        'Not applied: It was split after the review.',
      ),
    ).toBeInTheDocument();
    expect(
      within(card('111-0000001')).queryByRole('button', { name: 'Apply' }),
    ).not.toBeInTheDocument();
  });

  it('Apply all after a skip on the phone', async () => {
    applyAllSent({ [matched[0].charge.id]: 'split' });
    renderModal();
    await userEvent.click(applyOn('111-0000001'));
    await within(card('111-0000001')).findByText(/Not applied/);
    vi.mocked(send).mockClear();

    await userEvent.click(
      screen.getByRole('button', { name: 'Apply all (2)' }),
    );

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith('amazon-orders-apply', {
      matches: matched.slice(1).map(r => ({
        charge: r.charge,
        transactionId: r.transaction!.id,
      })),
    });
  });

  it('shows each notification once while the review is open', async () => {
    renderModal();

    await userEvent.click(applyOn('111-0000001'));

    expect(await screen.findAllByText('Itemized 1 Amazon charge')).toHaveLength(
      1,
    );
  });

  it("a later apply's Undo stays for its full time", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({
        advanceTimers: vi.advanceTimersByTime,
      });
      renderModal();

      await user.click(applyOn('111-0000001'));
      await screen.findAllByText('Itemized 1 Amazon charge');
      await act(() => vi.advanceTimersByTimeAsync(5000));
      await user.click(applyOn('111-0000002'));
      await within(card('111-0000002')).findByText('Applied');
      // The first notification's 10 s timer fires here
      await act(() => vi.advanceTimersByTimeAsync(6000));

      expect(
        screen.queryAllByRole('button', { name: 'Undo' }).length,
      ).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Undo keeps the review open on the phone', () => {
    const { unmount } = render(
      <TestProviders store={createTestAppStore()}>
        <MobileImportAmazonOrdersModal reviews={reviews} />
      </TestProviders>,
    );

    // Undo reopens the modal recorded with the apply; without one it closes
    // whatever modal is open
    expect(getUndoState('openModal')).toEqual({
      name: 'import-amazon-orders',
      options: { reviews, onApplied: undefined },
    });
    unmount();
    expect(getUndoState('openModal')).toBeNull();
  });
});
