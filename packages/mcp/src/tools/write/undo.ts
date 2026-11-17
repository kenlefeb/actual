import { closeSync, fstatSync, openSync, readSync } from 'fs';

import * as api from '@actual-app/api';
import type { TransactionEntity } from '@actual-app/core/types/models';
import { z } from 'zod';

import { appendAudit } from '#audit';
import type { AuditChange } from '#audit';
import type { Scope } from '#grants';
import { Refusal } from '#refusal';

import { budgeted } from './budget';
import { load } from './categories';
import {
  confirm,
  id,
  loggedWrite,
  requireAmount,
  requireCells,
  requireDeleteRows,
  requireMonth,
  requireRows,
  stderrLine,
} from './shared';
import type { Access, WriteLog } from './shared';
import { editRows, FIELD_COLUMN } from './update-plan';

/** One text for every failure of the first checks, so ids cannot be probed. */
const NOT_UNDOABLE =
  'That write cannot be undone: it is unknown, not yours, or not undoable. Nothing changed.';
const BY_HAND = 'Review it and undo by hand if you still want to.';

/** The scopes each undoable tool's reversal needs, by tool name; never read from a log line (design D2). */
const UNDOABLE: Record<string, Scope[]> = {
  write_update_transactions: ['transactions:write'],
  write_create_transactions: ['transactions:write'],
  write_set_budget_amount: ['budget:write'],
  write_set_budget_amounts: ['budget:write'],
  write_update_category: ['structure:write'],
  write_update_category_group: ['structure:write'],
  write_create_category: ['structure:write'],
  write_create_category_group: ['structure:write'],
};

/** Tools whose writes are budget cells (`category:month`), undone against the cell limit. */
const CELL_TOOLS = ['write_set_budget_amount', 'write_set_budget_amounts'];

/** Transaction fields an undo may put back. */
const TRANSACTION_FIELDS = [
  'category_id',
  'payee_id',
  'notes',
  'amount',
  'date',
  'account_id',
  'cleared',
];

/** Own access object (the server derives `readOnlyHint` from the shared read one). */
const UNDO_ACCESS: Access = { scopes: ['budget:read'], destructive: true };

type Line = Record<string, unknown>;
type Change = { id: string; field: string; before: unknown; after: unknown };
type Entry = { attempt?: Line; outcome?: Line; undos: Entry[] };

/** The audit tail setting's worth (2 MB by default) of the audit log's end as parsed lines; the cut first line and any damaged line are dropped. */
function readTail(path: string, tailBytes: number): Line[] {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    return [];
  }
  try {
    const { size } = fstatSync(fd);
    const length = Math.min(size, tailBytes);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    const text = buffer.toString('utf8').split('\n');
    if (size > length) text.shift();
    const lines: Line[] = [];
    for (const raw of text) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          lines.push(parsed as Line);
        }
      } catch {
        // damaged or empty line: skipped
      }
    }
    return lines;
  } finally {
    closeSync(fd);
  }
}

/** Attempt and outcome lines joined by call id (file order kept), with the undo attempts of each write. */
function readEntries(log: WriteLog) {
  const byId = new Map<string, Entry>();
  const order: string[] = [];
  const entry = (callId: string) => {
    let found = byId.get(callId);
    if (!found) {
      found = { undos: [] };
      byId.set(callId, found);
    }
    return found;
  };
  for (const line of readTail(log.path, log.limits.auditTailBytes)) {
    if (typeof line.call_id !== 'string' || typeof line.tool !== 'string') {
      continue;
    }
    const e = entry(line.call_id);
    if (line.phase === 'attempt' && !e.attempt) {
      e.attempt = line;
      order.push(line.call_id);
    } else if (line.phase === 'outcome' && !e.outcome) {
      e.outcome = line;
    }
  }
  for (const callId of order) {
    const e = byId.get(callId)!;
    const target = e.attempt?.undoes;
    if (e.attempt?.tool === 'write_undo' && typeof target === 'string') {
      byId.get(target)?.undos.push(e);
    }
  }
  return { byId, order };
}

