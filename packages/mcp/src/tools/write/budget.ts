import * as api from '@actual-app/api';
import { z } from 'zod';

import type { Limits } from '#limits';
import { ENVELOPE_BYTES } from '#paging';
import { Refusal } from '#refusal';
import { withText } from '#sanitize';
import { moneyAs } from '#tools/read/shared';

import type { RegisterWriteTool, WriteLog, WriteOutcome } from './shared';
import {
  confirm,
  id,
  isDryRun,
  loggedWrite,
  requireAmount,
  requireCells,
  requireMonth,
  stderrLine,
} from './shared';

const month = z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM');

export async function budgeted(m: string, categoryId: string) {
  const { categoryGroups } = await api.getBudgetMonth(m);
  const category = categoryGroups
    .flatMap(g => g.categories ?? [])
    .find(c => c.id === categoryId);
  if (!category) {
    throw new Refusal(
      'category_id must be the id of an existing category, never a name.',
    );
  }
  return { amount: Number(category.budgeted ?? 0), name: category.name };
}

/** A month's budgeted amounts by category id (design D3: one read per month, not per cell). */
export async function budgetedMonth(m: string) {
  const { categoryGroups } = await api.getBudgetMonth(m);
  return new Map(
    categoryGroups
      .flatMap(g => g.categories ?? [])
      .map(c => [c.id, { amount: Number(c.budgeted ?? 0), name: c.name }]),
  );
}

const NOT_A_CATEGORY =
  'category_id must be the id of an existing category, never a name.';

async function carryoverFlag(m: string, categoryId: string) {
  const { categoryGroups } = await api.getBudgetMonth(m);
  const category = categoryGroups
    .flatMap(g => g.categories ?? [])
    .find(c => c.id === categoryId);
  if (!category) throw new Refusal(NOT_A_CATEGORY);
  return { flag: Boolean(category.carryover), name: category.name };
}

/** Hold is an envelope-budget feature; a tracking budget has no to-budget to hold. */
async function requireEnvelope() {
  const prefs = (await api.internal?.send('preferences/get')) as
    | { budgetType?: string }
    | undefined;
  if (prefs?.budgetType === 'tracking') {
    throw new Refusal(
      'Hold and reset hold work only in an envelope budget; this is a tracking budget. Nothing changed.',
    );
  }
}

function moneyResult(m: string, before: number, after: number, note: string) {
  return {
    month: m,
    ...moneyAs('for_next_month_before', before),
    ...moneyAs('for_next_month', after),
    ...(note ? { note } : {}),
  };
}

async function heldFor(m: string) {
  return Number((await api.getBudgetMonth(m)).forNextMonth ?? 0);
}

/** One budget cell to write: its category and month, the amount, and the amount read just before. */
type Cell = {
  month: string;
  category_id: string;
  amount: number;
  before: number;
  key: string;
};

const cellKey = (c: { category_id: string; month: string }) =>
  `${c.category_id}:${c.month}`;

/**
 * Writes cells in order inside the caller's write lock, each re-checked
 * against its audited before, and stops at the first cell that changed or that
 * the engine fails on (design D3, D4). Not inside api.batchBudgetUpdates: a
 * batch hides its own writes from reads until it ends, which would make the
 * re-check of the next cell meaningless. Each cell is read, then written.
 */
async function writeCells(
  plan: Cell[],
  log: WriteLog,
  tool: string,
  callId: string,
): Promise<WriteOutcome> {
  const applied: string[] = [];
  let failed: string | undefined;
  let reason = '';
  let maybe: string | undefined;
  for (const c of plan) {
    try {
      // The audited before must still hold when its cell is written
      const now = await budgeted(c.month, c.category_id);
      if (now.amount !== c.before) {
        failed = c.key;
        reason = 'changed';
        break;
      }
      await api.setBudgetAmount(c.month, c.category_id, c.amount);
      applied.push(c.key);
    } catch (error) {
      stderrLine(log, `${tool} failed (call ${callId})`, error);
      failed = c.key;
      reason = 'engine';
      // The engine may have committed before it threw: read the cell back
      try {
        const now = await budgeted(c.month, c.category_id);
        if (now.amount === c.amount && c.amount !== c.before) {
          applied.push(c.key);
          reason = 'engine-written';
        }
      } catch {
        maybe = c.key;
      }
      break;
    }
  }
  return {
    applied,
    ...(failed
      ? {
          failed,
          detail: {
            reason,
            ...(maybe ? { maybe_written: maybe } : {}),
          },
        }
      : {}),
  };
}

