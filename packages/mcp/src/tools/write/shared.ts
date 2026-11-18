import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';

import * as api from '@actual-app/api';
import { z } from 'zod';

import { appendAudit } from '#audit';
import type { AuditChange, AuditIdentity } from '#audit';
import type { Grant, Scope } from '#grants';
import { cellLimit, deleteLimit, reconcileLimit, rowLimit } from '#limits';
import type { Limits } from '#limits';
import { Refusal } from '#refusal';
import { withText } from '#sanitize';

import { UNDOABLE } from './declarations';

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

/** The loaded budget's sync id (its local id when it was never synced); every schema 2 audit line carries it. */
export async function budgetId() {
  const prefs = (await api.internal?.send('load-prefs')) as
    | { groupId?: string; id?: string }
    | undefined;
  const found = prefs?.groupId ?? prefs?.id;
  if (!found) {
    throw new Refusal('The loaded budget has no id. Nothing changed.');
  }
  return found;
}

/** The fields every attempt line gains when written (time, call id, phase, schema), so a size check counts the real line. */
const LINE_FIELDS = () => ({
  time: new Date().toISOString(),
  call_id: randomUUID(),
  phase: 'attempt',
  schema: 2,
});

/**
 * Refuses (fixed text, before any audit line) an undoable write whose own
 * attempt line or whose undo's attempt line would exceed the audit line
 * limit, so every undoable write that runs can be undone (design D5). The
 * undo's line holds the same values with before and after swapped, plus
 * `undoes` and its own tool name; a created row (`new...`) is named by an id
 * of its own, and a budget cell by `category:month`.
 */
async function requireUndoableLine(
  log: WriteLog,
  tool: string,
  entry: { ids: string[]; changes: AuditChange[] },
) {
  const budget_id = await budgetId();
  const changes = entry.changes.map(c =>
    c.id.startsWith('new') ? { ...c, id: randomUUID() } : c,
  );
  const size = (line: object) =>
    Buffer.byteLength(JSON.stringify({ ...LINE_FIELDS(), ...line }));
  const own = size({ ...log.identity, tool, budget_id, ...entry });
  const undo = size({
    ...log.identity,
    tool: 'write_undo',
    budget_id,
    // The undo logs every id it restores, which can include rows beyond the write's own ids
    ids: [
      ...new Set([
        ...entry.ids,
        ...changes.map(c => c.id),
        ...changes.flatMap(c => {
          const month = /^budgeted:(\d{4}-\d{2})$/.exec(c.field)?.[1];
          return month ? [`${c.id}:${month}`] : [];
        }),
      ]),
    ],
    changes: changes.map(c => ({
      ...c,
      before: c.after,
      after: c.before,
    })),
    undoes: randomUUID(),
  });
  const cap = log.limits.maxAuditLineBytes;
  if (own > cap || undo > cap) {
    throw new Refusal(
      `This write or its undo would make an audit line of ${Math.max(own, undo)} bytes, above the limit of ${cap}; an undoable write must stay undoable. Nothing changed. Split it into smaller calls.`,
    );
  }
}

/** What a write did: the rows applied, the row that failed, and anything created. */
export type WriteOutcome = {
  /** null: the write failed and its state could not be read back. */
  applied: string[] | null;
  failed?: string;
  created?: string[];
  /** Transfer partners still at their old values after a failed write. */
  partners_not_updated?: string[];
  /** `failed` when a failed write's state could not be read back. */
  read_back?: 'failed';
  /** Extra non-secret fields for the outcome line. */
  detail?: Record<string, unknown>;
};

/** The scopes a tool needs, and whether it deletes, closes or merges. */
export type Access = {
  scopes: Scope[];
  destructive?: boolean;
  /** Refuse any input key the tool does not define (the default strips it). */
  strict?: boolean;
};

/** Registers one write tool; the server's wrapper checks `access` against the grant before `fn` runs. */
export type RegisterWriteTool = <S extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: S,
  fn: (args: z.infer<z.ZodObject<S>>, log: WriteLog) => Promise<unknown>,
  access: Access,
) => void;

/** One call's write context, built by the server's wrapper. */
export type WriteLog = {
  /** The audit log file. */
  path: string;
  /** Removes secrets from an error before it goes to stderr. */
  scrub: (message: string) => string;
  /** Who acts, with the effective scopes; written on every line. */
  identity: AuditIdentity;
  /** The connection's effective grant for this call. */
  grant: Grant;
  /** The server's write limits; a grant replaces them per connection. */
  limits: Limits;
  /** The OAuth client id (`local` on stdio); a `confirm` is bound to it. */
  client: string;
  /** The call's arguments, which a `confirm` covers. */
  args: Record<string, unknown>;
  /** The tool deletes, so `confirm_destructive` applies. */
  destructive: boolean;
};

