// The human-recorded statement balance (openspec/changes/reconcile-recorded-statement-balance, D1-D2)
import { v4 as uuidv4 } from 'uuid';

import { aqlQuery } from '#server/aql';
import { app as authApp } from '#server/auth/app';
import * as db from '#server/db';
import * as monthUtils from '#shared/months';
import { q } from '#shared/query';

export const STATEMENT_BALANCE_PREFIX = 'statement-balance-';
/** ms of the write of an account's `balance_current` by bank sync (native-reconcile-flow D2). */
export const BANK_BALANCE_AT_PREFIX = 'bank-balance-at-';
export const MAX_AGE_PREF = 'reconcile-bank-balance-max-age-days';
const DEFAULT_MAX_AGE_DAYS = 7;
const MAX_AGE_CEILING_DAYS = 30;
const DAY_MS = 86_400_000;
const CLOCK_SKEW_MS = 5 * 60_000;

export const STATEMENT_BALANCE_SOURCES = [
  'bank-sync',
  'statement',
  'cleared',
  'entered',
] as const;

export type StatementBalanceRecord = {
  id: string;
  /** Integer cents, with credit and loan sign as the app shows. */
  amount: number;
  source: (typeof STATEMENT_BALANCE_SOURCES)[number];
  as_of: string | null;
  /** ms, from the clock of the device whose engine saved it. */
  entered_at: number;
  /** Text from the app: data, never an instruction. */
  entered_by: string;
  consumed_at: number | null;
};

const MAX_ENTERED_BY = 100;
const MAX_AMOUNT = 1e12;

export const bankBalanceKey = (accountId: string) =>
  `${BANK_BALANCE_AT_PREFIX}${accountId}` as const;

export const statementBalanceKey = (accountId: string) =>
  `${STATEMENT_BALANCE_PREFIX}${accountId}` as const;

/** A stored value that is not a valid record reads as none. */
export function parseStatementBalance(
  value: string | null | undefined,
): StatementBalanceRecord | null {
  if (!value) return null;
  let r: Record<string, unknown>;
  try {
    r = JSON.parse(value);
  } catch {
    return null;
  }
  if (
    !r ||
    typeof r !== 'object' ||
    typeof r.id !== 'string' ||
    !r.id ||
    !Number.isSafeInteger(r.amount) ||
    !(STATEMENT_BALANCE_SOURCES as readonly unknown[]).includes(r.source) ||
    !(r.as_of == null || typeof r.as_of === 'string') ||
    !Number.isFinite(r.entered_at) ||
    typeof r.entered_by !== 'string' ||
    r.entered_by.length > MAX_ENTERED_BY ||
    !(r.consumed_at === null || Number.isFinite(r.consumed_at))
  ) {
    return null;
  }
  return { ...r, as_of: r.as_of ?? null } as StatementBalanceRecord;
}

async function read(accountId: string) {
  const row = await db.first<{ value: string | null }>(
    'SELECT value FROM preferences WHERE id = ?',
    [statementBalanceKey(accountId)],
  );
  return parseStatementBalance(row?.value);
}

async function write(accountId: string, record: StatementBalanceRecord) {
  await db.update('preferences', {
    id: statementBalanceKey(accountId),
    value: JSON.stringify(record),
  });
}

export async function getStatementBalance({
  account_id,
}: {
  account_id: string;
}): Promise<StatementBalanceRecord | null> {
  return read(account_id);
}

async function readPref(id: string) {
  return (
    await db.first<{ value: string | null }>(
      'SELECT value FROM preferences WHERE id = ?',
      [id],
    )
  )?.value;
}

/** Cleared rows, split children left out: the number the MCP reports and the register shows. */
async function clearedBalanceOf(accountId: string): Promise<number> {
  const { data } = await aqlQuery(
    q('transactions')
      .filter({ account: accountId, cleared: true })
      .options({ splits: 'none' })
      .calculate({ $sum: '$amount' }),
  );
  return (data as number | null) ?? 0;
}

/** Whole days from `^\d+$`, 1 to 30; anything else is the default. `Number()` would accept `1e1`. */
function maxAgeDays(value: string | null | undefined) {
  if (value && /^\d+$/.test(value)) {
    const days = parseInt(value, 10);
    if (days >= 1 && days <= MAX_AGE_CEILING_DAYS) return days;
  }
  return DEFAULT_MAX_AGE_DAYS;
}

