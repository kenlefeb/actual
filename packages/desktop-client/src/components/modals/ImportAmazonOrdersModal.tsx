import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Select } from '@actual-app/components/select';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import type {
  AmazonChargeReview,
  AmazonChargeStatus,
  CandidateTransaction,
} from '@actual-app/core/server/amazon-orders/types';
import * as monthUtils from '@actual-app/core/shared/months';

import {
  Modal,
  ModalCloseButton,
  ModalHeader,
  ModalTitle,
} from '#components/common/Modal';
import { FinancialText } from '#components/FinancialText';
import { Checkbox } from '#components/forms';
import { useDateFormat } from '#hooks/useDateFormat';
import { useFormat } from '#hooks/useFormat';

type ImportAmazonOrdersModalProps = {
  reviews: AmazonChargeReview[];
  onApplied?: () => void;
};

// Review order; the import itself stays on the device and nothing is written
// until "Apply selected"
const GROUPS: AmazonChargeStatus[] = [
  'matched',
  'ambiguous',
  'unmatched',
  'gift-card-or-points',
  'already-split',
  'already-itemized',
];

export function ImportAmazonOrdersModal({
  reviews,
  onApplied,
}: ImportAmazonOrdersModalProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  // Charge id to the chosen transaction id. Matched rows start checked.
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
  const usedIds = new Set(Object.values(chosen));

  function toggle(chargeId: string, transactionId: string | null) {
    setChosen(previous => {
      const next = { ...previous };
      delete next[chargeId];
      return transactionId ? { ...next, [chargeId]: transactionId } : next;
    });
  }

  async function onApply(close: () => void) {
    setIsApplying(true);
    try {
      await send('amazon-orders-apply', {
        matches: reviews
          .filter(r => chosen[r.charge.id])
          .map(r => ({ charge: r.charge, transactionId: chosen[r.charge.id] })),
      });
      onApplied?.();
      close();
    } finally {
      setIsApplying(false);
    }
  }

  function describe(transaction: CandidateTransaction) {
    return [
      transaction.accountName,
      monthUtils.format(transaction.date, dateFormat),
      transaction.payeeName ?? transaction.importedPayee ?? '',
    ].join(' · ');
  }

  function renderTransaction(transaction: CandidateTransaction) {
    return (
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Text>{transaction.accountName}</Text>
        <Text>{monthUtils.format(transaction.date, dateFormat)}</Text>
        <Text>{transaction.payeeName ?? transaction.importedPayee ?? ''}</Text>
        {transaction.reconciled && (
          <Text style={{ color: theme.pageTextSubdued }}>
            <Trans>Reconciled</Trans>
          </Text>
        )}
      </View>
    );
  }

  function renderRow(review: AmazonChargeReview) {
    const { charge } = review;
    const checkboxId = `amazon-charge-check-${charge.id}`;
    return (
      <View
        key={charge.id}
        data-testid={`amazon-charge-${charge.orderId}`}
        style={{
          flexDirection: 'row',
          gap: 8,
          padding: '6px 0',
          borderTop: `1px solid ${theme.tableBorder}`,
        }}
      >
        {review.status === 'matched' && review.transaction && (
          <Checkbox
            id={checkboxId}
            aria-label={t('Apply order {{orderId}}', {
              orderId: charge.orderId,
            })}
            checked={!!chosen[charge.id]}
            onChange={e =>
              toggle(
                charge.id,
                e.target.checked ? review.transaction!.id : null,
              )
            }
            style={{ marginTop: 2 }}
          />
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Text style={{ fontWeight: 600 }}>{charge.orderId}</Text>
            <Text>{monthUtils.format(charge.shipDate, dateFormat)}</Text>
            <FinancialText>{format(-charge.amount, 'financial')}</FinancialText>
          </View>
          {review.transaction && renderTransaction(review.transaction)}
          {review.status === 'ambiguous' && (
            <Select
              aria-label={t('Choose the transaction for order {{orderId}}', {
                orderId: charge.orderId,
              })}
              value={chosen[charge.id] ?? ''}
              onChange={id => toggle(charge.id, id || null)}
              disabledKeys={review.candidates
                .map(c => c.id)
                .filter(id => usedIds.has(id) && chosen[charge.id] !== id)}
              options={[
                ['', t('Leave unmatched')],
                ...review.candidates.map(c => [c.id, describe(c)] as const),
              ]}
            />
          )}
          <Text style={{ color: theme.pageTextSubdued }}>
            {charge.items
              .map(item => `${item.name} ×${item.quantity}`)
              .join(', ')}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <Modal name="import-amazon-orders">
      {({ state }) => (
        <>
          <ModalHeader
            title={<ModalTitle title={t('Import Amazon orders')} />}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <View style={{ gap: 12, width: 640, maxWidth: '100%' }}>
            <View style={{ maxHeight: '60vh', overflowY: 'auto', gap: 16 }}>
              {GROUPS.map(status => {
                const group = reviews.filter(r => r.status === status);
                return (
                  group.length > 0 && (
                    <View key={status} style={{ flexShrink: 0 }}>
                      <Text style={{ fontWeight: 700, marginBottom: 4 }}>
                        {groupTitles[status]}
                      </Text>
                      {group.map(renderRow)}
                    </View>
                  )
                );
              })}
            </View>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'flex-end',
                gap: 10,
              }}
            >
              <Button onPress={() => state.close()}>
                <Trans>Cancel</Trans>
              </Button>
              <Button
                variant="primary"
                isDisabled={isApplying || usedIds.size === 0}
                onPress={() => void onApply(() => state.close())}
              >
                <Trans>Apply selected</Trans>
              </Button>
            </View>
          </View>
        </>
      )}
    </Modal>
  );
}
