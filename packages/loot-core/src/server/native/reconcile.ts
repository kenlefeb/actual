// Fork-only (sc-4801, openspec/changes/native-reconcile-flow D5). The native
// Reconcile flow's reads and writes: every number is loot-core's, Swift only
// shows it. The contract is reconcile.test.ts and its fixtures.
import {
  clearedBalanceOf,
  getStatementBalance,
} from '#server/accounts/statement-balance';
import type { StatementBalanceRecord } from '#server/accounts/statement-balance';
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { batchUpdateTransactions } from '#server/transactions';
import * as monthUtils from '#shared/months';
import { q } from '#shared/query';

export const EXCLUDED_PREF = 'reconcile-excluded-accounts';
const MAX_EXCLUDED = 500;
const MAX_TICK_IDS = 500;
// The MCP's defaults (packages/mcp/src/limits.ts): a record it would call
// expired is not in progress here either
const RECORD_MAX_AGE_MS = 168 * 3_600_000;
const RECORD_SKEW_MS = 5 * 60_000;

// `ready` is reserved for the assistant nudge (design D6); nothing sets it
export type NativeReconcileStatus = 'due' | 'in-progress' | 'done' | 'ready';

export type NativeReconcileMonth = {
  month: string;
  excluded: string[];
  // The open accounts on the exclusion list, for Edit List to re-add
  hidden: { id: string; name: string }[];
  accounts: {
    id: string;
    name: string;
    status: NativeReconcileStatus;
    detail: { cleared: number; statement: number | null };
    // ms, as the account stores it
    last_reconciled: string | null;
    // The bank sync provider (e.g. simpleFin), named by the source line
    sync_source: string | null;
  }[];
};

export type NativeReconcileSummary = {
  // The unconsumed, unexpired recorded balance; null without one
  statement: number | null;
  cleared: number;
  difference: number | null;
};

export type NativeReconcileRow = {
  id: string;
  date: string;
  payee: string | null;
  category: string | null;
  notes: string | null;
  amount: number;
  cleared: boolean;
  reconciled: boolean;
  isParent: boolean;
};

export type NativeReconcileRows = {
  account: string;
  scope: 'to-tick' | 'all';
  rows: NativeReconcileRow[];
  summary: NativeReconcileSummary;
};

/** Not a list of at most 500 strings: null. The preference can also be written by preferences/save. */
function readExcluded(value: unknown): string[] | null {
  return Array.isArray(value) &&
    value.length <= MAX_EXCLUDED &&
    value.every(id => typeof id === 'string')
    ? value
    : null;
}

async function storedExcluded(): Promise<string[]> {
  const row = await db.first<{ value: string | null }>(
    'SELECT value FROM preferences WHERE id = ?',
    [EXCLUDED_PREF],
  );
  try {
    return readExcluded(JSON.parse(row?.value ?? '[]')) ?? [];
  } catch {
    return [];
  }
}

function isUsable(record: StatementBalanceRecord | null) {
  if (!record || record.consumed_at !== null) return false;
  const age = Date.now() - record.entered_at;
  return age <= RECORD_MAX_AGE_MS && age >= -RECORD_SKEW_MS;
}

async function summaryOf(accountId: string): Promise<NativeReconcileSummary> {
  const record = await getStatementBalance({ account_id: accountId });
  const statement = record && isUsable(record) ? record.amount : null;
  const cleared = await clearedBalanceOf(accountId);
  return {
    statement,
    cleared,
    difference: statement === null ? null : statement - cleared,
  };
}

async function openAccount(id: unknown) {
  const account =
    typeof id === 'string'
      ? await db.first<{ id: string }>(
          'SELECT id FROM accounts WHERE id = ? AND tombstone = 0 AND closed = 0',
          [id],
        )
      : null;
  if (!account) throw new Error('native/reconcile: no such open account');
  return account.id;
}

export async function reconcileMonth(): Promise<NativeReconcileMonth> {
  const month = monthUtils.currentMonth();
  const excluded = await storedExcluded();
  const accounts = await db.all<{
    id: string;
    name: string;
    last_reconciled: string | null;
    account_sync_source: string | null;
  }>(
    'SELECT id, name, last_reconciled, account_sync_source FROM accounts WHERE tombstone = 0 AND closed = 0 ORDER BY sort_order, name',
  );
  return {
    month,
    excluded,
    hidden: accounts
      .filter(a => excluded.includes(a.id))
      .map(({ id, name }) => ({ id, name })),
    accounts: await Promise.all(
      accounts
        .filter(a => !excluded.includes(a.id))
        .map(async a => {
          const summary = await summaryOf(a.id);
          const reconciledAt = Number(a.last_reconciled);
          const isDone =
            !!a.last_reconciled &&
            Number.isFinite(reconciledAt) &&
            monthUtils.monthFromDate(new Date(reconciledAt)) === month;
          return {
            id: a.id,
            name: a.name,
            status:
              summary.statement !== null
                ? 'in-progress'
                : isDone
                  ? 'done'
                  : 'due',
            detail: { cleared: summary.cleared, statement: summary.statement },
            last_reconciled: a.last_reconciled ?? null,
            sync_source: a.account_sync_source ?? null,
          };
        }),
    ),
  };
}