const strings = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

function changesOf(e: Entry): Change[] {
  const raw = e.attempt?.changes;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c: unknown) => {
    const o = c as Line | null;
    return o && typeof o.id === 'string' && typeof o.field === 'string'
      ? [{ id: o.id, field: o.field, before: o.before, after: o.after }]
      : [];
  });
}

const isMine = (e: Entry, log: WriteLog) =>
  e.attempt?.subject === log.identity.subject &&
  e.attempt?.user_id === log.identity.user_id;

/** The `write_id` of the undo that used this write, if any: outcome ok, or at least one row applied. */
function usedBy(e: Entry) {
  return e.undos.find(
    u => u.outcome?.status === 'ok' || strings(u.outcome?.applied).length > 0,
  )?.attempt?.call_id as string | undefined;
}

/** Why a write cannot be undone, in fixed text; undefined when it can. */
function whyNot(e: Entry) {
  const tool = e.attempt?.tool as string;
  if (tool === 'write_undo') return 'an undo cannot be undone';
  if (e.attempt?.schema !== 2) return 'written before undo existed';
  if (!(tool in UNDOABLE)) return 'this kind of write is not undoable yet';
  const o = e.outcome;
  if (!o) return 'no outcome was logged';
  // A budget-cell write that stopped midway recorded only its applied cells
  const partial =
    CELL_TOOLS.includes(tool) &&
    o.status === 'failed' &&
    Array.isArray(o.applied) &&
    o.applied.length > 0;
  if (o.status !== 'ok' && !partial) return 'it did not complete';
  if (o.maybe_written) {
    return 'a cell may have been written but is not recorded';
  }
  if (!Array.isArray(o.applied) || o.read_back === 'failed') {
    return 'its result is unknown';
  }
  return undefined;
}

class UndoRefusal extends Refusal {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
  }
}

const notUndoable = (what: string) =>
  new UndoRefusal(`${what} Nothing changed. ${BY_HAND}`, 'not-undoable');

function conflict(items: string[]) {
  const shown = items.slice(0, 20).join(', ');
  const more = items.length > 20 ? ` and ${items.length - 20} more` : '';
  return new UndoRefusal(
    `A later change means this write can no longer be undone safely: ${shown}${more} no longer ${items.length === 1 ? 'holds' : 'hold'} what it left. Nothing changed. ${BY_HAND}`,
    'conflict',
  );
}

const norm = (v: unknown) => (v === undefined ? null : v);

type Plan = {
  ids: string[];
  changes: AuditChange[];
  deletes: boolean;
  /** Budget cells, counted against the cell limit rather than the row limit. */
  cells?: boolean;
  steps: Array<{ id: string; run: () => Promise<void> }>;
};

type Ctx = {
  entry: Entry;
  log: WriteLog;
  allowReconciled: boolean;
};

const appliedOf = (e: Entry) => new Set(strings(e.outcome?.applied));

/** Transactions as they are now; refuses a missing, split, transfer or (without the override) reconciled one. */
async function currentTransactions(ids: string[], ctx: Ctx) {
  const rows = new Map(
    (await editRows({ id: { $oneof: ids } })).map(r => [r.id, r]),
  );
  const missing = ids.filter(i => !rows.has(i));
  if (missing.length > 0) throw conflict(missing.map(i => `${i} (row)`));
  for (const row of rows.values()) {
    if (row.is_parent || row.is_child || row.transfer_id) {
      throw notUndoable(
        `Row ${row.id} is now a transfer or a split, which undo does not handle.`,
      );
    }
    if (row.reconciled && !ctx.allowReconciled) {
      throw notUndoable(
        `Row ${row.id} is reconciled; undo it with allow_reconciled set.`,
      );
    }
  }
  return rows;
}

