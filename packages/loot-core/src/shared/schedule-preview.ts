// Fork-only (sc-4973, openspec/changes/native-register-upcoming-rows D1). The
// schedule preview's relevance, inversion and sort, moved verbatim from the
// web's hooks (useAccountPreviewTransactions, usePreviewTransactions,
// useTransactions) so the web and the native register share one engine.
import type {
  AccountEntity,
  PayeeEntity,
  ScheduleEntity,
  TransactionEntity,
} from '#types/models';

import * as monthUtils from './months';
import type { IntegerAmount } from './util';

// Mirrors the `splits` AQL option from the server
type TransactionSplitsOption = 'all' | 'inline' | 'grouped' | 'none';
export function comparePreviewTransactions(
  a: Pick<TransactionEntity, 'date' | 'amount'> & {
    sort_order?: number | null;
  },
  b: Pick<TransactionEntity, 'date' | 'amount'> & {
    sort_order?: number | null;
  },
): number {
  const dateDiff =
    monthUtils.parseDate(b.date).getTime() -
    monthUtils.parseDate(a.date).getTime();
  if (dateDiff !== 0) return dateDiff;

  const sortOrderDiff = (b.sort_order ?? 0) - (a.sort_order ?? 0);
  if (sortOrderDiff !== 0) return sortOrderDiff;

  return a.amount - b.amount;
}

export function calculateRunningBalancesBottomUp(
  transactions: readonly TransactionEntity[],
  splits: TransactionSplitsOption,
  startingBalance: IntegerAmount = 0,
) {
  return (
    transactions
      .filter(t => {
        switch (splits) {
          case 'all':
            // Only calculate parent/non-split amounts
            return !t.parent_id;
          default:
            // inline
            // grouped
            // none
            return true;
        }
      })
      // We're using `reduceRight` here to calculate the running balance in reverse order (bottom up).
      .reduceRight((acc, transaction, index, arr) => {
        const previousTransactionIndex = index + 1;
        if (previousTransactionIndex >= arr.length) {
          // This is the last transaction in the list,
          // so we set the running balance to the starting balance + the amount of the transaction
          acc.set(transaction.id, startingBalance + transaction.amount);
          return acc;
        }
        const previousTransaction = arr[previousTransactionIndex];
        const previousRunningBalance = acc.get(previousTransaction.id) ?? 0;
        const currentRunningBalance =
          previousRunningBalance + transaction.amount;
        acc.set(transaction.id, currentRunningBalance);
        return acc;
      }, new Map<TransactionEntity['id'], IntegerAmount>())
  );
}

type InverseBasedOnAccountProps = {
  accountId?: AccountEntity['id'];
  transactions: readonly TransactionEntity[];
  startingBalance: IntegerAmount;
  runningBalances: Map<TransactionEntity['id'], IntegerAmount>;
  getPayeeByTransferAccount: (
    transferAccountId?: AccountEntity['id'] | null,
  ) => PayeeEntity | null;
  getTransferAccountByPayee: (
    payeeId?: PayeeEntity['id'] | null,
  ) => AccountEntity | null;
};

type AccountPreviewTransaction = TransactionEntity & {
  inversed: boolean;
};

type ScheduleRelevantToAccountProps = Pick<
  InverseBasedOnAccountProps,
  'accountId' | 'getTransferAccountByPayee'
> & {
  schedule: ScheduleEntity;
};

export function isScheduleRelevantToAccount({
  accountId,
  schedule,
  getTransferAccountByPayee,
}: ScheduleRelevantToAccountProps): boolean {
  if (!accountId) {
    return true;
  }

  if (
    schedule._account === accountId ||
    getTransferAccountByPayee(schedule._payee)?.id === accountId
  ) {
    return true;
  }

  return schedule._actions.some(action => {
    if (
      action.op !== 'set' ||
      (action.field !== 'payee' && action.field !== 'description') ||
      !action.options?.splitIndex
    ) {
      return false;
    }

    if (
      action.options.formula != null ||
      action.options.template != null ||
      typeof action.value !== 'string'
    ) {
      return true;
    }

    return getTransferAccountByPayee(action.value)?.id === accountId;
  });
}

function inverseTransferForAccount({
  accountId,
  previewStatus,
  transaction,
  getPayeeByTransferAccount,
}: Pick<
  InverseBasedOnAccountProps,
  'accountId' | 'getPayeeByTransferAccount'
> & {
  previewStatus?: TransactionEntity['category'];
  transaction: TransactionEntity;
}): AccountPreviewTransaction {
  const {
    category: _category,
    is_child: _isChild,
    is_parent: _isParent,
    parent_id: _parentId,
    subtransactions: _subtransactions,
    ...standaloneTransaction
  } = transaction;

  return {
    ...standaloneTransaction,
    inversed: true,
    amount: -transaction.amount,
    payee: getPayeeByTransferAccount(transaction.account)?.id || '',
    account: accountId || '',
    ...(previewStatus != null && { category: previewStatus }),
  };
}

export function inverseBasedOnAccount({
  accountId,
  transactions,
  runningBalances,
  startingBalance,
  getPayeeByTransferAccount,
  getTransferAccountByPayee,
}: InverseBasedOnAccountProps): {
  transactions: TransactionEntity[];
  runningBalances: Map<TransactionEntity['id'], IntegerAmount>;
} {
  const parentPreviewStatuses = new Map(
    transactions
      .filter(transaction => transaction.is_parent)
      .map(transaction => [transaction.id, transaction.category]),
  );
  const mappedTransactions: AccountPreviewTransaction[] = transactions.flatMap(
    transaction => {
      if (transaction.account === accountId) {
        return [{ inversed: false, ...transaction }];
      }

      const candidates = transaction.subtransactions
        ? transaction.subtransactions
        : transaction.is_parent
          ? []
          : [transaction];

      return candidates
        .filter(
          candidate =>
            getTransferAccountByPayee(candidate.payee)?.id === accountId,
        )
        .map(candidate =>
          inverseTransferForAccount({
            accountId,
            previewStatus: candidate.parent_id
              ? parentPreviewStatuses.get(candidate.parent_id)
              : candidate.category,
            transaction: candidate,
            getPayeeByTransferAccount,
          }),
        );
    },
  );

  // Recalculate running balances if any transaction was inversed.
  // This is necessary because the running balances are calculated based on the
  // original transaction amounts and accounts, and we need to adjust them
  // based on the inversed transactions.
  const anyInversed = mappedTransactions.some(t => t.inversed);
  const mappedRunningBalances = anyInversed
    ? calculateRunningBalancesBottomUp(
        mappedTransactions,
        'all',
        startingBalance ?? 0,
      )
    : runningBalances;

  return {
    transactions: mappedTransactions,
    runningBalances: mappedRunningBalances,
  };
}
