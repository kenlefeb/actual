// History of an account moved on budget (openspec/changes/move-on-budget-moved-history):
// its transactions before the start date and its offset line are already in
// the starting balance, so they aren't uncategorized.
import type { AccountEntity, TransactionEntity } from '#types/models';

type MovedAccount = Pick<
  AccountEntity,
  'budget_start_date' | 'budget_start_offset'
>;

export function isMovedHistory(
  transaction: Pick<TransactionEntity, 'id' | 'date'>,
  account?: MovedAccount | null,
): boolean {
  if (!account?.budget_start_date) {
    return false;
  }
  return (
    transaction.date < account.budget_start_date ||
    transaction.id === account.budget_start_offset
  );
}

// AQL filter for transactions that are NOT moved history. Each clause checks
// for null first: a never-moved account must keep its transactions (AQL's
// `$ne` field comparison compiles to `(x != y OR x IS NULL)`, and `id != NULL`
// alone would match none).
export function notMovedHistoryFilter(field: string) {
  return {
    $and: [
      {
        $or: [
          { [`${field}.budget_start_date`]: null },
          { date: { $gte: `$${field}.budget_start_date` } },
        ],
      },
      {
        $or: [
          { [`${field}.budget_start_offset`]: null },
          { id: { $ne: `$${field}.budget_start_offset` } },
        ],
      },
    ],
  };
}
