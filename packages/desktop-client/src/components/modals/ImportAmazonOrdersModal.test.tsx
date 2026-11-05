import { send } from '@actual-app/core/platform/client/connection';
import type {
  AmazonChargeReview,
  CandidateTransaction,
} from '@actual-app/core/server/amazon-orders/types';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { ImportAmazonOrdersModal } from './ImportAmazonOrdersModal';

vi.mock('@actual-app/core/platform/client/connection', async importActual => ({
  ...(await importActual<object>()),
  send: vi.fn(async () => ({ applied: [], skipped: [] })),
}));

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
      ],
      giftCardOrPoints: status === 'gift-card-or-points',
      totalDifference: 0,
    },
    status,
    transaction: null,
    candidates: [],
    ...fields,
  };
}

const reviews: AmazonChargeReview[] = [
  review('111-0000001', 'matched', { transaction: transaction('t1') }),
  review('111-0000002', 'matched', {
    transaction: transaction('t2', { reconciled: true }),
  }),
  review('111-0000003', 'ambiguous', {
    candidates: [
      transaction('t3', { accountName: 'Card' }),
      transaction('t4', { accountName: 'Other card' }),
    ],
  }),
  review('111-0000004', 'gift-card-or-points'),
  review('111-0000005', 'unmatched'),
];

function renderModal(onApplied = vi.fn()) {
  render(
    <TestProviders>
      <ImportAmazonOrdersModal reviews={reviews} onApplied={onApplied} />
    </TestProviders>,
  );
  return onApplied;
}

function row(orderId: string) {
  return screen.getByTestId(`amazon-charge-${orderId}`);
}

describe('ImportAmazonOrdersModal', () => {
  beforeEach(() => {
    vi.mocked(send).mockClear();
  });

  it('groups the charges and shows each match', () => {
    renderModal();

    expect(screen.getByText('Matched')).toBeInTheDocument();
    expect(screen.getByText('Ambiguous')).toBeInTheDocument();
    expect(screen.getByText('Not matched')).toBeInTheDocument();
    expect(
      screen.getByText('Not matched: paid partly by gift card or points'),
    ).toBeInTheDocument();
    expect(within(row('111-0000001')).getByText('Card')).toBeInTheDocument();
    expect(
      within(row('111-0000001')).getByText('AMZN Mktp US'),
    ).toBeInTheDocument();
    expect(within(row('111-0000001')).getByText('Lamp ×1')).toBeInTheDocument();
  });

  it('a reconciled match is marked "Reconciled"', () => {
    renderModal();

    expect(
      within(row('111-0000002')).getByText('Reconciled'),
    ).toBeInTheDocument();
    expect(
      within(row('111-0000001')).queryByText('Reconciled'),
    ).not.toBeInTheDocument();
  });

  it('a gift-card charge has no checkbox', () => {
    renderModal();

    expect(
      within(row('111-0000004')).queryByRole('checkbox'),
    ).not.toBeInTheDocument();
    expect(
      within(row('111-0000005')).queryByRole('checkbox'),
    ).not.toBeInTheDocument();
  });

  it('Close the review', async () => {
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(send).not.toHaveBeenCalled();
  });

  it('applies the checked matches and a candidate chosen for an ambiguous charge', async () => {
    const onApplied = renderModal();

    await userEvent.click(within(row('111-0000002')).getByRole('checkbox'));
    await userEvent.click(within(row('111-0000003')).getByRole('button'));
    await userEvent.click(await screen.findByText(/Other card/));
    await userEvent.click(
      screen.getByRole('button', { name: 'Apply selected' }),
    );

    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(send).toHaveBeenCalledWith('amazon-orders-apply', {
      matches: [
        { charge: reviews[0].charge, transactionId: 't1' },
        { charge: reviews[2].charge, transactionId: 't4' },
      ],
    });
  });
});
