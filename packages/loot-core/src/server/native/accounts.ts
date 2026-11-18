// Fork-only (sc-4386, openspec/changes/native-accounts-screen D1 and D2). The
// native Accounts screen's two batched reads: every number, name and order is
// loot-core's, Swift only shows it. The contract is accounts.test.ts and its
// fixtures.
import { aqlQuery } from '#server/aql';
import { app as businessCalendarsApp } from '#server/business-calendars/app';
import * as db from '#server/db';
import { fromDateRepr } from '#server/models';
import { getPaychecks } from '#server/paychecks/app';
import { refreshScheduleDateLookup } from '#server/schedules/app';
import { setBusinessCalendars } from '#shared/business-calendar-lookup';
import { q } from '#shared/query';
import {
  computeSchedulePreviewTransactions,
  DEFAULT_UPCOMING_SCHEDULE_DAYS,
  getHasTransactionsQuery,
  getStatus,
} from '#shared/schedules';
import type { ScheduleStatuses } from '#shared/schedules';
import type { ScheduleEntity, TransactionEntity } from '#types/models';

import { decimalPlaces, readLimit } from './reconcile-lock';

const MAX_SEARCH = 100;
const SCOPES = ['all', 'uncleared', 'uncategorized'] as const;
export type NativeRegisterScope = (typeof SCOPES)[number];
// The viewed table, as the AQL `transactions` table reads it
const ALIVE = 'v_transactions_internal_alive';

export type NativeAccount = {
  id: string;
  name: string;
  balance: number;
  offbudget: boolean;
  closed: boolean;
  // ms, as the account stores it
  lastSync: string | null;
  lastTransactionDate: string | null;
  // Linked to a bank
  bankSync: boolean;
  // The paycheck's name when this is its clearing account
  clearingFor: string | null;
};

type Section = { total: number; accounts: NativeAccount[] };

export type NativeAccountsList = {
  sections: { onBudget: Section; offBudget: Section };
  closed: Section;
  // The open accounts' sum
  netWorth: number;
};

export type NativeRegisterRow = {
  id: string;
  date: string;
  payee: string | null;
  category: string | null;
  splitCount: number;
  notes: string | null;
  amount: number;
  cleared: boolean;
  reconciled: boolean;
  // The other account of a transfer, and whether its row is reconciled
  transferAccount: { id: string; name: string } | null;
  transferReconciled: boolean | null;
  // Null unless scope all, no search and the account shows balances
  runningBalance: number | null;
};

export type NativeUpcomingRow = {
  id: string;
  scheduleId: string;
  date: string;
  payee: string | null;
  amount: number;
};

export type NativeAccountRegister = {
  rows: NativeRegisterRow[];
  nextCursor: string | null;
  // First page only
  header?: { balance: number; cleared: number; uncleared: number };
  upcoming?: NativeUpcomingRow[];
};

export async function accountsList(): Promise<NativeAccountsList> {
  const accounts = await db.all<{
    id: string;
    name: string;
    offbudget: number;
    closed: number;
    last_sync: string | null;
    account_id: string | null;
  }>(
    'SELECT id, name, offbudget, closed, last_sync, account_id FROM accounts WHERE tombstone = 0 ORDER BY sort_order, name',
  );
  // The same sums as the web's bindings: a split parent counts, its children do not
  const sums = new Map(
    (
      await db.all<{ account: string; balance: number; last: number | null }>(
        `SELECT account, SUM(amount) AS balance, MAX(date) AS last FROM ${ALIVE} WHERE is_child = 0 GROUP BY account`,
      )
    ).map(row => [row.account, row]),
  );
  const clearing = new Map(
    (await getPaychecks()).map(p => [p.definition.clearingAccount, p.name]),
  );

  const result: NativeAccountsList = {
    sections: {
      onBudget: { total: 0, accounts: [] },
      offBudget: { total: 0, accounts: [] },
    },
    closed: { total: 0, accounts: [] },
    netWorth: 0,
  };
  for (const a of accounts) {
    const sum = sums.get(a.id);
    const account: NativeAccount = {
      id: a.id,
      name: a.name,
      balance: sum?.balance ?? 0,
      offbudget: Boolean(a.offbudget),
      closed: Boolean(a.closed),
      lastSync: a.last_sync ?? null,
      lastTransactionDate: sum?.last ? fromDateRepr(sum.last) : null,
      bankSync: Boolean(a.account_id),
      clearingFor: clearing.get(a.id) ?? null,
    };
    const section = account.closed
      ? result.closed
      : account.offbudget
        ? result.sections.offBudget
        : result.sections.onBudget;
    section.accounts.push(account);
    section.total += account.balance;
    if (!account.closed) result.netWorth += account.balance;
  }
  return result;
}

