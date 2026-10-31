import { send } from '@actual-app/core/platform/client/connection';
import type {
  RuleActionEntity,
  TransactionEntity,
} from '@actual-app/core/types/models';

import { addNotification } from '#notifications/notificationsSlice';
import { useDispatch } from '#redux';

import { useConfirmMovedHistory } from './useConfirmMovedHistory';

// Applies a rule's actions to the chosen transactions in one call. Setting a
// category on moved history double counts it, so that asks once for the batch.
export function useApplyRuleActions() {
  const dispatch = useDispatch();
  const { includesMovedHistory, confirm } = useConfirmMovedHistory();

  return (
    transactions: TransactionEntity[],
    actions: RuleActionEntity[],
    onApplied: () => void,
  ) => {
    const run = () =>
      void send('rule-apply-actions', { transactions, actions }).then(
        content => {
          // This makes it refetch the transactions
          content?.errors.forEach(error => {
            dispatch(
              addNotification({
                notification: { type: 'error', message: error },
              }),
            );
          });
          onApplied();
        },
      );

    if (
      actions.some(
        action => 'field' in action && action.field === 'category',
      ) &&
      includesMovedHistory(transactions)
    ) {
      confirm(run, { isBatch: true });
    } else {
      run();
    }
  };
}
