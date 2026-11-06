import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type {
  AmazonApplySkipReason,
  AmazonChargeReview,
  AmazonChargeStatus,
} from '@actual-app/core/server/amazon-orders/types';
import * as monthUtils from '@actual-app/core/shared/months';

import {
  GROUPS,
  useAmazonOrderReview,
} from '#components/accounts/useAmazonOrderReview';
import {
  Modal,
  ModalCloseButton,
  ModalHeader,
  ModalTitle,
} from '#components/common/Modal';
import { FinancialText } from '#components/FinancialText';
import { Notifications } from '#components/Notifications';
import { useDateFormat } from '#hooks/useDateFormat';
import { useFormat } from '#hooks/useFormat';
import { useUndo } from '#hooks/useUndo';
import { removeNotification } from '#notifications/notificationsSlice';
import { useDispatch } from '#redux';
import { undo } from '#undo';

type MobileImportAmazonOrdersModalProps = {
  reviews: AmazonChargeReview[];
  onApplied?: () => void;
};

// One Undo at a time: a new apply replaces the previous apply's notification,
// so an older Undo can never undo a later apply
const UNDO_NOTIFICATION_ID = 'amazon-orders-undo';
const FOOTER_HEIGHT = 72;

export function MobileImportAmazonOrdersModal({
  reviews,
  onApplied,
}: MobileImportAmazonOrdersModalProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  const dispatch = useDispatch();
  const { showUndoNotification } = useUndo();
  const { groupTitles, skipReasons, isApplying, apply } = useAmazonOrderReview({
    reviews,
    onApplied,
  });
  // Charge ids applied in this review, and why apply skipped others
  const [applied, setApplied] = useState<Set<string>>(() => new Set());
  const [skipped, setSkipped] = useState<Record<string, AmazonApplySkipReason>>(
    {},
  );

  // Only Matched charges are sent; the phone can't choose for Ambiguous ones
  const applicable = reviews
    .filter(
      r =>
        r.status === 'matched' &&
        r.transaction &&
        !applied.has(r.charge.id) &&
        !skipped[r.charge.id],
    )
    .map(r => r.charge.id);

  const groupHints: Partial<Record<AmazonChargeStatus, string>> = {
    ambiguous: t('Resolve on desktop: choose its transaction there.'),
    unmatched: t('Resolve on desktop.'),
    'gift-card-or-points': t('Resolve on desktop.'),
    'already-split': t('Resolve on desktop.'),
    'already-itemized': t('Resolve on desktop.'),
  };

  async function onApply(chargeIds: string[]) {
    dispatch(removeNotification({ id: UNDO_NOTIFICATION_ID }));
    const result = await apply(chargeIds);
    const appliedTransactions = new Set(result.applied);
    const appliedIds = chargeIds.filter(id => {
      const review = reviews.find(r => r.charge.id === id);
      return (
        review?.transaction && appliedTransactions.has(review.transaction.id)
      );
    });

    setApplied(previous => new Set([...previous, ...appliedIds]));
    setSkipped(previous => ({
      ...previous,
      ...Object.fromEntries(result.skipped.map(s => [s.chargeId, s.reason])),
    }));

    if (appliedIds.length > 0) {
      showUndoNotification({
        id: UNDO_NOTIFICATION_ID,
        type: 'message',
        message:
          appliedIds.length === 1
            ? t('Itemized 1 Amazon charge')
            : t('Itemized {{count}} Amazon charges', {
                count: appliedIds.length,
              }),
        button: {
          title: t('Undo'),
          action: () => {
            undo();
            setApplied(previous => {
              const next = new Set(previous);
              appliedIds.forEach(id => next.delete(id));
              return next;
            });
          },
        },
      });
    }
  }

  function renderCard(review: AmazonChargeReview) {
    const { charge, transaction } = review;
    const isApplied = applied.has(charge.id);
    const skipReason = skipped[charge.id];
    return (
      <View
        key={charge.id}
        data-testid={`amazon-charge-${charge.orderId}`}
        style={{
          gap: 4,
          padding: 12,
          borderRadius: 6,
          backgroundColor: theme.tableBackground,
          border: `1px solid ${theme.tableBorder}`,
        }}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontWeight: 600 }}>{charge.orderId}</Text>
          <FinancialText style={{ fontWeight: 600 }}>
            {format(-charge.amount, 'financial')}
          </FinancialText>
        </View>
        <Text style={{ color: theme.pageTextSubdued }}>
          {monthUtils.format(charge.shipDate, dateFormat)}
        </Text>
        {transaction && (
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Text>
              {[
                transaction.accountName,
                monthUtils.format(transaction.date, dateFormat),
                transaction.payeeName ?? transaction.importedPayee ?? '',
              ].join(' · ')}
            </Text>
            {transaction.reconciled && (
              <Text style={{ color: theme.pageTextSubdued }}>
                <Trans>Reconciled</Trans>
              </Text>
            )}
          </View>
        )}
        {review.reason === 'not-a-charge' && (
          <Text style={{ color: theme.pageTextSubdued }}>
            {skipReasons['not-a-charge']}
          </Text>
        )}
        <Text
          style={{
            color: theme.pageTextSubdued,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {charge.items
            .map(item => `${item.name} ×${item.quantity}`)
            .join(', ')}
        </Text>
        {skipReason && (
          <Text style={{ color: theme.errorText }}>
            {t('Not applied: {{reason}}', { reason: skipReasons[skipReason] })}
          </Text>
        )}
        {review.status === 'matched' &&
          transaction &&
          !skipReason &&
          (isApplied ? (
            <Text style={{ color: theme.noticeTextLight, fontWeight: 600 }}>
              <Trans>Applied</Trans>
            </Text>
          ) : (
            <Button
              isDisabled={isApplying}
              onPress={() => void onApply([charge.id])}
              style={{ height: styles.mobileMinHeight, marginTop: 4 }}
            >
              <Trans>Apply</Trans>
            </Button>
          ))}
      </View>
    );
  }

  return (
    <Modal
      name="import-amazon-orders"
      containerProps={{
        style: {
          width: '100vw',
          minWidth: '100vw',
          maxWidth: '100vw',
          height: 'var(--visual-viewport-height)',
          maxHeight: 'var(--visual-viewport-height)',
          borderRadius: 0,
          padding: 0,
          paddingTop: 'env(safe-area-inset-top)',
        },
      }}
    >
      {({ state }) => (
        <>
          <ModalHeader
            title={<ModalTitle title={t('Import Amazon orders')} />}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <View style={{ flex: 1, gap: 20, padding: '0 12px 12px' }}>
            {GROUPS.map(status => {
              const group = reviews.filter(r => r.status === status);
              return (
                group.length > 0 && (
                  <View key={status} style={{ gap: 8, flexShrink: 0 }}>
                    <View>
                      <Text
                        data-testid="amazon-group-title"
                        style={{ fontWeight: 700, fontSize: 16 }}
                      >
                        {groupTitles[status]} ({group.length})
                      </Text>
                      {groupHints[status] && (
                        <Text style={{ color: theme.pageTextSubdued }}>
                          {groupHints[status]}
                        </Text>
                      )}
                    </View>
                    {group.map(renderCard)}
                  </View>
                )
              );
            })}
          </View>
          {applicable.length > 0 && (
            <View
              style={{
                position: 'sticky',
                bottom: 0,
                padding: 12,
                paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
                backgroundColor: theme.modalBackground,
                borderTop: `1px solid ${theme.tableBorder}`,
              }}
            >
              <Button
                variant="primary"
                isDisabled={isApplying}
                onPress={() => void onApply(applicable)}
                style={{ height: styles.mobileMinHeight }}
              >
                {t('Apply all ({{count}})', { count: applicable.length })}
              </Button>
            </View>
          )}
          {/* App notifications sit below modals; show the Undo above this one */}
          <Notifications style={{ bottom: FOOTER_HEIGHT + 12 }} />
        </>
      )}
    </Modal>
  );
}
