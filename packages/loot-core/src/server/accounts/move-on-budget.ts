// Moving an off-budget account on budget (openspec/changes/account-move-on-budget)
import * as db from '#server/db';
import { fromDateRepr, toDateRepr } from '#server/models';
import { batchMessages } from '#server/sync';
import type { AccountEntity } from '#types/models';

import { getStartingBalancePayee } from './payees';

type Row = {
  id: string;
  date: number;
  amount: number;
  category: string | null;
  transfer_id: string | null;
  other_account: string | null;
  other_account_name: string | null;
  other_category: string | null;
};

export type MoveOnBudgetTransfer = {
  id: string;
  date: string;
  amount: number;
  otherAccount: string | null;
  otherAccountName: string | null;
  // The category the other side keeps; null for an off-budget other account
  keptCategory: string | null;
};

export type MoveOnBudgetPreview = {
  // Transactions before the start date, which all become uncategorized
  before: number;
  // Transactions from the start date on that end up without a category
  fromUncategorized: number;
  // Categories the move clears: before the start date, and this account's
  // sides of transfers of any date
  categoriesCleared: number;
  // Non-transfer transactions from the start date on that keep theirs
  categoriesKept: number;
  // Newest first
  transfers: MoveOnBudgetTransfer[];
  // The account's balance on the start date, which the budget gains
  startingBalance: number;
};

// One row per transaction that has an amount of its own: split children count
// once each, and a parent with children doesn't count
function getRows(accountId: AccountEntity['id']): Promise<Row[]> {
  return db.all<Row>(
    `SELECT t.id, t.date, t.amount, t.category, t.transfer_id,
            o.acct AS other_account, oa.name AS other_account_name,
            CASE WHEN oa.offbudget = 0 THEN o.category ELSE NULL END
              AS other_category
       FROM v_transactions_internal_alive t
       LEFT JOIN transactions o ON o.id = t.transfer_id AND o.tombstone = 0
       LEFT JOIN accounts oa ON oa.id = o.acct
      WHERE t.account = ? AND t.is_parent = 0
      ORDER BY t.date DESC, t.sort_order DESC`,
    [accountId],
  );
}

function plan(rows: Row[], startDate: string) {
  const start = toDateRepr(startDate);
  const isBefore = (row: Row) => row.date < start;
  // Hidden categories before the start date, and on this account's side of
  // any transfer, which would otherwise count the money a second time
  const toClear = rows.filter(
    row => row.category != null && (isBefore(row) || row.transfer_id != null),
  );
  const kept = rows.filter(
    row => row.category != null && !isBefore(row) && row.transfer_id == null,
  );
  const preview: MoveOnBudgetPreview = {
    before: rows.filter(isBefore).length,
    fromUncategorized: rows.filter(row => !isBefore(row)).length - kept.length,
    categoriesCleared: toClear.length,
    categoriesKept: kept.length,
    transfers: rows
      .filter(row => row.transfer_id != null)
      .map(row => ({
        id: row.id,
        date: fromDateRepr(row.date),
        amount: row.amount,
        otherAccount: row.other_account,
        otherAccountName: row.other_account_name,
        keptCategory: row.other_category,
      })),
    startingBalance: rows
      .filter(isBefore)
      .reduce((sum, row) => sum + row.amount, 0),
  };
  return { preview, toClear };
}

async function getMovableAccount(id: AccountEntity['id']) {
  const account = await db.first<db.DbAccount>(
    'SELECT * FROM accounts WHERE id = ? AND tombstone = 0',
    [id],
  );
  if (!account) {
    throw new Error(`Account ${id} not found`);
  }
  if (account.closed) {
    throw new Error('A closed account cannot be moved on budget');
  }
  if (!account.offbudget) {
    throw new Error('The account is already on budget');
  }
  return account;
}

export async function previewMoveOnBudget({
  id,
  startDate,
}: {
  id: AccountEntity['id'];
  startDate: string;
}): Promise<MoveOnBudgetPreview> {
  await getMovableAccount(id);
  return plan(await getRows(id), startDate).preview;
}

export async function moveOnBudget({
  id,
  startDate,
}: {
  id: AccountEntity['id'];
  startDate: string;
}): Promise<void> {
  await getMovableAccount(id);
  const { preview, toClear } = plan(await getRows(id), startDate);
  const balance = preview.startingBalance;
  const startingBalance =
    balance !== 0 ? await getStartingBalancePayee() : null;

  await batchMessages(async () => {
    await db.update('accounts', { id, offbudget: 0 });
    for (const row of toClear) {
      await db.updateTransaction({ id: row.id, category: null });
    }
    if (startingBalance) {
      // Nets to zero: the budget gains the balance as income, and the offset
      // cancels the transactions before the start date (now uncategorized)
      const parent = await db.insertTransaction({
        account: id,
        date: startDate,
        amount: 0,
        payee: startingBalance.id,
        cleared: true,
        is_parent: true,
      });
      await db.insertTransaction({
        account: id,
        date: startDate,
        amount: balance,
        payee: startingBalance.id,
        category: startingBalance.category,
        notes: 'Starting balance',
        cleared: true,
        is_child: true,
        parent_id: parent,
      });
      await db.insertTransaction({
        account: id,
        date: startDate,
        amount: -balance,
        payee: startingBalance.id,
        category: null,
        notes: `Offsets transactions before ${startDate} (moved on budget)`,
        cleared: true,
        is_child: true,
        parent_id: parent,
      });
    }
  });
}