/** What a cell write returns: each cell's before and after, and on a stop the applied, failed and not-written cells. */
async function cellsResult(plan: Cell[], outcome: WriteOutcome) {
  const after = new Map<string, Awaited<ReturnType<typeof budgetedMonth>>>();
  try {
    for (const m of new Set(plan.map(c => c.month))) {
      after.set(m, await budgetedMonth(m));
    }
  } catch {
    // The failure report below matters more than the read-back
    after.clear();
  }
  const done = new Set(outcome.applied ?? []);
  return {
    cells: plan.map(c =>
      withText(
        {
          month: c.month,
          category_id: c.category_id,
          ...moneyAs('before', c.before),
          ...(after.size > 0
            ? moneyAs(
                'after',
                after.get(c.month)?.get(c.category_id)?.amount ?? c.amount,
              )
            : {}),
        },
        { category: after.get(c.month)?.get(c.category_id)?.name },
      ),
    ),
    applied: outcome.applied ?? [],
    ...(outcome.failed
      ? {
          failed: outcome.failed,
          not_written: plan
            .map(c => c.key)
            .filter(k => !done.has(k) && k !== outcome.failed),
          ...(outcome.detail?.maybe_written
            ? { maybe_written: outcome.detail.maybe_written }
            : {}),
          failure:
            outcome.detail?.reason === 'changed'
              ? 'That cell changed since it was read, so it and the cells after it were not written. Cells listed as applied were written; write_undo restores them.'
              : outcome.detail?.reason === 'engine-written'
                ? 'The engine reported an error on that cell after writing it, so it is counted as applied; the cells after it were not written. write_undo restores the applied cells.'
                : outcome.detail?.maybe_written
                  ? 'The engine failed on that cell and it could not be read back, so it may have been written; check it by hand. The cells after it were not written, and this write cannot be undone.'
                  : 'The engine failed on that cell, so it and the cells after it were not written. Cells listed as applied were written; write_undo restores them.',
        }
      : {}),
  };
}

/** Names beside each cell, so a person can read the dry run. */
async function categoryNames(month: string) {
  const names = new Map<string, { category: string; group: string }>();
  for (const g of (await api.getBudgetMonth(month)).categoryGroups) {
    for (const c of g.categories ?? []) {
      names.set(String(c.id), {
        category: String(c.name),
        group: String(g.name),
      });
    }
  }
  return names;
}

/** A dry run is never shortened: one that does not fit the response size is refused, with no confirm. */
function requireDryRunFits(
  log: WriteLog,
  shown: object,
  count: number,
  alwaysConfirm = false,
) {
  if (
    isDryRun(log, log.destructive, alwaysConfirm) &&
    Buffer.byteLength(JSON.stringify(shown)) + ENVELOPE_BYTES >
      log.limits.maxResponseBytes
  ) {
    throw new Refusal(
      `The dry run would list ${count} cells, more than fits in one response (${log.limits.maxResponseBytes} bytes), and it is never shortened, so no confirm is issued. Nothing changed. Narrow it (fewer categories, or set the cells in smaller batches with write_set_budget_amounts).`,
    );
  }
}

/**
 * A whole-month action (copy, average) from its plan: the app's own cells,
 * only those that change counted against the cell limit, and under
 * `confirm_destructive` a dry run that lists every cell or, when they do not
 * fit one response, is refused with no `confirm` (design D4).
 */
async function runMonthAction(
  log: WriteLog,
  tool: string,
  month: string,
  extra: Record<string, unknown>,
  planned: Array<{ categoryId: string; before: number; after: number }>,
) {
  requireCells(log, planned.length);
  if (planned.length === 0) {
    return { month, changed: 0, cells: [], note: 'No cell would change.' };
  }
  const plan: Cell[] = planned.map(c => ({
    month,
    category_id: c.categoryId,
    amount: c.after,
    before: c.before,
    key: cellKey({ category_id: c.categoryId, month }),
  }));
  const entry = {
    ids: plan.map(c => c.key),
    changes: plan.map(c => ({
      id: c.category_id,
      field: `budgeted:${month}`,
      before: c.before,
      after: c.amount,
    })),
    month,
    ...extra,
  };
  const names = await categoryNames(month);
  const cells = plan.map(c => ({
    cell: c.key,
    category: names.get(c.category_id)?.category,
    group: names.get(c.category_id)?.group,
    before: c.before,
    after: c.amount,
  }));
  requireDryRunFits(
    log,
    { ids: entry.ids, changes: entry.changes, cells },
    plan.length,
  );
  return loggedWrite(
    log,
    tool,
    entry,
    callId => writeCells(plan, log, tool, callId),
    async outcome => ({
      month,
      ...extra,
      changed: plan.length,
      ...(await cellsResult(plan, outcome)),
    }),
    { preview: { cells } },
  );
}