type Cursor = {
  date: number;
  starting_balance_flag: number;
  sort_order: number;
  id: string;
};

function encodeCursor(row: { d: number; sb: number; so: number; id: string }) {
  return btoa(
    JSON.stringify({
      date: row.d,
      starting_balance_flag: row.sb,
      sort_order: row.so,
      id: row.id,
    }),
  );
}

/** Strict: base64 of JSON with exactly an integer date, numeric flag and sort_order and a string id. */
function decodeCursor(cursor: unknown): Cursor {
  const fail = () => new Error('native/account-register: invalid cursor');
  if (typeof cursor !== 'string') throw fail();
  let value: unknown;
  try {
    value = JSON.parse(atob(cursor));
  } catch {
    throw fail();
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw fail();
  }
  const { date, starting_balance_flag, sort_order, id, ...rest } =
    value as Record<string, unknown>;
  if (
    Object.keys(rest).length > 0 ||
    !Number.isInteger(date) ||
    typeof starting_balance_flag !== 'number' ||
    !Number.isFinite(starting_balance_flag) ||
    typeof sort_order !== 'number' ||
    !Number.isFinite(sort_order) ||
    typeof id !== 'string'
  ) {
    throw fail();
  }
  return { date: date as number, starting_balance_flag, sort_order, id };
}

const SORT_ORDER = 'IFNULL(t.sort_order, 0)';
// SQLite sorts NULL before every number; -1 keeps that order when the cursor
// compares the flag, so it matches the web's `starting_balance_flag` sort
const FLAG = 'IFNULL(t.starting_balance_flag, -1)';
// Rows after the cursor in the web's view order: date newest first, then the
// flag, sort order newest first, then id
const AFTER = `(t.date < ? OR (t.date = ? AND (${FLAG} > ? OR (${FLAG} = ? AND (${SORT_ORDER} < ? OR (${SORT_ORDER} = ? AND t.id > ?))))))`;
const afterParams = (c: Cursor) => [
  c.date,
  c.date,
  c.starting_balance_flag,
  c.starting_balance_flag,
  c.sort_order,
  c.sort_order,
  c.id,
];

const escapeLike = (text: string) =>
  `%${text.replace(/[\\%_]/g, c => `\\${c}`)}%`;

/** The SQL and parameters matching `text` against payee, category, notes and amount, as the web search does. */
async function searchMatch(text: string) {
  const places = await decimalPlaces();
  const numeric = text.replace(/^[^\d.-]+/, '').replace(/,/g, '');
  const pattern = new RegExp(
    places > 0 ? `^-?\\d{1,12}(\\.\\d{1,${places}})?$` : '^-?\\d{1,12}$',
  );
  const like = escapeLike(text);
  const textSql = (p: string, c: string, t: string) =>
    `(${p}.name LIKE ? ESCAPE '\\' OR ${c}.name LIKE ? ESCAPE '\\' OR ${t}.notes LIKE ? ESCAPE '\\')`;
  const amounts: number[] = [];
  if (pattern.test(numeric)) {
    const [whole, fraction = ''] = numeric.replace('-', '').split('.');
    const minor = parseInt(whole + fraction.padEnd(places, '0'), 10);
    amounts.push(minor, -minor);
  }
  const amountSql = (x: string) =>
    amounts.length
      ? ` OR ${x}.amount IN (${amounts.map(() => '?').join(',')})`
      : '';
  return {
    sql: (x: string, p: string, c: string) =>
      `(${textSql(p, c, x)}${amountSql(x)})`,
    params: [like, like, like, ...amounts],
  };
}