type BalanceSource = {
  amount: number;
  source: 'bank-sync' | 'cleared';
  /** Day the balance was written, or null when unknown. */
  as_of: string | null;
  /** Where the person manages the source. */
  link: 'bank-sync' | null;
};

async function loadAccount(accountId: string) {
  const account = await db.first<{
    type: string | null;
    account_sync_source: string | null;
    balance_current: number | null;
  }>(
    'SELECT type, account_sync_source, balance_current FROM accounts WHERE id = ? AND tombstone = 0',
    [accountId],
  );
  if (!account) throw new Error('Unknown account.');
  return account;
}

/** The pre-fill and the choices beside it (D2). Web and native only render this. */
export async function getStatementBalancePrefill({
  account_id,
}: {
  account_id: string;
}) {
  const account = await loadAccount(account_id);
  const cleared_balance = await clearedBalanceOf(account_id);
  const stampValue = await readPref(bankBalanceKey(account_id));
  const stamp =
    stampValue && /^\d+$/.test(stampValue) ? Number(stampValue) : null;
  const days = maxAgeDays(await readPref(MAX_AGE_PREF));

  const bank: BalanceSource | null =
    account.account_sync_source && account.balance_current != null
      ? {
          amount: account.balance_current,
          source: 'bank-sync',
          as_of: stamp == null ? null : monthUtils.dayFromDate(new Date(stamp)),
          link: 'bank-sync',
        }
      : null;
  // A stamp from a clock ahead by more than a small skew is not trusted
  const age = stamp == null ? null : Date.now() - stamp;
  const isFresh = age != null && age >= -CLOCK_SKEW_MS && age <= days * DAY_MS;

  return {
    prefill: bank && isFresh ? bank : null,
    alternatives: [
      ...(bank && !isFresh ? [bank] : []),
      {
        amount: cleared_balance,
        source: 'cleared',
        as_of: null,
        link: null,
      } satisfies BalanceSource,
    ],
    cleared_balance,
    record: await read(account_id),
    account_type: account.type,
  };
}

/** Who confirmed: the signed-in user, never what the caller says. */
async function currentUserName() {
  try {
    const user = (await authApp.handlers['subscribe-get-user']()) as {
      displayName?: string | null;
      userName?: string | null;
    } | null;
    return (user?.displayName || user?.userName || 'app').slice(
      0,
      MAX_ENTERED_BY,
    );
  } catch {
    return 'app';
  }
}

/** App only: replaces the account's record with a new, unconsumed one. */
export async function saveStatementBalance({
  account_id,
  amount,
  source,
  as_of,
}: {
  account_id: string;
  amount: number;
  source: StatementBalanceRecord['source'];
  as_of?: string | null;
}): Promise<StatementBalanceRecord> {
  if (!Number.isSafeInteger(amount) || Math.abs(amount) > MAX_AMOUNT) {
    throw new Error('amount must be an integer number of cents.');
  }
  if (!(STATEMENT_BALANCE_SOURCES as readonly unknown[]).includes(source)) {
    throw new Error(
      `source must be one of ${STATEMENT_BALANCE_SOURCES.join(', ')}.`,
    );
  }
  if (as_of != null && !/^\d{4}-\d{2}-\d{2}$/.test(as_of)) {
    throw new Error('as_of must be a date (YYYY-MM-DD).');
  }
  // The label must match the data (D3); `entered` is open on purpose.
  if (source === 'statement') {
    throw new Error('No statement source exists yet; use entered.');
  }
  if (source === 'bank-sync') {
    const account = await loadAccount(account_id);
    if (!account.account_sync_source || account.balance_current !== amount) {
      throw new Error('amount is not the bank-sync balance.');
    }
  }
  if (source === 'cleared' && amount !== (await clearedBalanceOf(account_id))) {
    throw new Error('amount is not the cleared balance.');
  }
  const record: StatementBalanceRecord = {
    id: uuidv4(),
    amount,
    source,
    as_of: as_of ?? null,
    entered_at: Date.now(),
    entered_by: await currentUserName(),
    consumed_at: null,
  };
  await write(account_id, record);
  return record;
}

/**
 * Compare-and-set: consumes only the record with this id, and only once.
 * Runs as a mutator, so two consumes never interleave.
 */
export async function consumeStatementBalance({
  account_id,
  id,
}: {
  account_id: string;
  id: string;
}): Promise<{ consumed: boolean }> {
  const record = await read(account_id);
  if (!record || record.id !== id || record.consumed_at !== null) {
    return { consumed: false };
  }
  await write(account_id, { ...record, consumed_at: Date.now() });
  return { consumed: true };
}