async function planUpdateTransactions(ctx: Ctx): Promise<Plan> {
  const applied = appliedOf(ctx.entry);
  const wanted = new Map<string, Map<string, Change>>();
  for (const c of changesOf(ctx.entry)) {
    if (!applied.has(c.id) || !TRANSACTION_FIELDS.includes(c.field)) continue;
    const fields = wanted.get(c.id) ?? new Map<string, Change>();
    const first = fields.get(c.field);
    fields.set(c.field, first ? { ...c, before: first.before } : c);
    wanted.set(c.id, fields);
  }
  if (wanted.size === 0) throw notUndoable('There is nothing to put back.');
  const ids = [...wanted.keys()];
  const rows = await currentTransactions(ids, ctx);
  const stale: string[] = [];
  for (const [rowId, fields] of wanted) {
    for (const c of fields.values()) {
      const now = rows.get(rowId)![FIELD_COLUMN[c.field]];
      if (norm(now) !== norm(c.after)) stale.push(`${rowId} (${c.field})`);
    }
  }
  // What an update put back must still exist (a deleted or merged-away id is gone from the table)
  const REFS = {
    category_id: 'categories',
    payee_id: 'payees',
    account_id: 'accounts',
  } as const;
  for (const [field, table] of Object.entries(REFS)) {
    const wantedIds = [...wanted.entries()].flatMap(([rowId, fields]) => {
      const before = fields.get(field)?.before;
      return typeof before === 'string' ? [{ rowId, before }] : [];
    });
    if (wantedIds.length === 0) continue;
    const { data } = (await api.runQuery(
      api
        .q(table)
        .filter({ id: { $oneof: [...new Set(wantedIds.map(w => w.before))] } })
        .select(['id']),
    )) as { data: Array<{ id: string }> };
    const alive = new Set(data.map(r => r.id));
    for (const w of wantedIds) {
      if (!alive.has(w.before)) stale.push(`${w.rowId} (${field})`);
    }
  }
  if (stale.length > 0) throw conflict(stale);
  return {
    ids,
    deletes: false,
    changes: ids.flatMap(rowId =>
      [...wanted.get(rowId)!.values()].map(c => ({
        id: rowId,
        field: c.field,
        before: c.after,
        after: c.before,
      })),
    ),
    steps: ids.map(rowId => ({
      id: rowId,
      run: async () => {
        const fields: Record<string, unknown> = {};
        for (const c of wanted.get(rowId)!.values()) {
          fields[FIELD_COLUMN[c.field]] = norm(c.before);
        }
        await api.updateTransaction(
          rowId,
          fields as Partial<TransactionEntity>,
        );
      },
    })),
  };
}

const rowKey = (
  r: Record<string, unknown>,
  account: unknown,
  cleared: unknown,
) =>
  JSON.stringify([
    account,
    r.date,
    r.amount,
    norm(r.payee),
    norm(r.category),
    norm(r.notes),
    Boolean(cleared),
  ]);

async function planCreateTransactions(ctx: Ctx): Promise<Plan> {
  const created = strings(ctx.entry.outcome?.created);
  // the engine creates API rows cleared
  const account = strings(ctx.entry.attempt?.ids)[0];
  const logged = changesOf(ctx.entry)
    .filter(
      c => c.field === 'transaction' && c.after && typeof c.after === 'object',
    )
    .map(c => rowKey(c.after as Record<string, unknown>, account, true));
  if (created.length === 0 || created.length !== logged.length) {
    throw notUndoable('Its created rows were not fully recorded.');
  }
  const rows = await currentTransactions(created, ctx);
  const pool = [...logged];
  const stale: string[] = [];
  for (const row of rows.values()) {
    const at = pool.indexOf(rowKey(row, row.account, row.cleared));
    if (at < 0) stale.push(`${row.id} (transaction)`);
    else pool.splice(at, 1);
  }
  if (stale.length > 0) throw conflict(stale);
  return {
    ids: created,
    deletes: true,
    changes: created.map(rowId => ({
      id: rowId,
      field: 'transaction',
      before: rowKey(
        rows.get(rowId)!,
        rows.get(rowId)!.account,
        rows.get(rowId)!.cleared,
      ),
      after: null,
    })),
    steps: created.map(rowId => ({
      id: rowId,
      run: async () => {
        await api.deleteTransaction(rowId);
      },
    })),
  };
}