async function registerFilter(
  account: string,
  scope: NativeRegisterScope,
  search: unknown,
) {
  if (!SCOPES.includes(scope)) {
    throw new Error(
      'native/account-register: scope must be all, uncleared or uncategorized',
    );
  }
  if (
    search !== null &&
    search !== undefined &&
    (typeof search !== 'string' || search.length > MAX_SEARCH)
  ) {
    throw new Error(
      `native/account-register: search must be text of at most ${MAX_SEARCH} characters`,
    );
  }
  const text = typeof search === 'string' ? search.trim() : '';
  let sql = '';
  const params: (string | number)[] = [];
  if (scope === 'uncleared') {
    sql += ' AND t.cleared = 0';
  } else if (scope === 'uncategorized') {
    // As the web's Uncategorized filter: no categories on split parents, off-budget accounts or on-budget transfers
    sql +=
      ' AND t.category IS NULL AND t.is_parent = 0 AND a.offbudget = 0 AND (p.transfer_acct IS NULL OR ta.offbudget = 1)';
  }
  if (text) {
    const own = await searchMatch(text);
    const child = await searchMatch(text);
    // A matching split child returns its parent
    sql += ` AND (${own.sql('t', 'p', 'c')} OR t.id IN (
      SELECT t.parent_id FROM ${ALIVE} t
      LEFT JOIN payees p ON p.id = t.payee
      LEFT JOIN categories c ON c.id = t.category
      WHERE t.is_child = 1 AND t.account = ? AND ${child.sql('t', 'p', 'c')}))`;
    params.push(...own.params, account, ...child.params);
  }
  return { sql, params, filtered: scope !== 'all' || text !== '' };
}

export async function accountRegister({
  account_id,
  scope,
  search,
  cursor,
}: {
  account_id: string;
  scope: NativeRegisterScope;
  search?: string | null;
  cursor?: string | null;
}): Promise<NativeAccountRegister> {
  const account =
    typeof account_id === 'string'
      ? await db.first<{ id: string }>(
          'SELECT id FROM accounts WHERE id = ? AND tombstone = 0',
          [account_id],
        )
      : null;
  if (!account) throw new Error('native/account-register: no such account');
  const after = cursor == null ? null : decodeCursor(cursor);
  const filter = await registerFilter(account.id, scope, search);
  const limit = await readLimit('accounts-register-page-size');

  const found = await db.all<{
    id: string;
    d: number;
    sb: number;
    so: number;
    payee: string | null;
    category: string | null;
    notes: string | null;
    amount: number;
    cleared: number;
    reconciled: number;
    split_count: number;
    transfer_id: string | null;
    transfer_account: string | null;
    transfer_account_name: string | null;
    partner_reconciled: number | null;
  }>(
    `SELECT t.id, t.date AS d, ${FLAG} AS sb, ${SORT_ORDER} AS so, p.name AS payee, c.name AS category,
       t.notes, t.amount, t.cleared, t.reconciled,
       CASE WHEN t.is_parent = 1 THEN
         (SELECT COUNT(*) FROM transactions ch WHERE ch.parent_id = t.id AND ch.isChild = 1 AND ch.tombstone = 0)
         ELSE 0 END AS split_count,
       t.transfer_id, p.transfer_acct AS transfer_account, ta.name AS transfer_account_name,
       pt.reconciled AS partner_reconciled
     FROM ${ALIVE} t
     JOIN accounts a ON a.id = t.account
     LEFT JOIN payees p ON p.id = t.payee
     LEFT JOIN categories c ON c.id = t.category
     LEFT JOIN accounts ta ON ta.id = p.transfer_acct AND ta.tombstone = 0
     LEFT JOIN transactions pt ON pt.id = t.transfer_id AND pt.tombstone = 0
     WHERE t.account = ? AND t.is_child = 0${filter.sql}${after ? ` AND ${AFTER}` : ''}
     ORDER BY t.date DESC, ${FLAG}, ${SORT_ORDER} DESC, t.id
     LIMIT ?`,
    [
      account.id,
      ...filter.params,
      ...(after ? afterParams(after) : []),
      limit + 1,
    ],
  );
  const page = found.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = found.length > limit ? encodeCursor(last) : null;

  // The balance after each row: one sum over the rows older than the page
  let running: number | null = null;
  if (!filter.filtered && page.length > 0) {
    const shows = await db.first<{ value: string | null }>(
      'SELECT value FROM preferences WHERE id = ?',
      [`show-balances-${account.id}`],
    );
    if (shows?.value === 'true') {
      running =
        found.length > limit
          ? ((
              await db.first<{ sum: number | null }>(
                `SELECT SUM(t.amount) AS sum FROM ${ALIVE} t WHERE t.account = ? AND t.is_child = 0 AND ${AFTER}`,
                [
                  account.id,
                  ...afterParams({
                    date: last.d,
                    starting_balance_flag: last.sb,
                    sort_order: last.so,
                    id: last.id,
                  }),
                ],
              )
            )?.sum ?? 0)
          : 0;
    }
  }
  const rows: NativeRegisterRow[] = [];
  for (const r of [...page].reverse()) {
    if (running !== null) running += r.amount;
    rows.unshift({
      id: r.id,
      date: fromDateRepr(r.d),
      payee: r.payee ?? null,
      category: r.category ?? null,
      splitCount: r.split_count,
      notes: r.notes ?? null,
      amount: r.amount,
      cleared: Boolean(r.cleared),
      reconciled: Boolean(r.reconciled),
      transferAccount:
        r.transfer_account && r.transfer_account_name
          ? { id: r.transfer_account, name: r.transfer_account_name }
          : null,
      transferReconciled:
        r.transfer_id && r.partner_reconciled !== null
          ? Boolean(r.partner_reconciled)
          : null,
      runningBalance: running,
    });
  }

  if (after) return { rows, nextCursor };
  const header = await db.first<{
    balance: number | null;
    cleared: number | null;
  }>(
    `SELECT SUM(amount) AS balance, SUM(CASE WHEN cleared = 1 THEN amount ELSE 0 END) AS cleared
     FROM ${ALIVE} WHERE account = ? AND is_child = 0`,
    [account.id],
  );
  const balance = header?.balance ?? 0;
  const cleared = header?.cleared ?? 0;
  return {
    rows,
    nextCursor,
    header: { balance, cleared, uncleared: balance - cleared },
    // The web shows scheduled rows only in the unfiltered register
    upcoming: filter.filtered ? [] : await upcomingRows(account.id),
  };
}

