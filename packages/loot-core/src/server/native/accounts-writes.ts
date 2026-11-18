// Fork-only (sc-4931, openspec/changes/native-accounts-screen D3). The native
// Accounts screen's four writes. Each is validated whole before anything
// changes and takes the Swift-minted undo token; app.ts registers each as one
// undo step carrying it. Swift never writes the database.
import * as db from '#server/db';
import { batchUpdateTransactions } from '#server/transactions';

import { readLimit } from './reconcile-lock';
import { nativeRefusal } from './refusal';

// What a write touched, for the undo conflict check (D3a)
export type Touched = { transactions: string[]; accounts: string[] };

type Row = {
  id: string;
  acct: string;
  isChild: number;
  is_parent: number;
  reconciled: number;
  transfer_id: string | null;
};

function checkToken(name: string, undoToken: unknown) {
  if (typeof undoToken !== 'string' || !undoToken) {
    throw new Error(`${name}: a native write needs its undo token`);
  }
}

const marks = (ids: unknown[]) => ids.map(() => '?').join(',');

async function readOpenAccount(name: string, id: unknown) {
  const account =
    typeof id === 'string'
      ? await db.first<{ id: string; offbudget: number }>(
          'SELECT id, offbudget FROM accounts WHERE id = ? AND tombstone = 0 AND closed = 0',
          [id],
        )
      : null;
  if (!account) throw new Error(`${name}: no such open account`);
  return account;
}

/**
 * Every id must be a live, top-level row of the open account; a split parent
 * carries its children. Returns those rows, the children and, for a transfer,
 * the partner rows, which all count toward `accounts-write-max-ids`.
 */
async function readRows(name: string, accountId: unknown, ids: unknown) {
  const account = await readOpenAccount(name, accountId);
  const max = await readLimit('accounts-write-max-ids');
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    !ids.every(id => typeof id === 'string')
  ) {
    throw new Error(`${name}: ids must be a list of row ids`);
  }
  const unique = [...new Set(ids as string[])];
  if (unique.length > max) {
    throw new Error(`${name}: at most ${max} rows per call`);
  }
  const rows = await db.all<Row>(
    `SELECT id, acct, isChild, isParent AS is_parent, reconciled, transferred_id AS transfer_id FROM transactions
     WHERE tombstone = 0 AND id IN (${marks(unique)})`,
    unique,
  );
  if (
    rows.length !== unique.length ||
    rows.some(r => r.acct !== account.id || r.isChild)
  ) {
    throw new Error(
      `${name}: every row must be a live row of the account, not a split child`,
    );
  }
  return { account, rows, max };
}

type Touch = { id: string; reconciled: number; isChild: number };

/**
 * Everything a write changes beyond the named rows: a split's children (when
 * `withChildren`) and the transfer partner of every one of those rows, children
 * included. The cap and the reconciled check apply to the whole set.
 */
async function touchedRows(rows: Row[], withChildren: boolean) {
  const children = withChildren
    ? await db.all<Touch & { transfer_id: string | null }>(
        `SELECT id, reconciled, isChild, transferred_id AS transfer_id FROM transactions
         WHERE tombstone = 0 AND isChild = 1 AND parent_id IN (${marks(rows)})`,
        rows.map(r => r.id),
      )
    : [];
  const own = new Set([...rows, ...children].map(r => r.id));
  const partnerIds = [
    ...new Set(
      [...rows, ...children].flatMap(r =>
        r.transfer_id && !own.has(r.transfer_id) ? [r.transfer_id] : [],
      ),
    ),
  ];
  const partners = partnerIds.length
    ? await db.all<Touch>(
        // A split child counts as reconciled when its parent is
        `SELECT t.id, (t.reconciled OR COALESCE(p.reconciled, 0)) AS reconciled, t.isChild
         FROM transactions t LEFT JOIN transactions p ON p.id = t.parent_id AND p.tombstone = 0
         WHERE t.tombstone = 0 AND t.id IN (${marks(partnerIds)})`,
        partnerIds,
      )
    : [];
  return { children, partners, all: [...rows, ...children, ...partners] };
}

function checkFullSet(
  name: string,
  all: Touch[],
  max: number,
  confirmed: unknown,
) {
  if (all.length > max) {
    throw new Error(`${name}: at most ${max} rows per call`);
  }
  checkReconciled(name, all, confirmed);
}

function checkReconciled(
  name: string,
  rows: { reconciled: number }[],
  confirmed: unknown,
) {
  if (confirmed !== true && rows.some(r => r.reconciled)) {
    throw nativeRefusal(
      'needs-confirmed-reconciled',
      `${name}: a reconciled row needs confirmedReconciled to be true`,
    );
  }
}