/**
 * Budget cells by `category:month`. A single-amount line names the category
 * alone in `applied`; a many-amounts line names `category:month`. Only applied
 * cells are compared and restored (design D6).
 */
async function planBudgetCells(ctx: Ctx): Promise<Plan> {
  const applied = appliedOf(ctx.entry);
  const wanted = new Map<string, Change & { month: string }>();
  for (const c of changesOf(ctx.entry)) {
    if (!/^budgeted:\d{4}-\d{2}$/.test(c.field)) continue;
    const month = c.field.slice('budgeted:'.length);
    const key = `${c.id}:${month}`;
    if (!applied.has(key) && !applied.has(c.id)) continue;
    wanted.set(key, { ...c, month });
  }
  if (wanted.size === 0) throw notUndoable('There is nothing to put back.');
  const stale: string[] = [];
  const now = new Map<string, Awaited<ReturnType<typeof budgeted>>>();
  for (const [key, c] of wanted) {
    if (typeof c.before !== 'number' || typeof c.after !== 'number') {
      throw notUndoable('There is nothing to put back.');
    }
    requireMonth(c.month);
    requireAmount(c.before);
    const found = await budgeted(c.month, c.id).catch(() => undefined);
    if (!found || found.amount !== c.after) stale.push(`${key} (${c.field})`);
    else now.set(key, found);
  }
  if (stale.length > 0) throw conflict(stale);
  return {
    ids: [...wanted.keys()],
    deletes: false,
    cells: true,
    changes: [...wanted.values()].map(c => ({
      id: c.id,
      field: c.field,
      before: c.after,
      after: c.before,
    })),
    steps: [...wanted].map(([key, c]) => ({
      id: key,
      run: async () => {
        await api.setBudgetAmount(c.month, c.id, c.before as number);
      },
    })),
  };
}

async function planCategoryUpdate(ctx: Ctx, group: boolean): Promise<Plan> {
  const applied = appliedOf(ctx.entry);
  const wanted = changesOf(ctx.entry).filter(
    c =>
      applied.has(c.id) &&
      ((c.field === 'name' && typeof c.before === 'string') ||
        (c.field === 'hidden' && typeof c.before === 'boolean')),
  );
  const rowId = wanted[0]?.id;
  if (!rowId || wanted.some(c => c.id !== rowId)) {
    throw notUndoable('There is nothing to put back.');
  }
  const groups = await load();
  const now = group
    ? groups.find(g => g.id === rowId)
    : groups.flatMap(g => g.categories).find(c => c.id === rowId);
  const stale = wanted
    .filter(c => !now || now[c.field as 'name' | 'hidden'] !== c.after)
    .map(c => `${rowId} (${c.field})`);
  // The restored name must not now belong to another sibling (the write tools' requireName rule)
  const restored = wanted.find(c => c.field === 'name')?.before;
  if (typeof restored === 'string') {
    const siblings = group
      ? groups
      : (groups.find(g => g.categories.some(c => c.id === rowId))?.categories ??
        []);
    if (
      siblings.some(
        o => o.id !== rowId && o.name.toLowerCase() === restored.toLowerCase(),
      )
    ) {
      stale.push(`${rowId} (name)`);
    }
  }
  if (stale.length > 0) throw conflict(stale);
  const fields = Object.fromEntries(wanted.map(c => [c.field, c.before]));
  return {
    ids: [rowId],
    deletes: false,
    changes: wanted.map(c => ({
      id: rowId,
      field: c.field,
      before: c.after,
      after: c.before,
    })),
    steps: [
      {
        id: rowId,
        run: async () => {
          if (group) await api.updateCategoryGroup(rowId, fields);
          else await api.updateCategory(rowId, fields);
        },
      },
    ],
  };
}

