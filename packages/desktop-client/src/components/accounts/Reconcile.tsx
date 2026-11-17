import React, { useState } from 'react';
import type { FormEvent } from 'react';
import { Form } from 'react-aria-components';
import { Trans } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { SvgCheckCircle1 } from '@actual-app/components/icons/v2';
import { InitialFocus } from '@actual-app/components/initial-focus';
import { Input } from '@actual-app/components/input';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { Query } from '@actual-app/core/shared/query';
import { tsToRelativeTime } from '@actual-app/core/shared/util';
import type { AccountEntity } from '@actual-app/core/types/models';
import type { TransObjectLiteral } from '@actual-app/core/types/util';
import { format as formatDate } from 'date-fns';
import { t } from 'i18next';

import { useDateFormat } from '#hooks/useDateFormat';
import { useFormat } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';
import { useSheetValue } from '#hooks/useSheetValue';
import { addNotification } from '#notifications/notificationsSlice';
import { useDispatch } from '#redux';

import { ReconcileBalanceChoices } from './ReconcileBalanceChoices';
import {
  recordStatementBalance,
  useStatementBalancePrefill,
} from './statementBalance';
import type { BalanceSource } from './statementBalance';

type ReconcilingMessageProps = {
  balanceQuery: { name: `balance-query-${string}`; query: Query };
  targetBalance: number;
  onDone: () => void;
  onCreateTransaction: (targetDiff: number) => void;
};

export function ReconcilingMessage({
  balanceQuery,
  targetBalance,
  onDone,
  onCreateTransaction,
}: ReconcilingMessageProps) {
  const cleared =
    useSheetValue<'balance', `balance-query-${string}-cleared`>({
      name: (balanceQuery.name +
        '-cleared') as `balance-query-${string}-cleared`,
      value: 0,
      query: balanceQuery.query.filter({ cleared: true }),
    }) ?? 0;
  const format = useFormat();
  const targetDiff = targetBalance - cleared;

  const clearedBalance = format(cleared, 'financial');
  const bankBalance = format(targetBalance, 'financial');
  const difference =
    (targetDiff > 0 ? '+' : '') + format(targetDiff, 'financial');

  return (
    <View
      style={{
        flexDirection: 'row',
        alignSelf: 'center',
        backgroundColor: theme.tableBackground,
        ...styles.shadow,
        borderRadius: 4,
        marginTop: 5,
        marginBottom: 15,
        padding: 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {targetDiff === 0 ? (
          <View
            style={{
              color: theme.noticeTextLight,
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <SvgCheckCircle1
              style={{
                width: 13,
                height: 13,
                color: 'inherit',
                marginRight: 3,
              }}
            />
            <Trans>All reconciled!</Trans>
          </View>
        ) : (
          <View style={{ color: theme.tableText }}>
            <Text style={{ fontStyle: 'italic', textAlign: 'center' }}>
              <Trans>
                Your cleared balance{' '}
                <strong>{{ clearedBalance } as TransObjectLiteral}</strong>{' '}
                needs <strong>{{ difference } as TransObjectLiteral}</strong> to
                match
                <br /> your bank&apos;s balance of{' '}
                <Text style={{ fontWeight: 700 }}>
                  {{ bankBalance } as TransObjectLiteral}
                </Text>
              </Trans>
            </Text>
          </View>
        )}
        <View style={{ marginLeft: 15 }}>
          <Button variant="primary" onPress={onDone}>
            {targetDiff === 0
              ? t('Lock transactions')
              : t('Exit reconciliation')}
          </Button>
        </View>
        {targetDiff !== 0 && (
          <View style={{ marginLeft: 15 }}>
            <Button onPress={() => onCreateTransaction(targetDiff)}>
              <Trans>Create reconciliation transaction</Trans>
            </Button>
          </View>
        )}
      </View>
    </View>
  );
}

type ReconcileMenuProps = {
  account: AccountEntity;
  onReconcile: (amount: number | null) => void;
  onClose: () => void;
};

export function ReconcileMenu({
  account,
  onReconcile,
  onClose,
}: ReconcileMenuProps) {
  const format = useFormat();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  const locale = useLocale();
  const dispatch = useDispatch();
  const prefill = useStatementBalancePrefill(account.id);

  // The source the field was last set from, and the text in it ('' until it loads)
  const [applied, setApplied] = useState<BalanceSource | null>(null);
  const [inputValue, setInputValue] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  function apply(source: BalanceSource | null) {
    setApplied(source);
    setInputValue(source ? format(source.amount, 'financial') : '');
  }

  // The resolver answers once; the pre-fill is its recent bank balance, never the cleared balance
  if (prefill && !hasLoaded) {
    setHasLoaded(true);
    apply(prefill.prefill);
  }

  const appliedText = applied ? format(applied.amount, 'financial') : '';
  const edited = inputValue != null && inputValue !== appliedText;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!inputValue) {
      return;
    }

    const amount = edited
      ? format.fromEdit(inputValue, null)
      : (applied?.amount ?? null);
    if (amount == null) {
      return;
    }

    const source = await recordStatementBalance(
      account.id,
      amount,
      applied,
      edited,
    );
    if (source === 'cleared') {
      dispatch(
        addNotification({
          notification: {
            type: 'message',
            message: t(
              "The cleared balance is the app's own figure, not a statement, so an assistant cannot use it to reconcile. Enter your statement's balance to let it.",
            ),
          },
        }),
      );
    }

    onReconcile(amount);
    onClose();
  }

  return (
    <Form onSubmit={onSubmit}>
      <View style={{ padding: '5px 8px' }}>
        <Text>
          <Trans>
            Enter the current balance of your bank account that you want to
            reconcile with:
          </Trans>
        </Text>
        {inputValue != null && prefill && (
          <>
            <InitialFocus>
              <Input
                value={inputValue}
                onChangeValue={setInputValue}
                style={{ margin: '7px 0', textAlign: 'right' }}
              />
            </InitialFocus>
            <ReconcileBalanceChoices
              variant="desktop"
              accountSyncSource={account.account_sync_source}
              prefill={prefill}
              applied={applied}
              edited={edited}
              isEmpty={inputValue === ''}
              onChoose={apply}
              onRestore={() => apply(prefill.prefill)}
              onNavigate={onClose}
            />
          </>
        )}
        <Button type="submit" variant="primary" isDisabled={!inputValue}>
          <Trans>Reconcile</Trans>
        </Button>
        <Text
          style={{
            color: theme.pageTextLight,
            marginTop: '8px',
            textAlign: 'center',
          }}
        >
          {account?.last_reconciled
            ? t('Reconciled {{ relativeTimeAgo }} ({{ absoluteDate }})', {
                relativeTimeAgo: tsToRelativeTime(
                  account.last_reconciled,
                  locale,
                ),
                absoluteDate: formatDate(
                  new Date(parseInt(account.last_reconciled ?? '0', 10)),
                  dateFormat,
                  { locale },
                ),
              })
            : t('Not yet reconciled')}
        </Text>
      </View>
    </Form>
  );
}
