import { closeSync, fstatSync, openSync, readSync } from 'fs';

import * as api from '@actual-app/api';
import type { UndeleteRowsArgs } from '@actual-app/core/types/api-handlers';
import type { TransactionEntity } from '@actual-app/core/types/models';
import { z } from 'zod';

import { appendAudit } from '#audit';
import type { AuditChange } from '#audit';
import { Refusal } from '#refusal';
import { syncNow } from '#sync';
import { lastReconciledOf } from '#tools/read/reconciliation';

import { budgeted } from './budget';
import { groupOrder, load, nextOf } from './categories';
import { NOT_UNDOABLE, UNDOABLE } from './declarations';
import { checkRows, rowKey as stateKey } from './delete-snapshot';
import {
  applyScheduleFields,
  sameValue,
  SCHEDULE_FIELDS,
  scheduleValue,
} from './schedules';
import type { ScheduleFields } from './schedules';
import {
  budgetId,
  confirm,
  id,
  loggedWrite,
  requireAmount,
  requireCells,
  requireDeleteRows,
  requireMonth,
  requireRows,
  rowKey,
  stderrLine,
} from './shared';
import type { Access, WriteLog } from './shared';
import { editRows, FIELD_COLUMN } from './update-plan';

/** One text for every failure of the first checks, so ids cannot be probed. */
const UNKNOWN =
  'That write cannot be undone: it is unknown, not yours, or not undoable. Nothing changed.';
const BY_HAND = 'Review it and undo by hand if you still want to.';

/** The change that records a move's old place, by tool (design D1). */
const NEXT_FIELD: Record<string, string> = {
  write_move_category: 'next_category_id',
  write_move_category_group: 'next_group_id',
};

/** Tools whose writes are budget cells (`category:month`), undone against the cell limit. */
const CELL_TOOLS = [
  'write_set_budget_amount',
  'write_set_budget_amounts',
  'write_copy_budget_month',
  'write_set_budget_to_average',
];

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
  if (tool in NOT_UNDOABLE) return NOT_UNDOABLE[tool];
  if (e.attempt?.schema !== 2) return 'written before undo existed';
  if (!(tool in UNDOABLE)) return 'this kind of write is not undoable yet';
  if (
    tool in NEXT_FIELD &&
    !changesOf(e).some(c => c.field === NEXT_FIELD[tool])
  ) {
    return 'logged before moves recorded their place';
  }
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
  steps: Array<{ id: string; ids?: string[]; run: () => Promise<void> }>;
  /** An undo of a delete: its rows count against the row limit, its cells against the cell limit. */
  restores?: { rows: number; cells: number };
  /** After the apply: the rows and cells a later change already overrode. */
  verify?: () => Promise<string[]>;
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

const swapped = (changes: Change[]): AuditChange[] =>
  changes.map(c => ({
    id: c.id,
    field: c.field,
    before: c.after,
    after: c.before,
  }));

/** A created schedule: deleted while it still holds what was logged and nothing uses it. */
async function planScheduleCreate(ctx: Ctx): Promise<Plan> {
  const [rowId, ...rest] = strings(ctx.entry.outcome?.created);
  if (!rowId || rest.length > 0) {
    throw notUndoable('Its created row was not recorded.');
  }
  const all = await api.getSchedules();
  const found = all.find(s => s.id === rowId);
  const stale = found
    ? SCHEDULE_FIELDS.filter(
        f =>
          !sameValue(
            scheduleValue(found, f),
            changesOf(ctx.entry).find(c => c.field === f)?.after,
          ),
      ).map(f => `${rowId} (${f})`)
    : [`${rowId} (missing)`];
  if (stale.length > 0) throw conflict(stale);
  const linked = (await api.runQuery(
    api.q('transactions').filter({ schedule: rowId }).select(['id']).limit(1),
  )) as { data: unknown[] };
  const dependents = all.some(
    s =>
      typeof s.date === 'object' &&
      'relativeTo' in s.date &&
      s.date.relativeTo.scheduleId === rowId,
  );
  if (linked.data.length > 0 || dependents) {
    throw conflict([`${rowId} (in use)`]);
  }
  return {
    ids: [rowId],
    deletes: true,
    changes: [
      { id: rowId, field: 'name', before: found!.name ?? null, after: null },
    ],
    steps: [{ id: rowId, run: () => api.deleteSchedule(rowId) }],
  };
}