/** One scrubbed stderr line; the model never sees it and the audit log never holds it. */
export function stderrLine(log: WriteLog, what: string, error: unknown) {
  const detail = error instanceof Error ? error.message : JSON.stringify(error);
  process.stderr.write(`${what}: ${log.scrub(detail)}\n`);
}

/** Sent when the write was applied but its result could not be read back. */
const READ_BACK_FAILED =
  'The write was applied, but its details could not be read back. Do not retry it; check the budget.';

const CONFIRM_LIFETIME_MS = 5 * 60_000;
// Per process: a restart invalidates outstanding dry runs, which is fine.
const CONFIRM_KEY = randomBytes(32);
const CONFIRM_REFUSED =
  'The budget changed since the dry run, the call differs, or the confirm expired. Nothing changed.';

/** JSON with object keys sorted, so equal values give equal text. */
function canonical(value: unknown) {
  return JSON.stringify(value, (_, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : v,
  );
}

function confirmMac(
  issued: string,
  log: WriteLog,
  tool: string,
  entry: unknown,
) {
  const { confirm: _, ...args } = log.args;
  return createHmac('sha256', CONFIRM_KEY)
    .update(
      canonical([issued, log.identity.subject, log.client, tool, args, entry]),
    )
    .digest('hex');
}

/** Refuses a `confirm` that is malformed, expired, or for another caller, call or budget state. */
function checkConfirm(
  given: string,
  log: WriteLog,
  tool: string,
  entry: unknown,
) {
  const [issued = '', mac = ''] = given.split('.');
  const age = Date.now() - Number(issued);
  const expected = Buffer.from(confirmMac(issued, log, tool, entry));
  const actual = Buffer.from(mac);
  if (
    !(age >= 0 && age <= CONFIRM_LIFETIME_MS) ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  ) {
    throw new Refusal(CONFIRM_REFUSED);
  }
}

/**
 * Runs one write with its audit lines. The attempt line is appended first (a
 * failed append stops the write); the outcome line, with the same call id, is
 * appended after. If only the outcome append fails, the change stands and the
 * result says `audit_outcome: 'not-logged'`, because refusing after the fact
 * would hide a change that happened. If the write throws, a `failed` outcome
 * line is appended (best effort) and the error rethrown.
 *
 * A destructive tool under `confirm_destructive` first returns a dry run (the
 * ids and changes it would log, plus a `confirm` bound to the caller, the call
 * and those changes for 5 minutes) and writes only when called with it.
 */
export async function loggedWrite<R extends object>(
  log: WriteLog,
  tool: string,
  entry: { ids: string[]; changes: AuditChange[] } & Record<string, unknown>,
  write: (callId: string) => Promise<WriteOutcome>,
  result: (outcome: WriteOutcome) => Promise<R>,
  /** `destructive` is per call (an undo deletes only when it reverses a create); `undoes` marks an undo's lines. */
  options: {
    destructive?: boolean;
    undoes?: string;
    /** Extra text fields for a dry run only (names beside ids); not bound by the confirm. */
    preview?: Record<string, unknown>;
    /** Always answer the first call with a dry run, whatever `confirm_destructive` says. */
    alwaysConfirm?: boolean;
    /** Plain fields for a dry run only (the facts the call was built from); not bound by the confirm, which covers the entry. */
    dryRun?: Record<string, unknown>;
  } = {},
): Promise<
  | ((R | { applied: string[] | null; read_back: string }) & {
      audit_outcome?: 'not-logged';
      write_id: string;
    })
  | { dry_run: true; ids: string[]; confirm: string }
> {
  // One write may not fill the audit tail an undo reads (it would evict the
  // undo history and its own line); refused before anything is written.
  if (tool in UNDOABLE) await requireUndoableLine(log, tool, entry);
  const budget_id = await budgetId();
  const lineBytes = Buffer.byteLength(
    JSON.stringify({
      ...LINE_FIELDS(),
      ...log.identity,
      tool,
      budget_id,
      ...entry,
      ...(options.undoes ? { undoes: options.undoes } : {}),
    }),
  );
  if (lineBytes > log.limits.maxAuditLineBytes) {
    throw new Refusal(
      `This write would make an audit line of ${lineBytes} bytes, above the limit of ${log.limits.maxAuditLineBytes}. Nothing changed. Split it into smaller calls.`,
    );
  }
  const destructive = options.destructive ?? log.destructive;
  const undoes = options.undoes ? { undoes: options.undoes } : {};
  if (options.alwaysConfirm || (destructive && log.grant.confirm_destructive)) {
    const given = log.args.confirm;
    if (typeof given !== 'string') {
      const issued = String(Date.now());
      return withText(
        {
          dry_run: true as const,
          ...options.dryRun,
          ids: entry.ids,
          confirm: `${issued}.${confirmMac(issued, log, tool, entry)}`,
        },
        { changes: entry.changes, ...options.preview },
      );
    }
    checkConfirm(given, log, tool, entry);
  }

  const call_id = randomUUID();
  appendAudit(
    log.path,
    {
      tool,
      call_id,
      phase: 'attempt',
      schema: 2,
      budget_id,
      ...entry,
      ...undoes,
    },
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
        ...(o.partners_not_updated
          ? { partners_not_updated: o.partners_not_updated }
          : {}),
        ...(o.read_back ? { read_back: o.read_back } : {}),
        ...(o.detail ?? {}),
        ...undoes,
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
  let out: R | { applied: string[] | null; read_back: string };
  try {
    out = await result(outcome);
  } catch (error) {
    stderrLine(log, `${tool} result read-back failed (call ${call_id})`, error);
    out = { applied: outcome.applied, read_back: READ_BACK_FAILED };
  }
  const named = { ...out, write_id: call_id };
  return logged ? named : { ...named, audit_outcome: 'not-logged' as const };
}

/** Whether `loggedWrite` will answer this call with a dry run and a `confirm` instead of writing. */
export function isDryRun(
  log: WriteLog,
  destructive = log.destructive,
  alwaysConfirm = false,
) {
  return (
    (alwaysConfirm || (destructive && log.grant.confirm_destructive)) &&
    typeof log.args.confirm !== 'string'
  );
}

/** Refuses (fixed text, before any audit line) more rows than this connection's row limit. */
export function requireRows(log: WriteLog, rows: number) {
  const cap = rowLimit(log.grant, log.limits);
  if (rows > cap) {
    throw new Refusal(
      `At most ${cap} rows may change in one call on this connection. Nothing changed.`,
    );
  }
}

/** Refuses (fixed text, before any audit line) more rows than this connection's reconcile limit; `max_rows` neither limits nor widens it. */
export function requireReconcileRows(log: WriteLog, rows: number) {
  const cap = reconcileLimit(log.grant, log.limits);
  if (rows > cap) {
    throw new Refusal(
      `A reconcile may lock at most ${cap} rows (split children included) on this connection; this one would lock ${rows}. Nothing changed.`,
    );
  }
}

/** Refuses more budget cells (category and month) than this connection's cell limit. */
export function requireCells(log: WriteLog, cells: number) {
  const cap = cellLimit(log.grant, log.limits);
  if (cells > cap) {
    throw new Refusal(
      `At most ${cap} budget cells may change in one call on this connection; this call would change ${cells}. Nothing changed.`,
    );
  }
}

/**
 * Refuses more rows than this connection's delete limit, for a delete, an
 * account close and the undo of a create (which deletes). Raising the row or
 * cell limit never raises it.
 */
export function requireDeleteRows(log: WriteLog, rows: number) {
  const cap = deleteLimit(log.grant, log.limits);
  if (rows > cap) {
    throw new Refusal(
      `At most ${cap} rows may be deleted or closed in one call on this connection (the delete limit, which a higher row limit does not raise; an undo of a create deletes too). Nothing changed.`,
    );
  }
}

export const id = z.string().min(1).max(100);
export const notes = z.string().max(1000);
/** The `confirm` a destructive tool's dry run returned. */
export const confirm = z.string().max(200).optional();

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
  const query = api
    .q(table)
    .filter({ id: { $oneof: unique } })
    .select(['id', ...select]);
  const { data } = (await api.runQuery(
    // Split parents are transactions too
    table === 'transactions' ? query.options({ splits: 'all' }) : query,
  )) as { data: Array<Record<string, unknown>> };
  if (data.length !== unique.length) {
    throw new Refusal(
      `Every ${table} id must be the id of an existing row, never a name.`,
    );
  }
  return new Map(data.map(row => [String(row.id), row]));
}
