import { send } from '@actual-app/core/platform/client/connection';
import type { AmazonChargeReview } from '@actual-app/core/server/amazon-orders/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GROUPS, useAmazonOrderReview } from './useAmazonOrderReview';

vi.mock('@actual-app/core/platform/client/connection', async () => ({
  ...(await import('#mocks/connection')),
  send: vi.fn(async () => ({ applied: [], skipped: [] })),
}));

function review(
  orderId: string,
  status: AmazonChargeReview['status'],
  transactionId: string | null,
): AmazonChargeReview {
  return {
    charge: {
      id: `${orderId}|2026-11-04`,
      orderId,
      shipDate: '2026-11-04',
      amount: 3240,
      items: [],
      giftCardOrPoints: false,
      totalDifference: 0,
    },
    status,
    reason: null,
    transaction: transactionId
      ? {
          id: transactionId,
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
        }
      : null,
    candidates: [],
  };
}

const reviews = [
  review('111-0000001', 'matched', 't1'),
  review('111-0000002', 'matched', 't2'),
  review('111-0000003', 'ambiguous', null),
];

describe('useAmazonOrderReview', () => {
  beforeEach(() => {
    vi.mocked(send).mockClear();
  });

  it('Matched rows start chosen', () => {
    const { result } = renderHook(() => useAmazonOrderReview({ reviews }));

    expect(result.current.chosen).toEqual({
      [reviews[0].charge.id]: 't1',
      [reviews[1].charge.id]: 't2',
    });
    expect([...result.current.usedIds]).toEqual(['t1', 't2']);
  });

  it('apply(ids) sends only those charges with their transactions, and returns the result', async () => {
    const outcome = { applied: ['t2'], skipped: [] };
    vi.mocked(send).mockResolvedValueOnce(outcome);
    const onApplied = vi.fn();
    const { result } = renderHook(() =>
      useAmazonOrderReview({ reviews, onApplied }),
    );

    let returned;
    await act(async () => {
      returned = await result.current.apply([reviews[1].charge.id]);
    });

    expect(send).toHaveBeenCalledWith('amazon-orders-apply', {
      matches: [{ charge: reviews[1].charge, transactionId: 't2' }],
    });
    expect(returned).toEqual(outcome);
    expect(onApplied).toHaveBeenCalled();
    expect(result.current.isApplying).toBe(false);
  });

  it('toggle unchooses and rechooses a charge', () => {
    const { result } = renderHook(() => useAmazonOrderReview({ reviews }));

    act(() => result.current.toggle(reviews[0].charge.id, null));
    expect(result.current.chosen[reviews[0].charge.id]).toBeUndefined();

    act(() => result.current.toggle(reviews[2].charge.id, 't1'));
    expect(result.current.chosen[reviews[2].charge.id]).toBe('t1');
  });

  it('group titles and skip reasons are the desktop wording', () => {
    const { result } = renderHook(() => useAmazonOrderReview({ reviews }));

    expect(GROUPS).toEqual([
      'matched',
      'ambiguous',
      'unmatched',
      'gift-card-or-points',
      'already-split',
      'already-itemized',
    ]);
    expect(result.current.groupTitles).toEqual({
      matched: 'Matched',
      ambiguous: 'Ambiguous',
      unmatched: 'Not matched',
      'gift-card-or-points': 'Not matched: paid partly by gift card or points',
      'already-split': 'Already split',
      'already-itemized': 'Already itemized',
    });
    expect(result.current.skipReasons).toEqual({
      missing: 'The transaction was deleted.',
      'amount-changed': 'Its amount changed after the review.',
      split: 'It was split after the review.',
      transfer: 'It became a transfer.',
      'already-itemized': 'It was already itemized for an order.',
      'not-a-charge': "The shipment comes to $0 or less, so it isn't a charge.",
    });
  });
});