/** An updated schedule: the logged before-values go back through the same engine update. */
async function planScheduleUpdate(ctx: Ctx): Promise<Plan> {
  const applied = appliedOf(ctx.entry);
  const wanted = changesOf(ctx.entry).filter(
    c =>
      applied.has(c.id) &&
      (SCHEDULE_FIELDS as readonly string[]).includes(c.field),
  );
  const rowId = wanted[0]?.id;
  if (!rowId || wanted.some(c => c.id !== rowId)) {
    throw notUndoable('There is nothing to put back.');
  }
  const all = await api.getSchedules();
  const now = all.find(s => s.id === rowId);
  const stale = wanted
    .filter(c => !now || !sameValue(scheduleValue(now, c.field), c.after))
    .map(c => `${rowId} (${c.field})`);
  const name = wanted.find(c => c.field === 'name')?.before;
  if (
    typeof name === 'string' &&
    all.some(s => s.id !== rowId && s.name === name)
  ) {
    stale.push(`${rowId} (name)`);
  }
  if (stale.length > 0) throw conflict(stale);
  const fields = Object.fromEntries(
    wanted.map(c => [c.field, c.before]),
  ) as ScheduleFields;
  return {
    ids: [rowId],
    deletes: false,
    changes: swapped(wanted),
    steps: [{ id: rowId, run: () => applyScheduleFields(rowId, fields) }],
  };
}

