import { isMovedHistory } from '@actual-app/core/shared/moved-history';
import type { TransactionEntity } from '@actual-app/core/types/models';

import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

import { useAccounts } from './useAccounts';

// Categorizing a moved account's history double counts the money, so the app
// asks first (openspec/changes/move-on-budget-moved-history).
export function useConfirmMovedHistory() {
  const dispatch = useDispatch();
  const { data: accounts } = useAccounts();

  return {
    includesMovedHistory: (
      transactions: Array<Pick<TransactionEntity, 'id' | 'date' | 'account'>>,
    ) =>
      transactions.some(transaction =>
        isMovedHistory(
          transaction,
          accounts?.find(account => account.id === transaction.account),
        ),
      ),
    confirm: (onConfirm: () => void, options?: { isBatch?: boolean }) =>
      dispatch(
        pushModal({
          modal: {
            name: 'confirm-categorize-moved-history',
            options: { onConfirm, ...options },
          },
        }),
      ),
  };
}

// The category sheet closes around the time it calls onSelect, and closing
// removes any modal pushed meanwhile. Runs `fn` once the sheet has closed:
// `run` goes to onSelect and `onClose` to the sheet's onClose.
export function afterSheetCloses() {
  let isClosed = false;
  let pending: (() => void) | null = null;
  return {
    run: (fn: () => void) => {
      if (isClosed) {
        fn();
      } else {
        pending = fn;
      }
    },
    onClose: () => {
      isClosed = true;
      pending?.();
      pending = null;
    },
  };
}