/**
 * `to-tick`: uncleared rows up to today. `all`: this month's rows up to today
 * and every earlier row not yet reconciled. Split children are left out:
 * their parent stands for them.
 */
export async function reconcileRows({
  account_id,
  scope,
}: {
  account_id: string;
  scope: 'to-tick' | 'all';
}): Promise<NativeReconcileRows> {
  const account = await openAccount(account_id);
  if (scope !== 'to-tick' && scope !== 'all') {
    throw new Error('native/reconcile-rows: scope must be to-tick or all');
  }
  const today = monthUtils.currentDay();
  const filter =
    scope === 'to-tick'
      ? { cleared: false }
      : {
          $or: [
            { reconciled: false },
            { date: { $gte: monthUtils.firstDayOfMonth(today) } },
          ],
        };
  const { data } = (await aqlQuery(
    q('transactions')
      .filter({ account, date: { $lte: today }, ...filter })
      .options({ splits: 'none' })
      .select([
        'id',
        'date',
        { payee: 'payee.name' },
        { category: 'category.name' },
        'notes',
        'amount',
        'cleared',
        'reconciled',
        'is_parent',
      ])
      .orderBy([{ date: 'desc' }, { sort_order: 'desc' }]),
  )) as {
    data: (Omit<NativeReconcileRow, 'isParent'> & { is_parent: boolean })[];
  };
  return {
    account,
    scope,
    rows: data.map(({ is_parent, ...row }) => ({
      ...row,
      payee: row.payee ?? null,
      category: row.category ?? null,
      notes: row.notes ?? null,
      cleared: Boolean(row.cleared),
      reconciled: Boolean(row.reconciled),
      isParent: Boolean(is_parent),
    })),
    summary: await summaryOf(account),
  };
}

/**
 * Sets cleared on rows of one account, all or nothing: every id must be a live
 * row of the account, not reconciled and not a split child; a parent carries
 * its children. One undo step (registered undoable with the token).
 */
export async function reconcileTick(args: {
  account_id: string;
  ids: string[];
  cleared: boolean;
  undoToken: string;
}): Promise<NativeReconcileSummary> {
  const { account_id, ids, cleared, undoToken } = args ?? ({} as typeof args);
  if (typeof undoToken !== 'string' || !undoToken) {
    throw new Error(
      'native/reconcile-tick: a native write needs its undo token',
    );
  }
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > MAX_TICK_IDS ||
    !ids.every(id => typeof id === 'string') ||
    typeof cleared !== 'boolean'
  ) {
    throw new Error('native/reconcile-tick: invalid arguments');
  }
  const account = await openAccount(account_id);
  const unique = [...new Set(ids)];
  const marks = unique.map(() => '?').join(',');
  const found = await db.all<{
    id: string;
    acct: string;
    isChild: number;
    reconciled: number;
  }>(
    `SELECT id, acct, isChild, reconciled FROM transactions WHERE tombstone = 0 AND id IN (${marks})`,
    unique,
  );
  if (
    found.length !== unique.length ||
    found.some(t => t.acct !== account || t.isChild || t.reconciled)
  ) {
    throw new Error(
      'native/reconcile-tick: every row must be an unreconciled row of the account, not a split child',
    );
  }
  const children = await db.all<{ id: string }>(
    `SELECT id FROM transactions WHERE tombstone = 0 AND isChild = 1 AND parent_id IN (${marks})`,
    unique,
  );
  await batchUpdateTransactions({
    updated: [...unique, ...children.map(c => c.id)].map(id => ({
      id,
      cleared,
    })),
  });
  return summaryOf(account);
}

/** Writes only the exclusion preference; refuses what the read would ignore. */
export async function reconcileListSet({
  excluded,
}: {
  excluded: string[];
}): Promise<void> {
  const list = readExcluded(excluded);
  if (!list) {
    throw new Error(
      `native/reconcile-list-set: excluded must be at most ${MAX_EXCLUDED} account ids`,
    );
  }
  await db.update('preferences', {
    id: EXCLUDED_PREF,
    value: JSON.stringify([...new Set(list)]),
  });
}