export async function transactionsCategorize(
  args: {
    account_id: string;
    ids: string[];
    category: string | null;
    confirmedReconciled?: boolean;
    undoToken: string;
  },
  touched?: Touched,
) {
  const name = 'native/transactions-categorize';
  const { account_id, ids, category, confirmedReconciled, undoToken } =
    args ?? ({} as typeof args);
  checkToken(name, undoToken);
  const { account, rows, max } = await readRows(name, account_id, ids);
  if (account.offbudget) {
    throw new Error(`${name}: an off-budget account's rows have no category`);
  }
  if (rows.some(r => r.is_parent)) {
    throw new Error(`${name}: a split changes in the editor`);
  }
  if (category !== null) {
    const found =
      typeof category === 'string'
        ? await db.first<{ id: string }>(
            `SELECT c.id FROM categories c JOIN category_groups g ON g.id = c.cat_group
             WHERE c.id = ? AND c.tombstone = 0 AND c.hidden = 0 AND g.hidden = 0`,
            [category],
          )
        : null;
    if (!found) throw new Error(`${name}: no such visible category`);
  }
  // The web gives a transfer between two on-budget accounts no category
  const partners = rows.filter(r => r.transfer_id);
  if (partners.length > 0) {
    const onBudget = await db.first<{ id: string }>(
      `SELECT t.id FROM transactions t JOIN accounts a ON a.id = t.acct
       WHERE t.tombstone = 0 AND a.offbudget = 0 AND t.id IN (${marks(partners)})`,
      partners.map(r => r.transfer_id),
    );
    if (onBudget) {
      throw new Error(`${name}: a transfer between on-budget accounts`);
    }
  }
  // Updating a transfer rewrites its partner row too, so that is touched
  const { all } = await touchedRows(rows, false);
  checkFullSet(name, all, max, confirmedReconciled);
  touched?.transactions.push(...all.map(r => r.id));
  await batchUpdateTransactions({
    // null clears the category, which the entity type does not name
    updated: rows.map(r => ({ id: r.id, category: category as string })),
  });
  return { updated: rows.length };
}

export async function transactionsDelete(
  args: {
    account_id: string;
    ids: string[];
    confirmedReconciled?: boolean;
    undoToken: string;
  },
  touched?: Touched,
) {
  const name = 'native/transactions-delete';
  const { account_id, ids, confirmedReconciled, undoToken } =
    args ?? ({} as typeof args);
  checkToken(name, undoToken);
  const { rows, max } = await readRows(name, account_id, ids);
  const { children, partners, all } = await touchedRows(rows, true);
  checkFullSet(name, all, max, confirmedReconciled);
  touched?.transactions.push(...all.map(r => r.id));
  await batchUpdateTransactions({ deleted: rows.map(r => ({ id: r.id })) });
  // A partner that is a split child is unlinked and kept, not deleted
  return {
    deleted:
      rows.length + children.length + partners.filter(p => !p.isChild).length,
  };
}

export async function accountReopen(
  args: { id: string; undoToken: string },
  touched?: Touched,
) {
  const name = 'native/account-reopen';
  const { id, undoToken } = args ?? ({} as typeof args);
  checkToken(name, undoToken);
  const closed =
    typeof id === 'string'
      ? await db.first<{ id: string }>(
          'SELECT id FROM accounts WHERE id = ? AND tombstone = 0 AND closed = 1',
          [id],
        )
      : null;
  if (!closed) throw new Error(`${name}: no such closed account`);
  touched?.accounts.push(id);
  await db.update('accounts', { id, closed: 0 });
}

export async function accountMove(
  args: {
    id: string;
    targetId: string | null;
    undoToken: string;
  },
  touched?: Touched,
) {
  const name = 'native/account-move';
  const { id, targetId, undoToken } = args ?? ({} as typeof args);
  checkToken(name, undoToken);
  const account = await readOpenAccount(name, id);
  if (targetId !== null) {
    const target = await readOpenAccount(name, targetId);
    if (target.id === account.id || target.offbudget !== account.offbudget) {
      throw new Error(
        `${name}: the target must be another account in the section`,
      );
    }
  }
  // The move shoves the sort order of every account in the section, closed ones
  // included, as db.moveAccount does
  touched?.accounts.push(
    ...(
      await db.all<{ id: string }>(
        'SELECT id FROM accounts WHERE tombstone = 0 AND offbudget = ?',
        [account.offbudget ? 1 : 0],
      )
    ).map(a => a.id),
  );
  await db.moveAccount(account.id, targetId);
}

/** The fields a later change would alter, for the rows and accounts a write touched. */
export async function readTouchedState(touched: Touched) {
  const transactions = [...new Set(touched.transactions)].sort();
  const accounts = [...new Set(touched.accounts)].sort();
  return {
    transactions: transactions.length
      ? await db.all(
          `SELECT id, category, tombstone, reconciled, cleared, notes, amount, description, acct, date, transferred_id, schedule,
             parent_id, isParent AS is_parent, isChild AS is_child, sort_order FROM transactions
           WHERE id IN (${marks(transactions)}) ORDER BY id`,
          transactions,
        )
      : [],
    accounts: accounts.length
      ? await db.all(
          `SELECT id, closed, tombstone, sort_order FROM accounts
           WHERE id IN (${marks(accounts)}) ORDER BY id`,
          accounts,
        )
      : [],
  };
}

export type RecordedState = Awaited<ReturnType<typeof readTouchedState>>;

/** True when anything the write touched differs from what it left. */
export async function changedSince(touched: Touched, state: RecordedState) {
  return (
    JSON.stringify(await readTouchedState(touched)) !== JSON.stringify(state)
  );
}
