// The human-recorded statement balance (openspec/changes/reconcile-recorded-statement-balance, D1-D2)
import { v4 as uuidv4 } from 'uuid';

import * as db from '#server/db';

export const STATEMENT_BALANCE_PREFIX = 'statement-balance-';

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

/** App only: replaces the account's record with a new, unconsumed one. */
export async function saveStatementBalance({
  account_id,
  amount,
  source,
  as_of,
  entered_by,
}: {
  account_id: string;
  amount: number;
  source: StatementBalanceRecord['source'];
  as_of?: string | null;
  entered_by: string;
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
  if (typeof entered_by !== 'string' || entered_by.length > MAX_ENTERED_BY) {
    throw new Error(`entered_by must be at most ${MAX_ENTERED_BY} characters.`);
  }
  const record: StatementBalanceRecord = {
    id: uuidv4(),
    amount,
    source,
    as_of: as_of ?? null,
    entered_at: Date.now(),
    entered_by,
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
