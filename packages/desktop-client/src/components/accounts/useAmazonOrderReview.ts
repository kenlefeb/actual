import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { send } from '@actual-app/core/platform/client/connection';
import type {
  AmazonApplySkipReason,
  AmazonChargeReview,
  AmazonChargeStatus,
} from '@actual-app/core/server/amazon-orders/types';

// Review order, shared by the desktop and phone reviews
export const GROUPS: AmazonChargeStatus[] = [
  'matched',
  'ambiguous',
  'unmatched',
  'gift-card-or-points',
  'already-split',
  'already-itemized',
];

type UseAmazonOrderReviewArgs = {
  reviews: AmazonChargeReview[];
  onApplied?: () => void;
};

// Review state and wording for both reviews; nothing is written until apply
export function useAmazonOrderReview({
  reviews,
  onApplied,
}: UseAmazonOrderReviewArgs) {
  const { t } = useTranslation();
  // Charge id to the chosen transaction id. Matched rows start chosen.
  const [chosen, setChosen] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      reviews
        .filter(r => r.status === 'matched' && r.transaction)
        .map(r => [r.charge.id, r.transaction!.id]),
    ),
  );
  const [isApplying, setIsApplying] = useState(false);

  const groupTitles: Record<AmazonChargeStatus, string> = {
    matched: t('Matched'),
    ambiguous: t('Ambiguous'),
    unmatched: t('Not matched'),
    'gift-card-or-points': t('Not matched: paid partly by gift card or points'),
    'already-split': t('Already split'),
    'already-itemized': t('Already itemized'),
  };
  const skipReasons: Record<AmazonApplySkipReason, string> = {
    missing: t('The transaction was deleted.'),
    'amount-changed': t('Its amount changed after the review.'),
    split: t('It was split after the review.'),
    transfer: t('It became a transfer.'),
    'already-itemized': t('It was already itemized for an order.'),
    'not-a-charge': t(
      "The shipment comes to $0 or less, so it isn't a charge.",
    ),
  };
  const usedIds = new Set(Object.values(chosen));

  function toggle(chargeId: string, transactionId: string | null) {
    setChosen(previous => {
      const next = { ...previous };
      delete next[chargeId];
      return transactionId ? { ...next, [chargeId]: transactionId } : next;
    });
  }

  // One handler call, so one undo step
  async function apply(chargeIds: string[]) {
    setIsApplying(true);
    try {
      const result = await send('amazon-orders-apply', {
        matches: reviews
          .filter(r => chargeIds.includes(r.charge.id) && chosen[r.charge.id])
          .map(r => ({ charge: r.charge, transactionId: chosen[r.charge.id] })),
      });
      onApplied?.();
      return result;
    } finally {
      setIsApplying(false);
    }
  }

  return {
    groupTitles,
    skipReasons,
    chosen,
    toggle,
    usedIds,
    isApplying,
    apply,
  };
}
