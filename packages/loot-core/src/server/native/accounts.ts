// Fork-only (sc-4386, openspec/changes/native-accounts-screen D1 and D2). The
// native Accounts screen's two batched reads: every number, name and order is
// loot-core's, Swift only shows it. The contract is accounts.test.ts and its
// fixtures.
import { aqlQuery } from '#server/aql';
import { app as businessCalendarsApp } from '#server/business-calendars/app';
import * as db from '#server/db';
import { fromDateRepr, toDateRepr } from '#server/models';
import { getPaychecks } from '#server/paychecks/app';
import { refreshScheduleDateLookup } from '#server/schedules/app';
import { runRules } from '#server/transactions/transaction-rules';
import { setBusinessCalendars } from '#shared/business-calendar-lookup';
import * as monthUtils from '#shared/months';
import { q } from '#shared/query';
import {
  comparePreviewTransactions,
  inverseBasedOnAccount,
  isScheduleRelevantToAccount,
} from '#shared/schedule-preview';
import {
  DEFAULT_UPCOMING_SCHEDULE_DAYS,
  getScheduleOccurrenceMatchStartDate,
  getStatus,
  isForPreview,
  schedulePreview,
  schedulePreviewDates,
} from '#shared/schedules';
import type { ScheduleStatuses } from '#shared/schedules';
import { ungroupTransactions } from '#shared/transactions';
import type {
  AccountEntity,
  ScheduleEntity,
  TransactionEntity,
} from '#types/models';

import { readLimit } from './limits';
import { decimalPlaces } from './reconcile-lock';

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

// sc-4973 (D4, D5, D7, D8): `native/account-upcoming`, read after the
// register's first page
export type NativeAccountUpcoming = {
  upcoming: NativeUpcomingRow[];
  // The returned rows' number and amounts' sum, never rows past the caps
  upcomingCount: number;
  upcomingTotal: number;
  // The day cap, only when it hid a scheduled row
  upcomingCapDays?: number;
  // Only when the row cap stopped with an occurrence left: the occurrences
  // kept; the rest is never generated or counted (D8, D12)
  upcomingKept?: number;
  upcomingMore?: true;
};

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
  categoryId: string | null;
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

// D2: the fields a schedule's rules can set, in this order
const RULE_FIELDS = [
  'payee',
  'category',
  'amount',
  'notes',
  'date',
  'cleared',
  'splits',
] as const;
export type NativeRuleField = (typeof RULE_FIELDS)[number];

// sc-4973 (native-register-upcoming-rows D2): a scheduled row as it will post
// to this account. Id `preview/<schedule>/<date>`, or `preview/` plus the line
// id `<schedule>/<date>/<n>` for a split line inverted into this account.
export type NativeUpcomingRow = {
  id: string;
  scheduleId: string;
  date: string;
  payee: string | null;
  category: string | null;
  categoryId: string | null;
  notes: string | null;
  // Signed for this account
  amount: number;
  cleared: boolean;
  splitCount: number;
  // sc-5224: a split shows its lines' most common payee, as the web does;
  // this counts its lines' other payees (0 unless a split)
  otherPayees: number;
  transferAccount: { id: string; name: string } | null;
  status: 'due' | 'upcoming' | 'missed';
  ruleFields: NativeRuleField[];
};

export type NativeAccountRegister = {
  rows: NativeRegisterRow[];
  nextCursor: string | null;
  // First page only
  header?: { balance: number; cleared: number; uncleared: number };
  // First page, only while a search or a scope other than all is set: how
  // many top-level rows match on every page, and their amounts' sum. A split
  // counts once, at its parent's amount; its children are never counted.
  resultCount?: number;
  resultTotal?: number;
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
  handler = 'native/account-register',
) {
  if (!SCOPES.includes(scope)) {
    throw new Error(
      `${handler}: scope must be all, uncleared or uncategorized`,
    );
  }
  if (
    search !== null &&
    search !== undefined &&
    (typeof search !== 'string' || search.length > MAX_SEARCH)
  ) {
    throw new Error(
      `${handler}: search must be text of at most ${MAX_SEARCH} characters`,
    );
  }
  const text = typeof search === 'string' ? search.trim() : '';
  let sql = '';
  let children: ((payees: string) => string) | null = null;
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
    sql += ` AND (${own.sql('t', 'p', 'c')} OR t.id IN (SELECT t.parent_id FROM `;
    children = (payees: string) => ` t
      LEFT JOIN ${payees} p ON p.id = t.payee
      LEFT JOIN categories c ON c.id = t.category
      WHERE t.is_child = 1 AND t.account = ? AND ${child.sql('t', 'p', 'c')}))`;
    params.push(...own.params, account, ...child.params);
  }
  return {
    // `source` and `payees`: what the child subquery reads, for posted or upcoming rows
    sql: (source: string, payees = 'payees') =>
      children ? sql + source + children(payees) : sql,
    params,
    filtered: scope !== 'all' || text !== '',
  };
}

