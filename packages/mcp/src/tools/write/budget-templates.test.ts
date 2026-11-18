import { existsSync, readFileSync } from 'fs';

import * as api from '@actual-app/api';

import { startHarness } from '#client-harness';
import { SCOPES } from '#grants';
import type { Grant } from '#grants';
import type { Limits } from '#limits';

let h: Awaited<ReturnType<typeof startHarness>>;

afterEach(async () => {
  vi.restoreAllMocks();
  await h.close();
});

async function start(over: Partial<Grant> = {}, limits?: Partial<Limits>) {
  h = await startHarness(
    { count: 1 },
    {
      grant: { scopes: [...SCOPES], confirm_destructive: false, ...over },
      limits,
    },
  );
}

function lines() {
  if (!existsSync(h.auditLog)) return [];
  return readFileSync(h.auditLog, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));
}

const MONTH = '2026-03';

/** Templates always answer the first call with a dry run; this confirms it and returns the write's result. */
async function apply(args: Record<string, unknown>) {
  const dry = await h.call('write_apply_budget_templates', args);
  if (dry.isError || !dry.json.dry_run) return dry;
  return h.call('write_apply_budget_templates', {
    ...args,
    confirm: dry.json.confirm,
  });
}

async function budgetedNow(category: string, month = MONTH) {
  const m = await api.getBudgetMonth(month);
  return Number(
    m.categoryGroups
      .flatMap(g => g.categories ?? [])
      .find(c => c.id === category)!.budgeted ?? 0,
  );
}

/**
 * A runs on a note of 100 (10,000 cents); D is already budgeted 30 and its
 * note says 80; B holds only a goal. Income gives the month funds to budget.
 */
async function fixture() {
  const group = (await api.getCategoryGroups()).find(g => g.name === 'Bills')!;
  const make = (name: string) =>
    api.createCategory({
      name,
      group_id: group.id,
    } satisfies Parameters<typeof api.createCategory>[0]);
  const [a, b, d] = [await make('A'), await make('B'), await make('D')];
  const income = (await api.getCategories()).find(c => c.is_income)!.id;
  const account = (await api.getAccounts())[0].id;
  await api.addTransactions(account, [
    { date: `${MONTH}-01`, amount: 100000, category: income },
  ]);
  await api.updateNote(a, '#template 100');
  await api.updateNote(b, '#goal 500');
  await api.updateNote(d, '#template 80');
  await api.setBudgetAmount(MONTH, d, 30);
  return { a, b, d };
}