type TemplatePlan = Awaited<ReturnType<typeof api.planBudgetTemplates>>;

type TemplateOptions = { overwrite: boolean; categoryIds?: string[] };

/**
 * Applies the plan through the app's own action, once, inside the caller's
 * write lock. The plan is recomputed first and must equal the confirmed one
 * (goals and stored automations included); the engine then writes every cell
 * in one batch, so it is read back, not re-checked cell by cell (design D4).
 */
async function writeTemplates(
  plan: TemplatePlan,
  month: string,
  options: TemplateOptions,
  log: WriteLog,
  callId: string,
): Promise<WriteOutcome> {
  const keys = plan.cells.map(c =>
    cellKey({ category_id: c.categoryId, month }),
  );
  // Never an empty `failed` (a store-only plan has no cells): the audit would say ok
  const first = keys[0] ?? month;
  if (
    JSON.stringify(await api.planBudgetTemplates(month, options)) !==
    JSON.stringify(plan)
  ) {
    return { applied: [], failed: first, detail: { reason: 'changed' } };
  }
  let threw = false;
  try {
    await api.applyBudgetTemplates(month, options);
  } catch (error) {
    stderrLine(
      log,
      `write_apply_budget_templates failed (call ${callId})`,
      error,
    );
    threw = true;
  }
  // The engine writes automations, budgets and goals in separate batches and
  // may have stopped between them: read all three back
  let applied: string[] = [];
  let missing: string | undefined;
  try {
    const now = await readTemplateState(month);
    const ok = (c: TemplatePlan['cells'][number]) =>
      now.budgeted.get(c.categoryId) === c.after &&
      (now.goals.get(c.categoryId)?.goal ?? null) === c.goalAfter &&
      (now.goals.get(c.categoryId)?.longGoal ?? null) === c.longGoalAfter;
    applied = plan.cells
      .filter(ok)
      .map(c => cellKey({ category_id: c.categoryId, month }));
    missing =
      keys.find(k => !applied.includes(k)) ??
      plan.store
        .filter(s => (now.defs.get(s.categoryId) ?? null) !== s.after)
        .map(s => `automation:${s.categoryId}`)[0];
  } catch {
    return {
      applied: [],
      failed: first,
      detail: { reason: 'engine', maybe_written: first },
    };
  }
  if (threw) {
    return {
      applied,
      failed: missing ?? first,
      detail: { reason: 'engine', maybe_written: missing ?? first },
    };
  }
  return missing
    ? { applied, failed: missing, detail: { reason: 'engine' } }
    : { applied };
}

/** A month's budgeted amounts and goals, and the stored automations, as the engine left them. */
async function readTemplateState(month: string) {
  const prefs = (await api.internal?.send('preferences/get')) as
    | { budgetType?: string }
    | undefined;
  const table =
    prefs?.budgetType === 'tracking' ? 'reflect_budgets' : 'zero_budgets';
  const rows = (
    (await api.runQuery(
      api
        .q(table)
        .filter({ month: Number(month.replace('-', '')) })
        .select(['category', 'amount', 'goal', 'long_goal']),
    )) as {
      data: Array<{
        category: string;
        amount: number | null;
        goal: number | null;
        long_goal: number | null;
      }>;
    }
  ).data;
  const defs = (
    (await api.runQuery(api.q('categories').select(['id', 'goal_def']))) as {
      data: Array<{ id: string; goal_def: string | null }>;
    }
  ).data;
  return {
    budgeted: new Map(rows.map(r => [r.category, Number(r.amount ?? 0)])),
    goals: new Map(
      rows.map(r => [
        r.category,
        { goal: r.goal ?? null, longGoal: r.long_goal ?? null },
      ]),
    ),
    defs: new Map(defs.map(d => [d.id, d.goal_def ?? null])),
  };
}

/**
 * Apply or overwrite a month's templates from the app's plan: the cells and
 * goals that change, counted against the cell limit, and the automations the
 * notes would store. Not undoable: goals and the automation store cannot be
 * restored yet (design D6).
 */