async function planCategoryCreate(ctx: Ctx, group: boolean): Promise<Plan> {
  const [rowId, ...rest] = strings(ctx.entry.outcome?.created);
  if (!rowId || rest.length > 0) {
    throw notUndoable('Its created row was not recorded.');
  }
  const logged = (field: string) =>
    changesOf(ctx.entry).find(c => c.field === field)?.after;
  const groups = await load();
  const found = group
    ? groups.find(g => g.id === rowId)
    : groups
        .flatMap(g => g.categories.map(c => ({ ...c, group_id: g.id })))
        .find(c => c.id === rowId);
  const stale: string[] = [];
  if (!found || found.name !== logged('name')) stale.push(`${rowId} (name)`);
  if (
    !group &&
    found &&
    (found as { group_id?: string }).group_id !== logged('group_id')
  ) {
    stale.push(`${rowId} (group_id)`);
  }
  if (stale.length > 0) throw conflict(stale);
  // in use: a category by any transaction, budget amount, rule or schedule; a group by any category
  let inUse = false;
  if (group) {
    inUse = groups.find(g => g.id === rowId)!.categories.length > 0;
  } else {
    const usage = await api.getCategoryUsage(rowId);
    // shortcut: rules and schedules are found by id text; replace with a typed
    // scan if the rule or schedule shape ever stores ids another way
    const refs = JSON.stringify([
      await api.getRules(),
      await api.getSchedules(),
    ]);
    inUse =
      usage.transactions > 0 || usage.months.length > 0 || refs.includes(rowId);
  }
  if (inUse) throw conflict([`${rowId} (in use)`]);
  return {
    ids: [rowId],
    deletes: true,
    changes: [{ id: rowId, field: 'name', before: found!.name, after: null }],
    steps: [
      {
        id: rowId,
        run: async () => {
          if (group) await api.deleteCategoryGroup(rowId);
          else await api.deleteCategory(rowId);
        },
      },
    ],
  };
}

const PLANNERS: Record<string, (ctx: Ctx) => Promise<Plan>> = {
  write_update_transactions: planUpdateTransactions,
  write_create_transactions: planCreateTransactions,
  write_set_budget_amount: planBudgetCells,
  write_set_budget_amounts: planBudgetCells,
  write_update_category: ctx => planCategoryUpdate(ctx, false),
  write_update_category_group: ctx => planCategoryUpdate(ctx, true),
  write_create_category: ctx => planCategoryCreate(ctx, false),
  write_create_category_group: ctx => planCategoryCreate(ctx, true),
};

type RegisterRead = <S extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: S,
  fn: (args: z.infer<z.ZodObject<S>>, log: WriteLog) => Promise<unknown>,
) => void;