describe('Apply budget templates', () => {
  it('Applies to unbudgeted categories, auditing each cell with its goal', async () => {
    await start();
    const { a, b, d } = await fixture();
    const res = await apply({ month: MONTH });
    expect(res.isError, res.text).toBe(false);
    expect(await budgetedNow(a)).toBe(10000);
    expect(await budgetedNow(d)).toBe(30);
    expect(res.json.applied).toEqual(
      expect.arrayContaining([`${a}:${MONTH}`, `${b}:${MONTH}`]),
    );
    expect(res.json.applied).not.toContain(`${d}:${MONTH}`);

    const [attempt, outcome] = lines();
    expect(attempt).toMatchObject({
      tool: 'write_apply_budget_templates',
      phase: 'attempt',
      schema: 2,
      month: MONTH,
      mode: 'apply',
    });
    // Each cell's budgeted amount and goal, before and after
    expect(attempt.changes).toEqual(
      expect.arrayContaining([
        { id: a, field: `budgeted:${MONTH}`, before: 0, after: 10000 },
        { id: a, field: `goal:${MONTH}`, before: null, after: 10000 },
        { id: b, field: `goal:${MONTH}`, before: null, after: 50000 },
      ]),
    );
    // The automations stored from the notes are bound too
    expect(attempt.changes.map((c: { field: string }) => c.field)).toContain(
      'automation',
    );
    expect(outcome).toMatchObject({ status: 'ok' });
    expect(outcome.applied).toEqual(res.json.applied);
  });

  it('Overwrite also runs categories that are already budgeted', async () => {
    await start();
    const { a, d } = await fixture();
    const res = await apply({
      month: MONTH,
      mode: 'overwrite',
    });
    expect(res.isError, res.text).toBe(false);
    expect(await budgetedNow(a)).toBe(10000);
    expect(await budgetedNow(d)).toBe(8000);
  });

  it('Runs only the listed categories, overwriting them', async () => {
    await start();
    const { a, d } = await fixture();
    const res = await apply({
      month: MONTH,
      category_ids: [d],
    });
    expect(res.isError, res.text).toBe(false);
    expect(await budgetedNow(d)).toBe(8000);
    expect(await budgetedNow(a)).toBe(0);
  });

  it('Changes nothing, and logs nothing, when there is nothing to apply', async () => {
    await start();
    const res = await apply({ month: MONTH });
    expect(res.isError, res.text).toBe(false);
    expect(res.json).toMatchObject({ changed: 0, cells: [] });
    expect(lines()).toEqual([]);
  });

  it('Reports a template error and writes nothing', async () => {
    await start();
    const { a } = await fixture();
    await api.updateNote(a, '#template schedule nosuch');
    const res = await apply({ month: MONTH });
    expect(res.isError, res.text).toBe(false);
    expect(res.json.changed).toBe(0);
    expect(res.json.text.errors.join(' ')).toContain('A');
    expect(await budgetedNow(a)).toBe(0);
    expect(lines()).toEqual([]);
  });

  it('Counts the cells that change against the cell limit', async () => {
    await start({}, { maxCells: 1 });
    const { a } = await fixture();
    const res = await apply({ month: MONTH });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/At most 1 budget cells.*would change 2/);
    expect(await budgetedNow(a)).toBe(0);
    expect(lines()).toEqual([]);
  });

  it('Needs budget:write', async () => {
    await start({ scopes: ['budget:read'] });
    const res = await apply({ month: MONTH });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/needs budget:write/);
  });

  it('Cannot be undone', async () => {
    await start();
    const { a } = await fixture();
    const done = await apply({
      month: MONTH,
    });
    const undo = await h.call('write_undo', { write_id: done.json.write_id });
    expect(undo.isError).toBe(true);
    expect(await budgetedNow(a)).toBe(10000);
  });

  it('A store-only plan with a throwing engine is a failure, not ok', async () => {
    await start();
    const { a, b } = await fixture();
    // A is already budgeted, so only its automation would be stored
    await api.setBudgetAmount(MONTH, a, 10000);
    await api.updateNote(b, '');
    vi.spyOn(api, 'applyBudgetTemplates').mockRejectedValue(new Error('boom'));
    const res = await apply({ month: MONTH });
    expect(res.isError, res.text).toBe(false);
    expect(res.json.failed).toBeTruthy();
    expect(res.json.failure).toMatch(/may have been written/);
    expect(lines()[1]).toMatchObject({ status: 'failed' });
  });

  it('A plan that changed with no cells still names a failure', async () => {
    await start();
    const { a, b } = await fixture();
    await api.setBudgetAmount(MONTH, a, 10000);
    await api.updateNote(b, '');
    const real = api.planBudgetTemplates;
    let calls = 0;
    vi.spyOn(api, 'planBudgetTemplates').mockImplementation(async (...args) => {
      const plan = await real(...args);
      return ++calls <= 2 ? plan : { ...plan, errors: ['x'] };
    });
    const res = await apply({ month: MONTH });
    expect(res.json.failed).toBeTruthy();
    expect(lines()[1]).toMatchObject({ status: 'failed' });
  });

  it('A goal the engine did not write is not applied, and a throw says maybe written', async () => {
    await start();
    const { a, b } = await fixture();
    // The engine writes budgets and goals in separate batches: budgets land, then it throws
    vi.spyOn(api, 'applyBudgetTemplates').mockImplementation(async () => {
      await api.setBudgetAmount(MONTH, a, 10000);
      throw new Error('boom');
    });
    const res = await apply({ month: MONTH });
    expect(res.json.applied).not.toContain(`${a}:${MONTH}`);
    expect(res.json.applied).not.toContain(`${b}:${MONTH}`);
    expect(res.json.failed).toBeTruthy();
    expect(res.json.failure).toMatch(/may have been written/);
    expect(lines()[1]).toMatchObject({ status: 'failed' });
  });

  it('A throw after every write still says maybe written', async () => {
    await start();
    await fixture();
    const real = api.applyBudgetTemplates;
    vi.spyOn(api, 'applyBudgetTemplates').mockImplementation(
      async (...args) => {
        await real(...args);
        throw new Error('boom');
      },
    );
    const res = await apply({ month: MONTH });
    expect(res.json.failed).toBeTruthy();
    expect(res.json.failure).toMatch(/may have been written/);
    expect(res.json.applied.length).toBeGreaterThan(0);
  });

  it('Stops when the plan changed between the check and the write', async () => {
    await start();
    const { a } = await fixture();
    const real = api.planBudgetTemplates;
    let calls = 0;
    vi.spyOn(api, 'planBudgetTemplates').mockImplementation(async (...args) => {
      const plan = await real(...args);
      // a sync from another device changes a goal after the first check
      return ++calls <= 2
        ? plan
        : { ...plan, cells: plan.cells.map(c => ({ ...c, goalAfter: 1 })) };
    });
    const res = await apply({ month: MONTH });
    vi.restoreAllMocks();
    expect(res.json.applied).toEqual([]);
    expect(res.json.failed).toBeTruthy();
    expect(await budgetedNow(a)).toBe(0);
    expect(lines()[1]).toMatchObject({ status: 'failed', applied: [] });
  });

  describe('under confirm_destructive', () => {
    it('Shows every cell and automation first, then writes on confirm', async () => {
      await start({ confirm_destructive: true });
      const { a, b } = await fixture();
      const dry = await h.call('write_apply_budget_templates', {
        month: MONTH,
      });
      expect(dry.json.dry_run).toBe(true);
      expect(dry.json.ids).toEqual(
        expect.arrayContaining([`${a}:${MONTH}`, `${b}:${MONTH}`]),
      );
      expect(dry.json.text.cells).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            cell: `${a}:${MONTH}`,
            category: 'A',
            group: 'Bills',
            before: 0,
            after: 10000,
            goal_after: 10000,
          }),
        ]),
      );
      expect(
        dry.json.text.changes.map((c: { field: string }) => c.field),
      ).toContain('automation');
      expect(await budgetedNow(a)).toBe(0);
      expect(lines()).toEqual([]);

      const done = await h.call('write_apply_budget_templates', {
        month: MONTH,
        confirm: dry.json.confirm,
      });
      expect(done.isError, done.text).toBe(false);
      expect(await budgetedNow(a)).toBe(10000);
    });

    it('Refuses a confirm after a template line changed a goal only', async () => {
      await start({ confirm_destructive: true });
      const { a, b } = await fixture();
      const dry = await h.call('write_apply_budget_templates', {
        month: MONTH,
      });
      // The budgeted cells stay the same; only B's goal differs
      await api.updateNote(b, '#goal 600');
      const res = await h.call('write_apply_budget_templates', {
        month: MONTH,
        confirm: dry.json.confirm,
      });
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/changed since the dry run/);
      expect(await budgetedNow(a)).toBe(0);
      expect(lines()).toEqual([]);
    });

    it('Refuses a dry run too large to show, with no confirm', async () => {
      await start(
        { confirm_destructive: true },
        { maxResponseBytes: 1500, maxCells: 100, cellsCeiling: 100 },
      );
      await fixture();
      const res = await h.call('write_apply_budget_templates', {
        month: MONTH,
      });
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/more than fits in one response/);
      expect(res.text).not.toMatch(/confirm"/);
      expect(lines()).toEqual([]);
    });
  });
});