async function openAccountFor(account_id: unknown, handler: string) {
  const account =
    typeof account_id === 'string'
      ? await db.first<{ id: string }>(
          'SELECT id FROM accounts WHERE id = ? AND tombstone = 0',
          [account_id],
        )
      : null;
  if (!account) throw new Error(`${handler}: no such account`);
  return account;
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
  const account = await openAccountFor(account_id, 'native/account-register');
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
    category_id: string | null;
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
    `SELECT t.id, t.date AS d, ${FLAG} AS sb, ${SORT_ORDER} AS so, p.name AS payee, c.name AS category, c.id AS category_id,
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
     WHERE t.account = ? AND t.is_child = 0${filter.sql(ALIVE)}${after ? ` AND ${AFTER}` : ''}
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
      categoryId: r.category_id ?? null,
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
  const firstPage: NativeAccountRegister = {
    rows,
    nextCursor,
    header: { balance, cleared, uncleared: balance - cleared },
  };
  if (!filter.filtered) return firstPage;
  // The rows' own filter, over the whole set (the search footer)
  const results = await db.first<{ n: number; total: number | null }>(
    `SELECT COUNT(*) AS n, SUM(t.amount) AS total
     FROM ${ALIVE} t
     JOIN accounts a ON a.id = t.account
     LEFT JOIN payees p ON p.id = t.payee
     LEFT JOIN categories c ON c.id = t.category
     LEFT JOIN accounts ta ON ta.id = p.transfer_acct AND ta.tombstone = 0
     WHERE t.account = ? AND t.is_child = 0${filter.sql(ALIVE)}`,
    [account.id, ...filter.params],
  );
  return {
    ...firstPage,
    resultCount: results?.n ?? 0,
    resultTotal: results?.total ?? 0,
  };
}

// What the posted rows' filter reads, for one upcoming row or one of its lines
type UpcomingSql = {
  id: string;
  account: string;
  date: number;
  payee: string | null;
  category: string | null;
  notes: string | null;
  amount: number;
  cleared: number;
  is_parent: number;
  is_child: number;
  parent_id: string | null;
  // sc-5196: a payee name no payee has yet, under the stand-in id in `payee`
  payee_name: string | null;
};
const UPCOMING_COLUMNS = [
  'id',
  'account',
  'date',
  'payee',
  'category',
  'notes',
  'amount',
  'cleared',
  'is_parent',
  'is_child',
  'parent_id',
  'payee_name',
] as const satisfies readonly (keyof UpcomingSql)[];

type Upcoming = { row: NativeUpcomingRow; sql: UpcomingSql[] };

const PREVIEW = 'preview/';

/** The fields whose value after the schedule's rules differs from the preview before them (D2). */
function ruleFieldsOf(
  before: TransactionEntity,
  after: TransactionEntity,
  split: boolean,
): NativeRuleField[] {
  const value = {
    payee: (t: TransactionEntity) => t.payee ?? null,
    category: (t: TransactionEntity) => t.category ?? null,
    amount: (t: TransactionEntity) => t.amount,
    notes: (t: TransactionEntity) => t.notes || null,
    date: (t: TransactionEntity) => t.date,
    cleared: (t: TransactionEntity) => Boolean(t.cleared),
  };
  return RULE_FIELDS.filter(field =>
    field === 'splits' ? split : value[field](before) !== value[field](after),
  );
}

/**
 * The relevant schedules with a transaction in their occurrence window, in one
 * query (D9): the same answer as `getHasTransactionsQuery`'s `$or`, each
 * schedule's latest date compared with its match start date.
 */
export async function schedulesWithTransactions(
  schedules: readonly ScheduleEntity[],
): Promise<Set<string>> {
  if (schedules.length === 0) return new Set();
  const latest = new Map(
    (
      await db.all<{ schedule: string; last: number }>(
        `SELECT schedule, MAX(date) AS last FROM ${ALIVE}
         WHERE schedule IN (SELECT value FROM json_each(?)) GROUP BY schedule`,
        [JSON.stringify(schedules.map(s => s.id))],
      )
    ).map(r => [r.schedule, r.last]),
  );
  return new Set(
    schedules
      .filter(s => {
        const last = latest.get(s.id);
        return (
          last != null &&
          s.next_date != null &&
          last >=
            toDateRepr(getScheduleOccurrenceMatchStartDate(s, s.next_date))
        );
      })
      .map(s => s.id),
  );
}

/**
 * Previews drawn from each schedule's lazy dates in rounds (D8, D12): every
 * schedule's next occurrence, then every schedule's second. Within a round
 * the nearest date goes first, so a cut round keeps the nearest. A date past
 * the day cap ends its schedule's dates. Stops at `max`, with `more` when an
 * occurrence was left; the rest is never generated or counted.
 */
function takeInRounds(
  schedules: readonly ScheduleEntity[],
  statuses: ScheduleStatuses,
  upcomingLength: string,
  last: string,
  max: number,
) {
  let capped = false;
  const live = schedules.map(schedule => {
    const dates = schedulePreviewDates(
      schedule,
      statuses.get(schedule.id),
      upcomingLength,
    );
    return { schedule, dates, next: dates.next() };
  });
  const round = () =>
    live.filter(g => {
      if (g.next.done) return false;
      if (g.next.value > last) {
        capped = true;
        return false;
      }
      return true;
    });
  const kept: TransactionEntity[] = [];
  for (let taking = round(); taking.length > 0; taking = round()) {
    const previews = taking
      .map(g => ({
        g,
        preview: {
          ...schedulePreview(
            g.schedule,
            statuses.get(g.schedule.id),
            g.next.value,
          ),
          sort_order: g.schedule.sort_order,
        },
      }))
      .sort(
        (a, b) =>
          a.preview.date.localeCompare(b.preview.date) ||
          comparePreviewTransactions(a.preview, b.preview),
      );
    for (const { g, preview } of previews) {
      if (kept.length === max) return { kept, more: true, capped };
      kept.push(preview);
      g.next = g.dates.next();
    }
  }
  return { kept, more: false, capped };
}

/**
 * The account's scheduled rows as they will post, by the web preview's own
 * steps: relevance, the schedule's rules, sort and per-line inversion (D1,
 * D2), inside the day cap (D5) and the row cap (D8), both before rules run.
 */
async function upcomingRows(account: string) {
  const { data: allSchedules } = (await aqlQuery(
    q('schedules').select('*'),
  )) as { data: ScheduleEntity[] };
  const payees = await db.all<{
    id: string;
    name: string;
    transfer_acct: string | null;
  }>('SELECT id, name, transfer_acct FROM payees WHERE tombstone = 0');
  const payeeById = new Map(payees.map(p => [p.id, p]));
  const payeeByAccount = new Map(payees.map(p => [p.transfer_acct, p]));
  const accounts = new Map((await db.getAccounts()).map(a => [a.id, a]));
  const transferAccountOf = (payee?: string | null) => {
    const id = payee ? payeeById.get(payee)?.transfer_acct : null;
    return (id && accounts.get(id)) || null;
  };
  // The shared functions read only the account's id and the payee's id
  const getTransferAccountByPayee = (payee?: string | null) =>
    transferAccountOf(payee) as unknown as AccountEntity | null;
  const getPayeeByTransferAccount = (id?: string | null) => {
    const payee = payeeByAccount.get(id ?? null);
    return payee ? { id: payee.id, name: payee.name } : null;
  };

  // Relevance needs no status, so statuses cover only these (D9)
  const schedules = allSchedules.filter(schedule =>
    isScheduleRelevantToAccount({
      accountId: account,
      schedule,
      getTransferAccountByPayee,
    }),
  );
  if (schedules.length === 0) return { rows: [], capDays: null, kept: null };
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
  const hasTrans = await schedulesWithTransactions(schedules);
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
  const sortOrder = new Map(schedules.map(s => [s.id, s.sort_order]));
  const capDays = await readLimit('accounts-register-upcoming-max-days');
  const { kept, more, capped } = takeInRounds(
    schedules.filter(s => isForPreview(s, statuses)),
    statuses,
    String(upcomingLength),
    monthUtils.addDays(monthUtils.currentDay(), capDays),
    await readLimit('accounts-upcoming-max-rows'),
  );

  const categories = new Map(
    (
      await db.all<{ id: string; name: string }>(
        'SELECT id, name FROM categories WHERE tombstone = 0',
      )
    ).map(c => [c.id, c.name]),
  );
  const status = new Map<string, NativeUpcomingRow['status']>();
  const ruleFields = new Map<string, NativeRuleField[]>();
  const ran: TransactionEntity[] = [];
  for (const preview of kept) {
    // A read writes nothing: a payee name no payee has yet stays a name
    const after: TransactionEntity = await runRules(preview, accounts, {
      resolvePayeeNames: false,
    });
    const scheduleStatus = preview.forceUpcoming
      ? 'upcoming'
      : statuses.get(preview.schedule ?? '');
    const rowStatus =
      scheduleStatus === 'due' || scheduleStatus === 'missed'
        ? scheduleStatus
        : 'upcoming';
    // Stable line ids: the rules make random ones
    const lines = after.subtransactions?.map((line, i) => ({
      ...line,
      id: `${preview.id.slice(PREVIEW.length)}/${i + 1}`,
      parent_id: after.id,
      schedule: after.schedule,
    }));
    for (const t of [after, ...(lines ?? [])]) {
      status.set(t.id, rowStatus);
      // A split's payee is the one it shows, its lines' (sc-5224)
      const shown =
        t === after && lines?.length
          ? { ...t, payee: splitPayee(lines).top?.payee ?? null }
          : t;
      ruleFields.set(
        t.id,
        ruleFieldsOf(preview, shown, t === after && Boolean(lines?.length)),
      );
    }
    ran.push({
      ...after,
      sort_order: sortOrder.get(preview.schedule ?? ''),
      subtransactions: lines,
    });
  }
  ran.sort(comparePreviewTransactions);
  const { transactions } = inverseBasedOnAccount({
    accountId: account,
    transactions: ungroupTransactions(ran),
    runningBalances: new Map(),
    startingBalance: 0,
    getPayeeByTransferAccount,
    getTransferAccountByPayee,
  });

  const linesOf = new Map<string, TransactionEntity[]>();
  for (const t of transactions) {
    if (t.parent_id) {
      linesOf.set(t.parent_id, [...(linesOf.get(t.parent_id) ?? []), t]);
    }
  }
  const sqlOf = (
    t: TransactionEntity,
    id: string,
    category: string | null,
    over: Partial<UpcomingSql>,
  ): UpcomingSql => ({
    id,
    account,
    date: toDateRepr(t.date),
    // A rule-named payee that does not exist yet (the read creates none) is
    // searched by its name through a stand-in payee row (sc-5196)
    payee: t.payee === 'new' ? `new:${id}` : t.payee || null,
    category,
    notes: t.notes || null,
    amount: t.amount,
    cleared: t.cleared ? 1 : 0,
    is_parent: 0,
    is_child: 0,
    parent_id: null,
    payee_name:
      t.payee === 'new'
        ? ((t as { payee_name?: string }).payee_name ?? null)
        : null,
    ...over,
  });
  const rows = transactions
    .filter(t => !t.parent_id)
    .map((t): Upcoming => {
      const inverted = 'inversed' in t && t.inversed === true;
      // An inverted line keeps its line's id
      const id = t.id.startsWith(PREVIEW) ? t.id : PREVIEW + t.id;
      // The account's side of a transfer has no category
      const categoryId = inverted ? null : (t.category ?? null);
      const transfer = transferAccountOf(t.payee);
      const lines = linesOf.get(t.id) ?? [];
      const split = lines.length > 0 ? splitPayee(lines) : null;
      // A transfer payee reads as its account, as the web shows it
      const nameOf = (row: TransactionEntity) =>
        (row.payee === 'new'
          ? (row as { payee_name?: string }).payee_name
          : (transferAccountOf(row.payee)?.name ??
            (row.payee && payeeById.get(row.payee)?.name))) || null;
      return {
        row: {
          id,
          scheduleId: t.schedule ?? '',
          date: t.date,
          payee: split ? split.top && nameOf(split.top) : nameOf(t),
          category: (categoryId && categories.get(categoryId)) || null,
          categoryId,
          notes: t.notes || null,
          amount: t.amount,
          cleared: Boolean(t.cleared),
          splitCount: lines.length,
          otherPayees: split?.others ?? 0,
          transferAccount: transfer
            ? { id: transfer.id, name: transfer.name }
            : null,
          status: status.get(t.id) ?? 'upcoming',
          ruleFields: ruleFields.get(t.id) ?? [],
        },
        sql: [
          sqlOf(t, id, categoryId, { is_parent: lines.length > 0 ? 1 : 0 }),
          ...lines.map(line =>
            sqlOf(line, line.id, line.category ?? null, {
              is_child: 1,
              parent_id: id,
            }),
          ),
        ],
      };
    });
  return {
    rows,
    capDays: capped ? capDays : null,
    kept: more ? kept.length : null,
  };
}

/**
 * The payee the web shows for a split (useDisplayPayee): its lines' most
 * common payee, the first line to reach the top count winning a tie, and the
 * number of its lines' other payees (sc-5224). A name no payee has yet counts
 * by that name.
 */
function splitPayee(lines: readonly TransactionEntity[]) {
  const keyOf = (line: TransactionEntity) =>
    line.payee === 'new'
      ? `new:${(line as { payee_name?: string }).payee_name ?? ''}`
      : line.payee;
  const counts = new Map<string, number>();
  let top: TransactionEntity | null = null;
  let max = 0;
  for (const line of lines) {
    const key = keyOf(line);
    if (!key) continue;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    if (count > max) [max, top] = [count, line];
  }
  return { top, others: top ? counts.size - 1 : 0 };
}

/**
 * The upcoming rows the posted rows' own filter matches (D3): the rows go to
 * SQLite as one JSON parameter, so no row count reaches the variable limit,
 * and nothing is written.
 */
async function filterUpcoming(
  rows: Upcoming[],
  filter: Awaited<ReturnType<typeof registerFilter>>,
): Promise<NativeUpcomingRow[]> {
  if (rows.length === 0) return [];
  const columns = UPCOMING_COLUMNS.map(
    c => `json_extract(value, '$.${c}') AS ${c}`,
  ).join(', ');
  const matched = await db.all<{ id: string }>(
    `WITH upcoming AS MATERIALIZED (SELECT ${columns} FROM json_each(?)),
     -- The payees, plus a stand-in for each name no payee has yet: the same
     -- predicate then matches the name the row shows
     upcoming_payees AS (
       SELECT id, name, transfer_acct FROM payees
       UNION ALL
       SELECT payee, payee_name, NULL FROM upcoming WHERE payee_name IS NOT NULL)
     SELECT t.id
     FROM upcoming t
     JOIN accounts a ON a.id = t.account
     LEFT JOIN upcoming_payees p ON p.id = t.payee
     LEFT JOIN categories c ON c.id = t.category
     LEFT JOIN accounts ta ON ta.id = p.transfer_acct AND ta.tombstone = 0
     WHERE t.is_child = 0${filter.sql('upcoming', 'upcoming_payees')}`,
    [JSON.stringify(rows.flatMap(r => r.sql)), ...filter.params],
  );
  const ids = new Set(matched.map(r => r.id));
  return rows.filter(r => ids.has(r.row.id)).map(r => r.row);
}

/** `native/account-upcoming` (D7): the upcoming section, read after the register's first page. */
export async function accountUpcoming({
  account_id,
  scope,
  search,
}: {
  account_id: string;
  scope: NativeRegisterScope;
  search?: string | null;
}): Promise<NativeAccountUpcoming> {
  const handler = 'native/account-upcoming';
  const account = await openAccountFor(account_id, handler);
  const filter = await registerFilter(account.id, scope, search, handler);
  const scheduled = await upcomingRows(account.id);
  const upcoming = filter.filtered
    ? await filterUpcoming(scheduled.rows, filter)
    : scheduled.rows.map(r => r.row);
  return {
    upcoming,
    upcomingCount: upcoming.length,
    upcomingTotal: upcoming.reduce((sum, r) => sum + r.amount, 0),
    ...(scheduled.capDays !== null && { upcomingCapDays: scheduled.capDays }),
    ...(scheduled.kept !== null && {
      upcomingKept: scheduled.kept,
      upcomingMore: true,
    }),
  };
}
