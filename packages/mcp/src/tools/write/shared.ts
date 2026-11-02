import { randomUUID } from 'crypto';

import * as api from '@actual-app/api';
import { z } from 'zod';

import { appendAudit } from '#audit';
import type { AuditChange, Identity } from '#audit';
import { Refusal } from '#refusal';

const MAX_AMOUNT = 1e12;

/** Refuses (fixed text, before any audit line) an amount that is not a sane integer of cents. */
export function requireAmount(amount: number) {
  if (!Number.isSafeInteger(amount) || Math.abs(amount) > MAX_AMOUNT) {
    throw new Refusal(
      'amount must be an integer number of cents between -1000000000000 and 1000000000000. Nothing changed.',
    );
  }
}

/** Refuses a date that is not a real date from 1970-01-01 to 2100-12-31. */
export function requireDate(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const [y, mo, d] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  const real = new Date(Date.UTC(y, mo - 1, d));
  if (
    !m ||
    y < 1970 ||
    y > 2100 ||
    real.getUTCMonth() !== mo - 1 ||
    real.getUTCDate() !== d
  ) {
    throw new Refusal(
      'date must be a real date (YYYY-MM-DD) from 1970-01-01 to 2100-12-31. Nothing changed.',
    );
  }
}

/** Refuses a budget month that is not a real month (01 to 12). */
export function requireMonth(value: string) {
  const mo = Number(/^\d{4}-(\d{2})$/.exec(value)?.[1]);
  if (!(mo >= 1 && mo <= 12)) {
    throw new Refusal(
      'month must be a real month (YYYY-MM, 01 to 12). Nothing changed.',
    );
  }
}

/** What a write did: the rows applied, the row that failed, and anything created. */
export type WriteOutcome = {
  applied: string[];
  failed?: string;
  created?: string[];
};

/**
 * Runs one write with its audit lines. The attempt line is appended first (a
 * failed append stops the write); the outcome line, with the same call id, is
 * appended after. If only the outcome append fails, the change stands and the
 * result says `audit_outcome: 'not-logged'`, because refusing after the fact
 * would hide a change that happened. If the write throws, a `failed` outcome
 * line is appended (best effort) and the error rethrown.
 */
export type WriteLog = {
  /** The audit log file. */
  path: string;
  /** Removes secrets from an error before it goes to stderr. */
  scrub: (message: string) => string;
  /** Who acts; written on every line. */
  identity: Identity;
};

/** One scrubbed stderr line; the model never sees it and the audit log never holds it. */
export function stderrLine(log: WriteLog, what: string, error: unknown) {
  const detail = error instanceof Error ? error.message : JSON.stringify(error);
  process.stderr.write(`${what}: ${log.scrub(detail)}\n`);
}

/** Sent when the write was applied but its result could not be read back. */
const READ_BACK_FAILED =
  'The write was applied, but its details could not be read back. Do not retry it; check the budget.';

export async function loggedWrite<R extends object>(
  log: WriteLog,
  tool: string,
  entry: { ids: string[]; changes: AuditChange[] },
  write: (callId: string) => Promise<WriteOutcome>,
  result: (outcome: WriteOutcome) => Promise<R>,
): Promise<
  (R | { applied: string[]; read_back: string }) & {
    audit_outcome?: 'not-logged';
  }
> {
  const call_id = randomUUID();
  appendAudit(
    log.path,
    { tool, call_id, phase: 'attempt', ...entry },
    log.identity,
  );

  const outcomeLine = (o: WriteOutcome, status: 'ok' | 'failed') =>
    appendAudit(
      log.path,
      {
        tool,
        call_id,
        phase: 'outcome',
        status,
        applied: o.applied,
        failed: o.failed ?? null,
        created: o.created ?? [],
      },
      log.identity,
    );

  let outcome: WriteOutcome;
  try {
    outcome = await write(call_id);
  } catch (error) {
    try {
      outcomeLine({ applied: [] }, 'failed');
    } catch {
      // The write's own error is the one to report.
    }
    throw error;
  }
  let logged = true;
  try {
    outcomeLine(outcome, outcome.failed ? 'failed' : 'ok');
  } catch {
    logged = false;
  }
  // A read-back that fails after the write must never look like a failed
  // call: the model may retry (a second skip would skip two pay dates).
  let out: R | { applied: string[]; read_back: string };
  try {
    out = await result(outcome);
  } catch (error) {
    stderrLine(log, `${tool} result read-back failed (call ${call_id})`, error);
    out = { applied: outcome.applied, read_back: READ_BACK_FAILED };
  }
  return logged ? out : { ...out, audit_outcome: 'not-logged' as const };
}

/** At most this many rows change in one write call. */
export const MAX_WRITE_ROWS = 50;

export const id = z.string().min(1).max(100);
export const notes = z.string().max(1000);

/**
 * Returns `ids` mapped to their rows' `select` fields, refusing (fixed text)
 * when any id is not an existing row: a name is never matched in its place.
 */
export async function requireIds(
  table: 'transactions' | 'accounts' | 'categories' | 'payees',
  ids: string[],
  select: string[] = ['id'],
): Promise<Map<string, Record<string, unknown>>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data } = (await api.runQuery(
    api
      .q(table)
      .filter({ id: { $oneof: unique } })
      .select(['id', ...select]),
  )) as { data: Array<Record<string, unknown>> };
  if (data.length !== unique.length) {
    throw new Refusal(
      `Every ${table} id must be the id of an existing row, never a name.`,
    );
  }
  return new Map(data.map(row => [String(row.id), row]));
}
