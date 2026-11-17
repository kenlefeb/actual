import React, { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import {
  amountToInteger,
  integerToAmount,
  tsToRelativeTime,
} from '@actual-app/core/shared/util';
import { format as formatDate } from 'date-fns';

import { ReconcileBalanceChoices } from '#components/accounts/ReconcileBalanceChoices';
import {
  recordStatementBalance,
  useStatementBalancePrefill,
} from '#components/accounts/statementBalance';
import type { BalanceSource } from '#components/accounts/statementBalance';
import { Modal, ModalCloseButton, ModalHeader } from '#components/common/Modal';
import { FieldLabel } from '#components/mobile/MobileForms';
import { AmountInput } from '#components/mobile/transactions/AmountInput';
import { useAccount } from '#hooks/useAccount';
import { useDateFormat } from '#hooks/useDateFormat';
import { useFeatureFlag } from '#hooks/useFeatureFlag';
import { useLocale } from '#hooks/useLocale';
import type { Modal as ModalType } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

type AccountReconcileModalProps = Extract<
  ModalType,
  { name: 'account-reconcile' }
>['options'];

export function AccountReconcileModal({
  accountId,
  onReconcile,
}: AccountReconcileModalProps) {
  const { t } = useTranslation();
  const account = useAccount(accountId);
  const mobileCalculatorEnabled = useFeatureFlag('mobileCalculator');
  const dispatch = useDispatch();
  const prefill = useStatementBalancePrefill(accountId);
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  const locale = useLocale();

  // `amount` stays null until the field has a value; the pre-fill is the recent bank balance, never the cleared balance
  const [amount, setAmount] = useState<number | null>(null);
  const [applied, setApplied] = useState<BalanceSource | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  // The field is open but nothing is typed yet: `amount` stays null, so Reconcile stays off
  const [isEntering, setIsEntering] = useState(false);
  const [amountInputKey, setAmountInputKey] = useState(0);

  function apply(source: BalanceSource | null) {
    setApplied(source);
    setAmount(source?.amount ?? null);
    setAmountInputKey(key => key + 1);
  }

  if (prefill && !hasLoaded) {
    setHasLoaded(true);
    apply(prefill.prefill);
  }

  const edited = amount != null && amount !== applied?.amount;

  if (!account) {
    return null;
  }

  const onSubmit = async (newAmount: number | null) => {
    if (newAmount == null) {
      return;
    }
    await recordStatementBalance(
      dispatch,
      accountId,
      newAmount,
      applied,
      edited,
    );
    onReconcile(newAmount);
  };

  return (
    <Modal
      name="account-reconcile"
      wrapperProps={{
        style: mobileCalculatorEnabled ? { paddingBottom: '30vh' } : undefined,
      }}
    >
      {({ state }) => (
        <>
          <ModalHeader
            title={t('Reconcile')}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <View>
            <FieldLabel
              title={t(
                'Enter the current balance of your bank account that you want to reconcile with:',
              )}
            />
            {prefill && amount == null && !isEntering && (
              <Button
                style={{
                  ...styles.veryLargeText,
                  color: theme.pageTextSubdued,
                  height: styles.mobileMinHeight,
                }}
                variant="bare"
                onPress={() => setIsEntering(true)}
              >
                <Trans>Enter amount</Trans>
              </Button>
            )}
            {prefill && (amount != null || isEntering) && (
              <View
                style={{
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <AmountInput
                  key={amountInputKey}
                  value={integerToAmount(amount ?? 0)}
                  onChange={newAmount => setAmount(amountToInteger(newAmount))}
                  autoFocus
                  autoFocusDelay={150}
                  variant="large"
                />
              </View>
            )}
          </View>
          {prefill && (
            <View style={{ padding: `0 ${styles.mobileEditingPadding}px` }}>
              <ReconcileBalanceChoices
                variant="mobile"
                accountSyncSource={account.account_sync_source}
                prefill={prefill}
                applied={applied}
                edited={edited}
                isEmpty={amount == null}
                onChoose={apply}
                onRestore={() => apply(prefill.prefill)}
              />
            </View>
          )}
          <View
            style={{
              justifyContent: 'center',
              alignItems: 'center',
              paddingTop: 10,
            }}
          >
            <Button
              variant="primary"
              isDisabled={amount == null}
              style={{
                height: styles.mobileMinHeight,
                marginLeft: styles.mobileEditingPadding,
                marginRight: styles.mobileEditingPadding,
              }}
              onPress={() => {
                void onSubmit(amount);
                state.close();
              }}
            >
              <Trans>Reconcile</Trans>
            </Button>
          </View>
          <Text
            style={{
              color: theme.pageTextLight,
              marginTop: 8,
              textAlign: 'center',
            }}
          >
            {account.last_reconciled
              ? t('Reconciled {{ relativeTimeAgo }} ({{ absoluteDate }})', {
                  relativeTimeAgo: tsToRelativeTime(
                    account.last_reconciled,
                    locale,
                  ),
                  absoluteDate: formatDate(
                    new Date(parseInt(account.last_reconciled, 10)),
                    dateFormat,
                    { locale },
                  ),
                })
              : t('Not yet reconciled')}
          </Text>
        </>
      )}
    </Modal>
  );
}
