// The human-recorded statement balance, as the MCP sees it (openspec/changes/reconcile-recorded-statement-balance, D3-D6)
import * as api from '@actual-app/api';

import type { Limits } from '#limits';
import { Refusal } from '#refusal';

export type StatementBalanceRecord = NonNullable<
  Awaited<ReturnType<typeof api.getAccountStatementBalance>>
>;

export type RecordStatus = 'usable' | 'none' | 'expired' | 'consumed' | 'echo';

const HOUR = 3_600_000;
const MINUTE = 60_000;

/**
 * Whether the tool may use a record. A record dated ahead of this clock by
 * more than the skew allowance is expired, so it can never outlive the expiry.
 */
export function statusOf(
  record: StatementBalanceRecord | null,
  limits: Limits,
  now = Date.now(),
): RecordStatus {
  if (!record) return 'none';
  if (record.consumed_at !== null) return 'consumed';
  if (record.source === 'cleared') return 'echo';
  const age = now - record.entered_at;
  if (
    age > limits.statementMaxAgeHours * HOUR ||
    age < -limits.statementClockSkewMinutes * MINUTE
  ) {
    return 'expired';
  }
  return 'usable';
}

/** The record's facts, with its age; `entered_by` is left out for the caller to carry as text. */
export function recordFacts(record: StatementBalanceRecord, now = Date.now()) {
  return {
    id: record.id,
    amount: record.amount,
    source: record.source,
    as_of: record.as_of,
    entered_at: record.entered_at,
    age_hours: Math.round(((now - record.entered_at) / HOUR) * 100) / 100,
  };
}

const REFUSALS: Record<Exclude<RecordStatus, 'usable'>, string> = {
  none: "No statement balance has been recorded for this account. Ask the user to enter it in the app's Reconcile (then call sync_budget). Nothing changed.",
  expired:
    "The recorded statement balance is older than the allowed age or has an impossible date. Ask the user to enter it again in the app's Reconcile. Nothing changed.",
  consumed:
    "The recorded statement balance was already used for a reconcile. Ask the user to enter it again in the app's Reconcile. Nothing changed.",
  echo: "The recorded statement balance was filled from the cleared balance, so it checks nothing. Ask the user to enter the statement's balance in the app's Reconcile. Nothing changed.",
};

/** Reads the account's record and refuses, with fixed text, unless it is usable. */
export async function requireUsableRecord(accountId: string, limits: Limits) {
  const record = await api.getAccountStatementBalance(accountId);
  const status = statusOf(record, limits);
  if (status !== 'usable' || !record) {
    throw new Refusal(REFUSALS[status === 'usable' ? 'none' : status]);
  }
  return record;
}