/** `write_undo` (a write tool, with its own access) and `list_writes` (a read tool). */
export function registerUndoTools(
  write: <S extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: S,
    fn: (args: z.infer<z.ZodObject<S>>, log: WriteLog) => Promise<unknown>,
    access: Access,
  ) => void,
  read: RegisterRead,
) {
  read(
    'list_writes',
    "List this identity's own recent writes (not another's), newest first: write_id, time, tool, rows, status, whether undone and whether undoable (with a fixed reason when not). Use it to find a write_id after losing context. Reads the end of the audit log only.",
    { limit: z.number().int().min(1).max(50).optional() },
    async ({ limit = 20 }, log) => {
      const { byId, order } = readEntries(log);
      const writes = [];
      for (const callId of [...order].reverse()) {
        const e = byId.get(callId)!;
        if (!isMine(e, log)) continue;
        const reason = whyNot(e);
        const undone = usedBy(e) !== undefined;
        writes.push({
          write_id: callId,
          time: e.attempt?.time,
          tool: e.attempt?.tool,
          rows: strings(e.outcome?.applied).length,
          status: e.outcome?.status ?? 'unknown',
          undone,
          undoable: !reason && !undone,
          ...(reason || undone ? { reason: reason ?? 'already undone' } : {}),
        });
        if (writes.length === limit) break;
      }
      return { writes };
    },
  );

  write(
    'write_undo',
    "Undo one of this identity's earlier writes by its write_id (from the write's result or list_writes): transaction creates and updates, budget amounts, and category and group creates and updates. It restores the logged values and is refused, changing nothing, if any of them changed since or a created row is in use. A write can be undone once. Reversing a write needs the scopes that write needed. Moves, paycheck skips, deletes and account tools are not undoable.",
    {
      write_id: id,
      allow_reconciled: z.boolean().optional(),
      confirm,
    },
    async ({ write_id, allow_reconciled }, log) => {
      const refuse = (
        error: UndoRefusal | Refusal,
        extra: Line = {},
      ): never => {
        try {
          appendAudit(
            log.path,
            {
              tool: 'write_undo',
              phase: 'refused',
              reason: error instanceof UndoRefusal ? error.reason : 'refused',
              ...extra,
            },
            log.identity,
          );
        } catch {
          // Best effort: the refusal stands without its line.
        }
        throw error;
      };

      const entry = readEntries(log).byId.get(write_id);
      if (!entry?.attempt || !isMine(entry, log) || whyNot(entry)) {
        refuse(new UndoRefusal(NOT_UNDOABLE, 'unknown'));
      }
      const tool = entry!.attempt!.tool as string;
      const own = { undoes: write_id };
      const used = usedBy(entry!);
      if (used) {
        refuse(
          new UndoRefusal(
            `That write was already undone by write ${used}. Nothing changed.`,
            'used',
          ),
          own,
        );
      }
      const needed = UNDOABLE[tool];
      const missing = needed.filter(s => !log.grant.scopes.includes(s));
      if (missing.length > 0) {
        refuse(
          new UndoRefusal(
            `Undoing that write needs ${needed.join(' ')}; missing ${missing.join(' ')}; this connection was granted ${log.grant.scopes.join(' ') || 'nothing'}. Nothing changed.`,
            'scope',
          ),
          { ...own, missing },
        );
      }
      if (allow_reconciled && !log.grant.allow_reconciled) {
        refuse(
          new UndoRefusal(
            "This connection's grant does not allow overriding reconciled transactions. Nothing changed.",
            'grant',
          ),
          own,
        );
      }

      let plan: Plan;
      try {
        plan = await PLANNERS[tool]({
          entry: entry!,
          log,
          allowReconciled: Boolean(allow_reconciled),
        });
        // Undoing a create deletes: the delete limit, never a raised row limit
        if (plan.deletes) requireDeleteRows(log, plan.steps.length);
        else if (plan.cells) requireCells(log, plan.steps.length);
        else requireRows(log, plan.steps.length);
      } catch (error) {
        if (error instanceof Refusal) refuse(error, own);
        throw error;
      }

      return loggedWrite(
        log,
        'write_undo',
        { ids: plan.ids, changes: plan.changes },
        async callId => {
          const applied: string[] = [];
          for (const step of plan.steps) {
            try {
              await step.run();
              applied.push(step.id);
            } catch (error) {
              stderrLine(log, `write_undo failed (call ${callId})`, error);
              return { applied, failed: callId };
            }
          }
          return { applied };
        },
        async outcome => ({
          undid: write_id,
          restored: outcome.applied?.length ?? 0,
          ...(outcome.failed
            ? {
                failed: outcome.failed,
                failure:
                  (outcome.applied?.length ?? 0) > 0
                    ? 'The engine failed partway. Rows in the audit log as applied were put back; the write cannot be undone again, so finish by hand.'
                    : 'The engine failed before any row changed. Nothing changed; you can retry.',
              }
            : {}),
        }),
        { destructive: plan.deletes, undoes: write_id },
      );
    },
    UNDO_ACCESS,
  );
}