/** Syncs first, so the checks see what other devices sent; a failed sync refuses the undo. */
async function syncFirst() {
  try {
    await syncNow();
  } catch {
    throw new UndoRefusal(
      'Could not sync before undoing, so the checks could not see other devices. Nothing changed. Try again.',
      'sync',
    );
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

const isId = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= 100;

type RestoreRow = UndeleteRowsArgs['rows'][number];
type RestoreCell = NonNullable<UndeleteRowsArgs['cells']>[number];

/**
 * An undo of a delete: one `undeleteRows` call for every row and cell, all or
 * nothing, then a read-back that names whatever a later change already
 * overrode (design D5). The undo's line holds the delete's changes with
 * before and after swapped, the shape the delete's size check assumed.
 */
function restorePlan(
  rows: RestoreRow[],
  cells: RestoreCell[],
  logged: Change[],
  ids: string[],
  /** What the delete counted against the delete limit: its transactions, or its categories. */
  counted: number,
): Plan {
  return {
    ids,
    changes: swapped(logged),
    deletes: false,
    restores: { rows: counted, cells: cells.length },
    steps: [
      {
        id: 'restore',
        ids,
        run: async () => {
          await api.undeleteRows({
            budget_id: await budgetId(),
            rows,
            ...(cells.length > 0 ? { cells } : {}),
          });
        },
      },
    ],
    verify: async () => {
      const after = await checkRows(rows);
      const overridden = rows.flatMap(r => {
        const s = after.get(stateKey(r.table, r.id));
        const holds =
          s?.deleted === false &&
          (r.set?.transfer_id === undefined ||
            s.columns.transferred_id === r.set.transfer_id) &&
          (r.set?.transferId === undefined ||
            s.columns.transferId === r.set.transferId);
        return holds ? [] : [r.id];
      });
      for (const c of cells) {
        const now = await budgeted(c.month, c.category).catch(() => undefined);
        if (now?.amount !== c.amount) {
          overridden.push(`${c.category}:${c.month}`);
        }
      }
      return overridden;
    },
  };
}

async function planDeleteTransactions(ctx: Ctx): Promise<Plan> {
  const applied = appliedOf(ctx.entry);
  const all = changesOf(ctx.entry);
  const txs = all.filter(c => c.field === 'transaction' && applied.has(c.id));
  const unlinks = all.filter(c => c.field === 'unlink');
  const atts = all.filter(
    c =>
      c.field === 'attachment' &&
      isObject(c.before) &&
      applied.has(String(c.before.transaction_id)),
  );
  const logged = [...txs, ...atts, ...unlinks];
  if (
    txs.length === 0 ||
    !logged.every(c => isObject(c.before) && isId(c.id))
  ) {
    throw notUndoable('There is nothing to put back.');
  }
  const before = (c: Change) => c.before as Record<string, unknown>;
  for (const c of txs) {
    const b = before(c);
    if (
      !isId(b.account) ||
      (b.payee !== null && !isId(b.payee)) ||
      (b.category !== null && b.category !== undefined && !isId(b.category))
    ) {
      throw notUndoable('A logged value is not an id.');
    }
  }
  const accountsOf = [...new Set(txs.map(c => before(c).account as string))];
  await syncFirst();

  const states = await checkRows([
    ...txs.map(c => ({ table: 'transactions' as const, id: c.id })),
    ...unlinks.map(c => ({ table: 'transactions' as const, id: c.id })),
    ...atts.map(c => ({
      table: 'transaction_attachments' as const,
      id: c.id,
    })),
  ]);
  const col = (id: string, name: string) =>
    states.get(stateKey('transactions', id))?.columns[name];
  const stale: string[] = [];
  for (const c of txs) {
    const s = states.get(stateKey('transactions', c.id));
    if (!s?.exists || !s.deleted) stale.push(`${c.id} (row)`);
  }
  for (const c of atts) {
    const s = states.get(stateKey('transaction_attachments', c.id));
    if (!s?.exists || !s.deleted) stale.push(`${c.id} (attachment)`);
  }
  const accounts = new Map(
    (await api.getAccounts()).map(a => [a.id, Boolean(a.closed)]),
  );
  const payees = new Set((await api.getPayees()).map(p => p.id));
  for (const account of accountsOf) {
    if (!accounts.has(account) || accounts.get(account)) {
      stale.push(`${account} (account)`);
    }
  }
  for (const c of txs) {
    const payee = before(c).payee;
    if (typeof payee === 'string' && !payees.has(payee)) {
      stale.push(`${payee} (payee)`);
    }
  }
  // A category deleted since is fine only when it forwards to a live one (a delete with a transfer)
  const liveCategories = new Set(
    (await load()).flatMap(g => g.categories.map(c => c.id)),
  );
  const gone = [
    ...new Set(
      txs.flatMap(c => {
        const category = before(c).category;
        return typeof category === 'string' && !liveCategories.has(category)
          ? [category]
          : [];
      }),
    ),
  ];
  if (gone.length > 0) {
    const forwards = await checkRows(
      gone.map(id => ({ table: 'categories' as const, id })),
    );
    for (const category of gone) {
      const to = forwards.get(stateKey('categories', category))?.columns
        .mapping;
      if (typeof to !== 'string' || !liveCategories.has(to)) {
        stale.push(`${category} (category)`);
      }
    }
  }

  const txIds = new Set(txs.map(c => c.id));
  const sets = new Map<string, NonNullable<RestoreRow['set']>>();
  for (const c of txs) {
    const to = before(c).transfer_id;
    if (typeof to === 'string' && col(c.id, 'transferred_id') !== to) {
      if (!txIds.has(to) && !unlinks.some(u => u.id === to)) {
        throw notUndoable(`Row ${c.id}'s transfer partner was not recorded.`);
      }
      sets.set(c.id, { transfer_id: to });
    }
  }
  for (const c of unlinks) {
    const s = states.get(stateKey('transactions', c.id));
    if (!s?.exists || s.deleted) {
      stale.push(`${c.id} (row)`);
      continue;
    }
    if (s.columns.transferred_id !== null || s.columns.description !== null) {
      stale.push(`${c.id} (transfer_id)`);
    }
    const partner = String(before(c).transfer_id);
    const partnerLine = txs.find(t => t.id === partner);
    if (!partnerLine || before(partnerLine).transfer_id !== c.id) {
      throw notUndoable(`Child ${c.id}'s transfer row was not recorded.`);
    }
    const payee = before(c).payee;
    sets.set(c.id, {
      transfer_id: partner,
      ...(typeof payee === 'string' ? { payee } : {}),
    });
  }
  if (stale.length > 0) throw conflict(stale);

  // A reconciled row, or an account reconciled after the delete, needs the override
  const since = Date.parse(String(ctx.entry.attempt?.time));
  const locked = [...txs, ...unlinks]
    .filter(c => col(c.id, 'reconciled') === 1)
    .map(c => c.id);
  for (const account of accountsOf) {
    if (Number(await lastReconciledOf(account)) > since) {
      locked.push(`${account} (reconciled since)`);
    }
  }
  if (locked.length > 0 && !ctx.allowReconciled) {
    throw notUndoable(
      `Reconciled: ${locked.join(', ')}; undo it with allow_reconciled set.`,
    );
  }

  const row = (table: RestoreRow['table'], c: Change): RestoreRow => ({
    table,
    id: c.id,
    ...(sets.has(c.id) ? { set: sets.get(c.id) } : {}),
  });
  return restorePlan(
    [
      ...txs.map(c => row('transactions', c)),
      ...atts.map(c => row('transaction_attachments', c)),
      ...unlinks.map(c => row('transactions', c)),
    ],
    [],
    logged,
    logged.map(c => c.id),
    txs.length,
  );
}

async function planDeleteCategories(ctx: Ctx, group: boolean): Promise<Plan> {
  const applied = appliedOf(ctx.entry);
  const all = changesOf(ctx.entry);
  const ids = strings(ctx.entry.attempt?.ids).filter(i => applied.has(i));
  const groupId = group ? strings(ctx.entry.attempt?.ids)[0] : undefined;
  const catIds = group ? ids.filter(i => i !== groupId) : ids;
  if (catIds.length === 0 || (group && !groupId)) {
    throw notUndoable('There is nothing to put back.');
  }
  const field = (name: string) => all.filter(c => c.field === name);
  const names = new Map(field('name').map(c => [c.id, c.before]));
  const groupOf = new Map(field('group_id').map(c => [c.id, c.before]));
  const transfer = field('transfer_category_id')[0]?.after;
  const mappings = field('mapping');
  const cells = all.flatMap(c => {
    const month = /^budgeted:(\d{4}-\d{2})$/.exec(c.field)?.[1];
    return month ? [{ ...c, month }] : [];
  });
  const valid =
    catIds.every(
      i => typeof names.get(i) === 'string' && isId(groupOf.get(i)),
    ) &&
    (!group || typeof names.get(groupId!) === 'string') &&
    (transfer === null || transfer === undefined || isId(transfer)) &&
    mappings.every(
      c =>
        isId(c.id) && isId(c.before) && isId(c.after) && c.after === transfer,
    ) &&
    cells.every(
      c =>
        c.id === transfer &&
        Number.isSafeInteger(c.before) &&
        Number.isSafeInteger(c.after),
    );
  if (!valid) throw notUndoable('A logged value is not an id of its kind.');
  await syncFirst();

  const states = await checkRows([
    ...catIds.map(i => ({ table: 'categories' as const, id: i })),
    ...(group ? [{ table: 'category_groups' as const, id: groupId! }] : []),
    ...mappings.map(c => ({ table: 'category_mapping' as const, id: c.id })),
  ]);
  const stale: string[] = [];
  for (const i of catIds) {
    const s = states.get(stateKey('categories', i));
    if (!s?.exists || !s.deleted) stale.push(`${i} (row)`);
  }
  const live = await load();
  if (group) {
    const s = states.get(stateKey('category_groups', groupId!));
    if (!s?.exists || !s.deleted) stale.push(`${groupId} (row)`);
    const wanted = String(names.get(groupId!)).toLowerCase();
    if (live.some(g => g.name.toLowerCase() === wanted)) {
      stale.push(`${groupId} (name)`);
    }
  } else {
    const gid = String(groupOf.get(catIds[0]));
    const liveGroup = live.find(g => g.id === gid);
    if (!liveGroup) {
      stale.push(`${gid} (group)`);
    } else if (
      liveGroup.categories.some(
        c =>
          c.name.toLowerCase() === String(names.get(catIds[0])).toLowerCase(),
      )
    ) {
      stale.push(`${catIds[0]} (name)`);
    }
  }
  if (typeof transfer === 'string') {
    if (!live.some(g => g.categories.some(c => c.id === transfer))) {
      stale.push(`${transfer} (category)`);
    }
    for (const m of mappings) {
      if (
        states.get(stateKey('category_mapping', m.id))?.columns.transferId !==
        m.after
      ) {
        stale.push(`${m.id} (mapping)`);
      }
    }
    for (const c of cells) {
      const now = await budgeted(c.month, c.id).catch(() => undefined);
      if (now?.amount !== c.after) stale.push(`${c.id}:${c.month} (cell)`);
    }
  }
  if (stale.length > 0) throw conflict(stale);

  const rows: RestoreRow[] = [
    ...catIds.map(i => ({ table: 'categories' as const, id: i })),
    ...(group ? [{ table: 'category_groups' as const, id: groupId! }] : []),
    ...mappings.map(m => ({
      table: 'category_mapping' as const,
      id: m.id,
      set: { transferId: m.before as string },
    })),
  ];
  return restorePlan(
    rows,
    cells.map(c => ({
      category: c.id,
      month: c.month,
      amount: c.before as number,
    })),
    all,
    ids,
    catIds.length,
  );
}

/**
 * An undo of a category or group move (design D3). It trusts only the line's
 * ids; every fact it checks is read now, after a sync, and the old place must
 * pass the rules the move tool applies to its arguments.
 */
async function planMove(ctx: Ctx, group: boolean): Promise<Plan> {
  const tool = group ? 'write_move_category_group' : 'write_move_category';
  const nextField = NEXT_FIELD[tool];
  const raw = ctx.entry.attempt?.changes;
  const ids = ctx.entry.attempt?.ids;
  const all = changesOf(ctx.entry);
  const rowId = Array.isArray(ids) && ids.length === 1 ? ids[0] : undefined;
  const nexts = all.filter(c => c.field === nextField);
  const moves = all.filter(c => c.field === 'group_id');
  const idOrNull = (v: unknown) => v === null || isId(v);
  // Exactly one row, with exactly the expected changes for it (design D2)
  const valid =
    Array.isArray(raw) &&
    raw.length === all.length &&
    all.length === (group ? 1 : 2) &&
    nexts.length === 1 &&
    moves.length === (group ? 0 : 1) &&
    all.every(c => c.id === rowId) &&
    idOrNull(nexts[0].before) &&
    idOrNull(nexts[0].after) &&
    moves.every(c => isId(c.before) && isId(c.after));
  if (!valid || !isId(rowId)) {
    throw notUndoable('A logged value is not an id of its kind.');
  }
  const next = nexts[0] as Change & { before: string | null };
  const oldNext = next.before;
  await syncFirst();

  const what = group ? 'group' : 'category';
  const problems: string[] = [];
  const at = (item: string, field: string, cause: string) =>
    problems.push(`${item} (${field}): ${cause}`);
  if (oldNext === rowId) {
    at(rowId, nextField, `a ${what} cannot sit before itself`);
  }
  const groups = await load();
  let oldGroup: string | undefined;
  if (group) {
    const order = await groupOrder();
    if (!order.includes(rowId)) {
      at(rowId, 'row', 'the group has been deleted');
    } else if (nextOf(order, rowId) !== next.after) {
      at(rowId, nextField, 'the group has been reordered since');
    }
    if (oldNext !== null && oldNext !== rowId && !order.includes(oldNext)) {
      at(oldNext, nextField, 'the group it sat before has been deleted');
    }
  } else {
    const move = moves[0] as Change & { before: string; after: string };
    oldGroup = move.before;
    const now = groups.find(g => g.categories.some(c => c.id === rowId));
    const row = now?.categories.find(c => c.id === rowId);
    const old = groups.find(g => g.id === move.before);
    if (!now || !row) {
      at(rowId, 'row', 'the category has been deleted');
    } else if (now.id !== move.after) {
      at(
        rowId,
        'group_id',
        'the category has been moved to another group since',
      );
    } else if (
      nextOf(
        now.categories.map(c => c.id),
        rowId,
      ) !== next.after
    ) {
      at(rowId, nextField, 'the category has been reordered since');
    }
    if (!old) {
      at(move.before, 'group_id', 'the group it came from has been deleted');
    } else if (row) {
      if (old.is_income !== row.is_income) {
        at(
          old.id,
          'group_id',
          'a category cannot move between an income and an expense group',
        );
      }
      if (
        old.id !== now?.id &&
        old.categories.some(
          c =>
            c.id !== rowId && c.name.toLowerCase() === row.name.toLowerCase(),
        )
      ) {
        at(
          rowId,
          'name',
          'a category of the same name is now in the group it came from',
        );
      }
    }
    if (oldNext !== null && oldNext !== rowId) {
      const holder = groups.find(g => g.categories.some(c => c.id === oldNext));
      if (!holder) {
        at(oldNext, nextField, 'the category it sat before has been deleted');
      } else if (holder.id !== move.before) {
        at(
          oldNext,
          nextField,
          'the category it sat before is now in another group',
        );
      }
    }
  }
  if (problems.length > 0) {
    throw new UndoRefusal(
      `This move can no longer be undone safely: ${problems.join('; ')}. The ${what} stays where it is; move it by hand with ${tool}, or tell the budget's owner. Nothing changed.`,
      'conflict',
    );
  }
  return {
    ids: [rowId],
    deletes: false,
    changes: swapped(all),
    steps: [
      {
        id: rowId,
        run: async () => {
          if (group) await api.moveCategoryGroup(rowId, oldNext ?? undefined);
          else await api.moveCategory(rowId, oldGroup!, oldNext ?? undefined);
        },
      },
    ],
  };
}

export const PLANNERS: Record<string, (ctx: Ctx) => Promise<Plan>> = {
  write_update_transactions: planUpdateTransactions,
  write_create_transactions: planCreateTransactions,
  write_set_budget_amount: planBudgetCells,
  write_set_budget_amounts: planBudgetCells,
  write_copy_budget_month: planBudgetCells,
  write_set_budget_to_average: planBudgetCells,
  write_update_category: ctx => planCategoryUpdate(ctx, false),
  write_update_category_group: ctx => planCategoryUpdate(ctx, true),
  write_create_category: ctx => planCategoryCreate(ctx, false),
  write_create_category_group: ctx => planCategoryCreate(ctx, true),
  write_delete_transactions: planDeleteTransactions,
  write_delete_category: ctx => planDeleteCategories(ctx, false),
  write_delete_category_group: ctx => planDeleteCategories(ctx, true),
  write_move_category: ctx => planMove(ctx, false),
  write_move_category_group: ctx => planMove(ctx, true),
  write_create_schedule: planScheduleCreate,
  write_update_schedule: planScheduleUpdate,
};

type RegisterRead = <S extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: S,
  fn: (args: z.infer<z.ZodObject<S>>, log: WriteLog) => Promise<unknown>,
) => void;

/** `write_undo` (a write tool, with its own access) and `list_writes` (a read tool). */
export function registerUndoTools(
  tool: <S extends z.ZodRawShape>(
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

  tool(
    'write_undo',
    "Undo one of this identity's earlier writes by its write_id (from the write's result or list_writes): transaction creates and updates, budget amounts (also copy last month and set to average), category and group creates and updates, deletes of transactions, categories and category groups (sync first; the deleted rows come back with their ids), schedule creates and updates, and category and group moves (sync first; the row goes back before its old next sibling, or is refused naming what changed). It restores the logged values and is refused, changing nothing, if any of them changed since or a created row is in use. A write can be undone once. Reversing a write needs the scopes that write needed. Paycheck skips and account tools are not undoable.",
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
      // A line for another budget, or from before lines named theirs, reads as unknown
      if (
        !entry?.attempt ||
        !isMine(entry, log) ||
        entry.attempt.budget_id !== (await budgetId())
      ) {
        refuse(new UndoRefusal(UNKNOWN, 'unknown'));
      }
      const tool = entry!.attempt!.tool as string;
      const own = { undoes: write_id };
      // The caller's own write: its fixed reason may be named
      const reason = whyNot(entry!);
      if (reason) {
        refuse(
          new UndoRefusal(
            `That write cannot be undone: ${reason}. Nothing changed.`,
            'not-undoable',
          ),
          own,
        );
      }
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
        if (plan.restores) {
          // Counted the way the delete counted them (design D4), so an allowed delete can be undone
          requireDeleteRows(log, plan.restores.rows);
          if (plan.restores.cells > 0) requireCells(log, plan.restores.cells);
        } else if (plan.deletes) {
          requireDeleteRows(log, plan.steps.length);
        } else if (plan.cells) {
          requireCells(log, plan.steps.length);
        } else {
          requireRows(log, plan.steps.length);
        }
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
              applied.push(...(step.ids ?? [step.id]));
            } catch (error) {
              stderrLine(log, `write_undo failed (call ${callId})`, error);
              return { applied, failed: callId };
            }
          }
          // Read back what this server holds now; a later sync can still override it
          const overridden = plan.verify
            ? await plan.verify().catch(() => [])
            : [];
          return {
            applied,
            ...(overridden.length > 0 ? { detail: { overridden } } : {}),
          };
        },
        async outcome => ({
          undid: write_id,
          restored: outcome.applied?.length ?? 0,
          ...(outcome.detail?.overridden
            ? {
                overridden: outcome.detail.overridden,
                note: 'These were restored, but a later change on this server already overrode them. The result reflects this copy of the budget only.',
              }
            : {}),
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