/** The account's scheduled rows inside the upcoming window, from the helper the web's preview uses. */
async function upcomingRows(account: string): Promise<NativeUpcomingRow[]> {
  const { data: schedules } = (await aqlQuery(q('schedules').select('*'))) as {
    data: ScheduleEntity[];
  };
  if (schedules.length === 0) return [];
  await refreshScheduleDateLookup();
  setBusinessCalendars(
    await businessCalendarsApp.handlers['business-calendars-get'](),
  );
  const upcomingLength =
    (
      await db.first<{ value: string }>(
        "SELECT value FROM preferences WHERE id = 'upcomingScheduledTransactionLength'",
      )
    )?.value ?? DEFAULT_UPCOMING_SCHEDULE_DAYS;
  const { data: hasTransRows } = (await aqlQuery(
    getHasTransactionsQuery(schedules),
  )) as { data: Pick<TransactionEntity, 'schedule'>[] };
  const hasTrans = new Set(hasTransRows.map(row => row.schedule));
  const statuses: ScheduleStatuses = new Map(
    schedules.map(s => [
      s.id,
      getStatus(
        s.next_date,
        s.completed,
        hasTrans.has(s.id),
        s.custom_upcoming_length ?? upcomingLength,
      ),
    ]),
  );
  const payees = await db.all<{
    id: string;
    name: string;
    transfer_acct: string | null;
  }>('SELECT id, name, transfer_acct FROM payees WHERE tombstone = 0');
  const payee = new Map(payees.map(p => [p.id, p]));
  // A schedule is this account's by its account, or as a transfer into it
  const intoThis = (s: ScheduleEntity) =>
    payee.get(s._payee)?.transfer_acct === account;
  return computeSchedulePreviewTransactions(
    schedules,
    statuses,
    String(upcomingLength),
    s => s._account === account || intoThis(s),
  ).map(t => ({
    id: t.id,
    scheduleId: t.schedule,
    date: t.date,
    payee: payee.get(t.payee)?.name ?? null,
    amount: t.account === account ? t.amount : -t.amount,
  }));
}
