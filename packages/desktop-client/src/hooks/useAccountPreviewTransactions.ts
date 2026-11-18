import { useCallback, useMemo } from 'react';

import {
  inverseBasedOnAccount,
  isScheduleRelevantToAccount,
} from '@actual-app/core/shared/schedule-preview';
import { groupById } from '@actual-app/core/shared/util';
import type {
  AccountEntity,
  PayeeEntity,
  ScheduleEntity,
} from '@actual-app/core/types/models';

import * as bindings from '#spreadsheet/bindings';

import { useAccounts } from './useAccounts';
import { usePayees } from './usePayees';
import { usePreviewTransactions } from './usePreviewTransactions';
import { useSheetValue } from './useSheetValue';
import { useSyncedPref } from './useSyncedPref';

type UseAccountPreviewTransactionsProps = {
  accountId?: AccountEntity['id'] | undefined;
};

type UseAccountPreviewTransactionsResult = ReturnType<
  typeof usePreviewTransactions
>;

/**
 * Preview transactions for a given account or all accounts if no `accountId` is provided.
 * This will invert the payees, accounts, and amounts accordingly depending on which account
 * the preview transactions are being viewed from.
 */
export function useAccountPreviewTransactions({
  accountId,
}: UseAccountPreviewTransactionsProps): UseAccountPreviewTransactionsResult {
  const { data: accounts = [] } = useAccounts();
  const accountsById = useMemo(() => groupById(accounts), [accounts]);
  const { data: payees = [] } = usePayees();
  const payeesById = useMemo(() => groupById(payees), [payees]);

  const getPayeeByTransferAccount = useCallback(
    (transferAccountId?: AccountEntity['id'] | null) =>
      payees.find(p => p.transfer_acct === transferAccountId) || null,
    [payees],
  );

  const getTransferAccountByPayee = useCallback(
    (payeeId?: PayeeEntity['id'] | null) => {
      if (!payeeId) {
        return null;
      }

      const transferAccountId = payeesById[payeeId]?.transfer_acct;
      if (!transferAccountId) {
        return null;
      }
      return accountsById[transferAccountId];
    },
    [accountsById, payeesById],
  );

  const accountSchedulesFilter = useCallback(
    (schedule: ScheduleEntity) =>
      isScheduleRelevantToAccount({
        accountId,
        schedule,
        getTransferAccountByPayee,
      }),
    [accountId, getTransferAccountByPayee],
  );

  const accountBalanceValue = useSheetValue<
    'account',
    'balance' | 'accounts-balance'
  >(
    accountId
      ? bindings.accountBalance(accountId)
      : bindings.allAccountBalance(),
  );

  const [showBalances] = useSyncedPref(`show-balances-${accountId}`);

  const {
    previewTransactions: allPreviewTransactions,
    runningBalances: allRunningBalances,
    isLoading,
    error,
  } = usePreviewTransactions({
    filter: accountSchedulesFilter,
    options: {
      calculateRunningBalances: showBalances === 'true',
      startingBalance: accountBalanceValue ?? 0,
    },
  });

  return useMemo(() => {
    if (!accountId) {
      return {
        previewTransactions: allPreviewTransactions,
        runningBalances: allRunningBalances,
        isLoading,
        error,
      };
    }

    const {
      transactions: previewTransactions,
      runningBalances: previewRunningBalances,
    } = inverseBasedOnAccount({
      accountId,
      transactions: allPreviewTransactions,
      runningBalances: allRunningBalances,
      startingBalance: accountBalanceValue ?? 0,
      getPayeeByTransferAccount,
      getTransferAccountByPayee,
    });

    const transactionIds = new Set(previewTransactions.map(t => t.id));
    const runningBalances = new Map(
      [...previewRunningBalances.entries()].filter(([id]) =>
        transactionIds.has(id),
      ),
    );

    return {
      isLoading,
      previewTransactions,
      runningBalances,
      error,
    };
  }, [
    accountId,
    allPreviewTransactions,
    accountBalanceValue,
    allRunningBalances,
    getPayeeByTransferAccount,
    getTransferAccountByPayee,
    isLoading,
    error,
  ]);
}