async function runTemplates(
  log: WriteLog,
  month: string,
  mode: 'apply' | 'overwrite',
  categoryIds: string[] | undefined,
) {
  const options: TemplateOptions = {
    overwrite: mode === 'overwrite',
    ...(categoryIds ? { categoryIds } : {}),
  };
  const plan = await api.planBudgetTemplates(month, options);
  if (plan.errors.length > 0) {
    return withText(
      {
        month,
        changed: 0,
        cells: [],
        note: 'A template has an error, so the app applies nothing. Fix the note and try again. Nothing changed.',
      },
      { errors: plan.errors },
    );
  }
  requireCells(log, plan.cells.length);
  if (plan.cells.length === 0 && plan.store.length === 0) {
    return { month, changed: 0, cells: [], note: 'No cell would change.' };
  }
  const changes = [
    ...plan.cells.flatMap(c =>
      (
        [
          ['budgeted', c.before, c.after],
          ['goal', c.goalBefore, c.goalAfter],
          ['long_goal', c.longGoalBefore, c.longGoalAfter],
        ] as const
      )
        .filter(([, before, after]) => before !== after)
        .map(([field, before, after]) => ({
          id: c.categoryId,
          field: `${field}:${month}`,
          before,
          after,
        })),
    ),
    ...plan.store.map(s => ({
      id: s.categoryId,
      field: 'automation',
      before: s.before,
      after: s.after,
    })),
  ];
  const entry = {
    ids: plan.cells.map(c => cellKey({ category_id: c.categoryId, month })),
    changes,
    month,
    mode,
  };
  const names = await categoryNames(month);
  const cells = plan.cells.map(c => ({
    cell: cellKey({ category_id: c.categoryId, month }),
    category: names.get(c.categoryId)?.category,
    group: names.get(c.categoryId)?.group,
    before: c.before,
    after: c.after,
    goal_before: c.goalBefore,
    goal_after: c.goalAfter,
  }));
  requireDryRunFits(log, { ...entry, cells }, plan.cells.length, true);
  return loggedWrite(
    log,
    'write_apply_budget_templates',
    entry,
    callId => writeTemplates(plan, month, options, log, callId),
    async outcome => ({
      month,
      mode,
      changed: plan.cells.length,
      automations_stored: plan.store.length,
      cells: cells.map(({ category, group, ...c }) =>
        withText(c, { category, group }),
      ),
      applied: outcome.applied ?? [],
      ...(outcome.failed
        ? {
            failed: outcome.failed,
            failure:
              outcome.detail?.reason === 'changed'
                ? 'The templates changed since they were checked, so nothing was written.'
                : outcome.detail?.maybe_written
                  ? 'The engine failed and the result could not be read back, so it may have been written; check the month by hand.'
                  : 'The engine failed or did not write every cell; check the month by hand. Cells listed as applied were written. This write cannot be undone.',
          }
        : {}),
    }),
    // Permanent: always a dry run first, whatever confirm_destructive says (design D6)
    { preview: { cells }, alwaysConfirm: true },
  );
}
export function registerBudgetWriteTools(
  tool: RegisterWriteTool,
  limits: Limits,
) {
  tool(
    'write_set_budget_amount',
    "Set one category's budgeted amount for a month (YYYY-MM), by category id (never a name). Amounts are integer cents. Returns the amount before and after.",
    {
      month,
      category_id: id,
      amount: z.number(), // bounds: requireAmount, with fixed text
    },
    async ({ month: m, category_id, amount }, auditLog) => {
      requireMonth(m);
      requireAmount(amount);
      const before = await budgeted(m, category_id);

      return loggedWrite(
        auditLog,
        'write_set_budget_amount',
        {
          ids: [category_id],
          changes: [
            {
              id: category_id,
              field: `budgeted:${m}`,
              before: before.amount,
              after: amount,
            },
          ],
        },
        async () => {
          await api.setBudgetAmount(m, category_id, amount);
          return { applied: [category_id] };
        },
        async () => {
          const after = await budgeted(m, category_id);
          return withText(
            {
              month: m,
              category_id,
              ...moneyAs('before', before.amount),
              ...moneyAs('after', after.amount),
            },
            { category: after.name },
          );
        },
      );
    },
    { scopes: ['budget:write'] },
  );

  tool(
    'write_set_budget_amounts',
    `Set the budgeted amount of up to ${limits.maxCells} cells (a category in a month) in one call, by category id (never a name): cells is a list of {month (YYYY-MM), category_id, amount (integer cents)}. A cell may appear once. Every cell is checked first and a bad one refuses the whole call; then cells are written in order inside one write lock, each re-checked against the amount just read, and the call stops at the first cell that changed or that the engine fails on, naming applied, failed and not_written cells. Cells are named category_id:month in the audit log. Returns each cell's amount before and after. write_undo restores the applied cells.`,
    {
      cells: z
        .array(
          z
            .object({
              month,
              category_id: id,
              amount: z.number(), // bounds: requireAmount, with fixed text
            })
            .strict(),
        )
        .min(1)
        .max(limits.cellsCeiling),
    },
    async ({ cells }, auditLog) => {
      requireCells(auditLog, cells.length);
      if (new Set(cells.map(cellKey)).size !== cells.length) {
        throw new Refusal(
          'A category and month may appear only once. Nothing changed.',
        );
      }
      for (const c of cells) {
        requireMonth(c.month);
        requireAmount(c.amount);
      }
      const months = new Map<
        string,
        Awaited<ReturnType<typeof budgetedMonth>>
      >();
      for (const m of new Set(cells.map(c => c.month))) {
        months.set(m, await budgetedMonth(m));
      }
      const plan = cells.map(c => {
        const before = months.get(c.month)!.get(c.category_id);
        if (!before) throw new Refusal(NOT_A_CATEGORY);
        return { ...c, key: cellKey(c), before: before.amount };
      });

      return loggedWrite(
        auditLog,
        'write_set_budget_amounts',
        {
          ids: plan.map(c => c.key),
          changes: plan.map(c => ({
            id: c.category_id,
            field: `budgeted:${c.month}`,
            before: c.before,
            after: c.amount,
          })),
        },
        callId =>
          writeCells(plan, auditLog, 'write_set_budget_amounts', callId),
        outcome => cellsResult(plan, outcome),
      );
    },
    { scopes: ['budget:write'] },
  );

  tool(
    'write_copy_budget_month',
    `Copy last month's budgeted amounts into a month (YYYY-MM), as the budget menu's copy does: every category that is not hidden (and, in an envelope budget, not income) gets the previous month's amount. Only cells that would change are written and counted against the cell limit (${limits.maxCells} by default). When this connection must confirm destructive calls, the first call changes nothing and lists every cell (category_id:month, before, after) with a \`confirm\`; call again with it within 5 minutes. A dry run too large to list in one response is refused with no confirm. Cells are re-checked as they are written, and a stop names applied, failed and not_written cells. Cells are named category_id:month in the audit log. write_undo restores the applied cells.`,
    { month, confirm },
    async ({ month: m }, auditLog) => {
      requireMonth(m);
      return runMonthAction(
        auditLog,
        'write_copy_budget_month',
        m,
        {},
        await api.planCopyBudgetMonth(m),
      );
    },
    { scopes: ['budget:write'], destructive: true },
  );

  tool(
    'write_set_budget_to_average',
    `Set a month's (YYYY-MM) budgeted amounts to the average spending of the last 3, 6 or 12 months, as the budget menu's average does: every category that is not hidden (and, in an envelope budget, not income), expenses as positive budgets. Only cells that would change are written and counted against the cell limit (${limits.maxCells} by default). When this connection must confirm destructive calls, the first call changes nothing and lists every cell (category_id:month, before, after) with a \`confirm\`; call again with it within 5 minutes. A dry run too large to list in one response is refused with no confirm. Cells are re-checked as they are written, and a stop names applied, failed and not_written cells. Cells are named category_id:month in the audit log. write_undo restores the applied cells.`,
    {
      month,
      months: z.union([z.literal(3), z.literal(6), z.literal(12)]),
      confirm,
    },
    async ({ month: m, months }, auditLog) => {
      requireMonth(m);
      return runMonthAction(
        auditLog,
        'write_set_budget_to_average',
        m,
        { average_months: months },
        await api.planBudgetToAverage(m, months),
      );
    },
    { scopes: ['budget:write'], destructive: true },
  );

  tool(
    'write_apply_budget_templates',
    `Apply a month's (YYYY-MM) budget templates (the #template and #goal lines of category notes, no AI), as the budget menu's apply and overwrite do. mode "apply" (the default) runs only categories with no budgeted amount; "overwrite" runs every category with a template. With category_ids only those categories run, always overwriting. The budgeted amounts and goals that would change are counted against the cell limit (${limits.maxCells} by default), and the automations the notes would store are listed too. The first call always changes nothing and lists every cell (category_id:month, before, after, goal before and after) with a \`confirm\` that binds every cell, goal and stored automation; call again with it within 5 minutes. A dry run too large to list in one response is refused with no confirm. A note with a template error applies nothing and says so. Cells are named category_id:month in the audit log, which records each goal before and after.`,
    {
      month,
      mode: z.enum(['apply', 'overwrite']).optional(),
      category_ids: z.array(id).min(1).max(limits.cellsCeiling).optional(),
      confirm,
    },
    async ({ month: m, mode, category_ids }, auditLog) => {
      requireMonth(m);
      if (category_ids) {
        if (new Set(category_ids).size !== category_ids.length) {
          throw new Refusal(
            'A category may be listed only once. Nothing changed.',
          );
        }
        const known = await budgetedMonth(m);
        if (category_ids.some(c => !known.has(c))) {
          throw new Refusal(NOT_A_CATEGORY);
        }
      }
      return runTemplates(auditLog, m, mode ?? 'apply', category_ids);
    },
    { scopes: ['budget:write'], destructive: true },
  );
  tool(
    'write_set_budget_carryover',
    "Turn rollover (carryover) of a category's balance on or off, by category id (never a name). The engine applies it from the given month (YYYY-MM) onward, to every later month. Returns the flag before and after and how many months it covers.",
    { month, category_id: id, flag: z.boolean() },
    async ({ month: m, category_id, flag }, auditLog) => {
      requireMonth(m);
      const before = await carryoverFlag(m, category_id);
      const months = (await api.getBudgetMonths()).filter(x => x >= m).length;
      return loggedWrite(
        auditLog,
        'write_set_budget_carryover',
        {
          ids: [category_id],
          months,
          changes: [
            {
              id: category_id,
              field: `carryover:${m}`,
              before: before.flag,
              after: flag,
            },
          ],
        },
        async () => {
          await api.setBudgetCarryover(m, category_id, flag);
          return { applied: [category_id] };
        },
        async () => {
          const after = await carryoverFlag(m, category_id);
          return withText(
            {
              month: m,
              category_id,
              carryover_before: before.flag,
              carryover: after.flag,
              months_covered: months,
            },
            { category: after.name },
          );
        },
      );
    },
    { scopes: ['budget:write'] },
  );

  tool(
    'write_hold_budget_for_next_month',
    "Hold an amount (integer cents, above 0) of a month's to-budget for next month (envelope budgets only). The engine holds nothing when to-budget is not above 0 and holds at most the to-budget, so the result reads the held amount back and says whether anything was held.",
    { month, amount: z.number() },
    async ({ month: m, amount }, auditLog) => {
      requireMonth(m);
      requireAmount(amount);
      if (amount <= 0) {
        throw new Refusal('amount must be above 0. Nothing changed.');
      }
      await requireEnvelope();
      const { forNextMonth, toBudget } = await api.getBudgetMonth(m);
      const before = Number(forNextMonth ?? 0);
      // The engine's rule: it adds at most the to-budget, and nothing when that is not above 0
      const expected =
        Number(toBudget) > 0
          ? before + Math.min(amount, Number(toBudget))
          : before;
      let after = before;
      return loggedWrite(
        auditLog,
        'write_hold_budget_for_next_month',
        {
          ids: [m],
          changes: [{ id: m, field: `hold:${m}`, before, after: expected }],
        },
        async () => {
          await api.holdBudgetForNextMonth(m, amount);
          after = await heldFor(m);
          return {
            applied: after === before ? [] : [m],
            detail: { hold_after: after },
          };
        },
        async () => ({
          held: after !== before,
          ...moneyResult(
            m,
            before,
            after,
            after === before
              ? 'Nothing was held: to-budget is not above 0.'
              : '',
          ),
        }),
      );
    },
    { scopes: ['budget:write'] },
  );

  tool(
    'write_reset_budget_hold',
    'Clear the amount held for next month in a month (envelope budgets only). Returns the held amount before and after.',
    { month },
    async ({ month: m }, auditLog) => {
      requireMonth(m);
      await requireEnvelope();
      const before = await heldFor(m);
      let after = before;
      return loggedWrite(
        auditLog,
        'write_reset_budget_hold',
        {
          ids: [m],
          changes: [{ id: m, field: `hold:${m}`, before, after: 0 }],
        },
        async () => {
          await api.resetBudgetHold(m);
          after = await heldFor(m);
          return { applied: [m] };
        },
        async () => moneyResult(m, before, after, ''),
      );
    },
    { scopes: ['budget:write'] },
  );
}
