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

async function cats(names: string[]) {
  const group = (await api.getCategoryGroups()).find(g => g.name === 'Bills')!;
  const out: string[] = [];
  for (const name of names) {
    out.push(
      await api.createCategory({
        name,
        group_id: group.id,
      } satisfies Parameters<typeof api.createCategory>[0]),
    );
  }
  return out;
}

async function budgetedNow(month: string, category: string) {
  const m = await api.getBudgetMonth(month);
  return Number(
    m.categoryGroups
      .flatMap(g => g.categories ?? [])
      .find(c => c.id === category)!.budgeted ?? 0,
  );
}

const PREV = '2026-02';
const MONTH = '2026-03';

/** A, B and C budgeted in February; March already holds A's amount. */
async function februaryBudget() {
  const [a, b, c] = await cats(['A', 'B', 'C']);
  await api.setBudgetAmount(PREV, a, 100);
  await api.setBudgetAmount(PREV, b, 200);
  await api.setBudgetAmount(PREV, c, 300);
  await api.setBudgetAmount(MONTH, a, 100);
  return { a, b, c };
}

describe('Copy last month', () => {
  it('Writes only the cells that change, with before and after', async () => {
    await start();
    const { a, b, c } = await februaryBudget();
    const res = await h.call('write_copy_budget_month', { month: MONTH });
    expect(res.isError, res.text).toBe(false);
    expect(res.json.cells).toMatchObject([
      { month: MONTH, category_id: b, before: 0, after: 200 },
      { month: MONTH, category_id: c, before: 0, after: 300 },
    ]);
    expect(res.json.applied).toEqual([`${b}:${MONTH}`, `${c}:${MONTH}`]);
    expect(await budgetedNow(MONTH, a)).toBe(100);
    expect(await budgetedNow(MONTH, b)).toBe(200);
    expect(await budgetedNow(MONTH, c)).toBe(300);

    const [attempt, outcome] = lines();
    expect(attempt).toMatchObject({
      tool: 'write_copy_budget_month',
      phase: 'attempt',
      schema: 2,
      month: MONTH,
      ids: [`${b}:${MONTH}`, `${c}:${MONTH}`],
      changes: [
        { id: b, field: `budgeted:${MONTH}`, before: 0, after: 200 },
        { id: c, field: `budgeted:${MONTH}`, before: 0, after: 300 },
      ],
    });
    expect(outcome).toMatchObject({
      status: 'ok',
      applied: [`${b}:${MONTH}`, `${c}:${MONTH}`],
    });
    expect(outcome.call_id).toBe(res.json.write_id);
  });

  it('Skips hidden categories, and income in an envelope budget', async () => {
    await start();
    const { b } = await februaryBudget();
    const [hidden] = await cats(['Hidden']);
    const income = (await api.getCategories()).find(x => x.is_income)!.id;
    await api.setBudgetAmount(PREV, hidden, 50);
    await api.setBudgetAmount(PREV, income, 900);
    await api.updateCategory(hidden, { hidden: true });
    const res = await h.call('write_copy_budget_month', { month: MONTH });
    const ids = res.json.cells.map(
      (x: { category_id: string }) => x.category_id,
    );
    expect(ids).toContain(b);
    expect(ids).not.toContain(hidden);
    expect(ids).not.toContain(income);
    expect(await budgetedNow(MONTH, hidden)).toBe(0);
  });

  it('Includes income in a tracking budget', async () => {
    await start();
    await api.internal!.send('preferences/save', {
      id: 'budgetType',
      value: 'tracking',
    });
    await februaryBudget();
    const income = (await api.getCategories()).find(x => x.is_income)!.id;
    await api.setBudgetAmount(PREV, income, 900);
    const res = await h.call('write_copy_budget_month', { month: MONTH });
    expect(res.json.cells).toContainEqual(
      expect.objectContaining({ category_id: income, before: 0, after: 900 }),
    );
    expect(await budgetedNow(MONTH, income)).toBe(900);
  });

  it('Changes nothing, and logs nothing, when no cell would change', async () => {
    await start();
    const [a] = await cats(['A']);
    await api.setBudgetAmount(PREV, a, 100);
    await api.setBudgetAmount(MONTH, a, 100);
    const res = await h.call('write_copy_budget_month', { month: MONTH });
    expect(res.isError).toBe(false);
    expect(res.json).toMatchObject({ cells: [], changed: 0 });
    expect(lines()).toEqual([]);
  });

  it('Counts only the cells that change against the cell limit', async () => {
    await start({}, { maxCells: 2 });
    const { b, c } = await februaryBudget();
    const ok = await h.call('write_copy_budget_month', { month: MONTH });
    expect(ok.isError, ok.text).toBe(false);
    expect(ok.json.applied).toHaveLength(2);

    const [d] = await cats(['D']);
    await api.setBudgetAmount(PREV, d, 40);
    await api.setBudgetAmount(PREV, b, 1);
    await api.setBudgetAmount(PREV, c, 2);
    const before = lines().length;
    const over = await h.call('write_copy_budget_month', { month: MONTH });
    expect(over.isError).toBe(true);
    expect(over.text).toMatch(/At most 2 budget cells.*would change 3/);
    expect(lines()).toHaveLength(before);
    expect(await budgetedNow(MONTH, d)).toBe(0);
  });

  it('Needs budget:write', async () => {
    await start({ scopes: ['budget:read'] });
    const res = await h.call('write_copy_budget_month', { month: MONTH });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/needs budget:write/);
  });

  it('A month that is not real is refused', async () => {
    await start();
    const res = await h.call('write_copy_budget_month', { month: '2026-13' });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/real month/);
  });

  describe('under confirm_destructive', () => {
    it('Shows every cell first and writes them on confirm', async () => {
      await start({ confirm_destructive: true });
      const { b, c } = await februaryBudget();
      const dry = await h.call('write_copy_budget_month', { month: MONTH });
      expect(dry.json.dry_run).toBe(true);
      expect(dry.json.ids).toEqual([`${b}:${MONTH}`, `${c}:${MONTH}`]);
      expect(dry.json.text.changes).toMatchObject([
        { id: b, field: `budgeted:${MONTH}`, before: 0, after: 200 },
        { id: c, field: `budgeted:${MONTH}`, before: 0, after: 300 },
      ]);
      // Readable for a person: the names beside each cell
      expect(dry.json.text.cells).toMatchObject([
        {
          cell: `${b}:${MONTH}`,
          category: 'B',
          group: 'Bills',
          before: 0,
          after: 200,
        },
        {
          cell: `${c}:${MONTH}`,
          category: 'C',
          group: 'Bills',
          before: 0,
          after: 300,
        },
      ]);
      expect(await budgetedNow(MONTH, b)).toBe(0);
      expect(lines()).toEqual([]);

      const done = await h.call('write_copy_budget_month', {
        month: MONTH,
        confirm: dry.json.confirm,
      });
      expect(done.isError, done.text).toBe(false);
      expect(await budgetedNow(MONTH, b)).toBe(200);
      expect(await budgetedNow(MONTH, c)).toBe(300);
    });

    it('Refuses a dry run too large to show, with no confirm', async () => {
      await start(
        { confirm_destructive: true },
        { maxCells: 100, cellsCeiling: 100, maxResponseBytes: 4000 },
      );
      const ids = await cats(Array.from({ length: 40 }, (_, i) => `K${i}`));
      for (const id of ids) await api.setBudgetAmount(PREV, id, 10);
      const res = await h.call('write_copy_budget_month', { month: MONTH });
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/40 cells/);
      expect(res.text).not.toMatch(/confirm"/);
      expect(await budgetedNow(MONTH, ids[0])).toBe(0);
      expect(lines()).toEqual([]);
    });

    it('Refuses a confirm after a cell changed', async () => {
      await start({ confirm_destructive: true });
      const { b } = await februaryBudget();
      const dry = await h.call('write_copy_budget_month', { month: MONTH });
      await api.setBudgetAmount(MONTH, b, 77);
      const res = await h.call('write_copy_budget_month', {
        month: MONTH,
        confirm: dry.json.confirm,
      });
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/budget changed since the dry run/);
      expect(await budgetedNow(MONTH, b)).toBe(77);
      expect(lines()).toEqual([]);
    });
  });

  it('A cell changed between recompute and write stops the rest', async () => {
    await start();
    const { a, b, c } = await februaryBudget();
    // a fourth changing cell, so one is applied, one fails and one is not written
    const [d] = await cats(['D']);
    await api.setBudgetAmount(PREV, d, 40);
    const real = api.setBudgetAmount;
    let first = true;
    vi.spyOn(api, 'setBudgetAmount').mockImplementation(async (...args) => {
      await real(...args);
      if (first) {
        first = false;
        // a sync from another device changes the cells still to come
        for (const x of [a, b, c, d]) {
          if (x !== args[1]) await real(MONTH, x, 999);
        }
      }
    });
    const res = await h.call('write_copy_budget_month', { month: MONTH });
    expect(res.json.applied, res.text).toHaveLength(1);
    expect(res.json.failed).toBeTruthy();
    expect(res.json.not_written).toHaveLength(1);
    vi.restoreAllMocks();
    const [written] = res.json.applied as string[];
    const [failed] = [res.json.failed, ...res.json.not_written] as string[];
    expect(await budgetedNow(MONTH, written.split(':')[0])).not.toBe(999);
    expect(await budgetedNow(MONTH, failed.split(':')[0])).toBe(999);
    expect(lines()[1]).toMatchObject({ status: 'failed', applied: [written] });
  });

  it('Is undone by write_undo', async () => {
    await start();
    const { a, b, c } = await februaryBudget();
    const done = await h.call('write_copy_budget_month', { month: MONTH });
    const undo = await h.call('write_undo', { write_id: done.json.write_id });
    expect(undo.isError, undo.text).toBe(false);
    expect(undo.json.restored).toBe(2);
    expect(await budgetedNow(MONTH, a)).toBe(100);
    expect(await budgetedNow(MONTH, b)).toBe(0);
    expect(await budgetedNow(MONTH, c)).toBe(0);
  });

  it('Is not undone after an applied cell was edited', async () => {
    await start();
    const { b } = await februaryBudget();
    const done = await h.call('write_copy_budget_month', { month: MONTH });
    await api.setBudgetAmount(MONTH, b, 5);
    const undo = await h.call('write_undo', { write_id: done.json.write_id });
    expect(undo.isError).toBe(true);
    expect(await budgetedNow(MONTH, b)).toBe(5);
  });
});

const AVG_MONTH = '2026-07';

/** Spending of 100, 200, ... 600 in January to June, so the 3 and 6 month averages differ. */
async function spending() {
  const [a, b] = await cats(['A', 'B']);
  const account = (await api.getAccounts())[0].id;
  const rows = Array.from({ length: 6 }, (_, i) => ({
    date: `2026-${String(i + 1).padStart(2, '0')}-10`,
    amount: -(i + 1) * 100,
    category: a,
  }));
  await api.addTransactions(account, rows);
  await api.setBudgetAmount(AVG_MONTH, a, 1);
  return { a, b };
}

describe('Set to the average', () => {
  // The average starts from the month before the current one
  beforeEach(() => {
    global.currentMonth = '2026-08';
  });
  afterEach(() => {
    global.currentMonth = '2026-01';
  });

  it.each([
    [3, 500],
    [6, 350],
    [12, 350],
  ] as const)('The %i month average', async (months, expected) => {
    await start();
    const { a, b } = await spending();
    const res = await h.call('write_set_budget_to_average', {
      month: AVG_MONTH,
      months,
    });
    expect(res.isError, res.text).toBe(false);
    // B had no spending and no budget, so its average equals its amount: not a change
    expect(res.json.cells).toMatchObject([
      { month: AVG_MONTH, category_id: a, before: 1, after: expected },
    ]);
    expect(await budgetedNow(AVG_MONTH, a)).toBe(expected);
    expect(await budgetedNow(AVG_MONTH, b)).toBe(0);
    expect(lines()[0]).toMatchObject({
      tool: 'write_set_budget_to_average',
      month: AVG_MONTH,
      average_months: months,
      ids: [`${a}:${AVG_MONTH}`],
      changes: [
        { id: a, field: `budgeted:${AVG_MONTH}`, before: 1, after: expected },
      ],
    });
  });

  it('Refuses a number of months other than 3, 6 or 12', async () => {
    await start();
    const res = await h.call('write_set_budget_to_average', {
      month: AVG_MONTH,
      months: 4,
    });
    expect(res.isError).toBe(true);
  });

  it('Needs budget:write', async () => {
    await start({ scopes: ['budget:read'] });
    const res = await h.call('write_set_budget_to_average', {
      month: AVG_MONTH,
      months: 3,
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/needs budget:write/);
  });

  it('Shows the cells first, and a confirm is bound to the months', async () => {
    await start({ confirm_destructive: true });
    const { a } = await spending();
    const dry = await h.call('write_set_budget_to_average', {
      month: AVG_MONTH,
      months: 3,
    });
    expect(dry.json.dry_run).toBe(true);
    expect(dry.json.text.changes).toMatchObject([
      { id: a, field: `budgeted:${AVG_MONTH}`, before: 1, after: 500 },
    ]);
    expect(await budgetedNow(AVG_MONTH, a)).toBe(1);

    const other = await h.call('write_set_budget_to_average', {
      month: AVG_MONTH,
      months: 6,
      confirm: dry.json.confirm,
    });
    expect(other.isError).toBe(true);
    expect(await budgetedNow(AVG_MONTH, a)).toBe(1);

    const done = await h.call('write_set_budget_to_average', {
      month: AVG_MONTH,
      months: 3,
      confirm: dry.json.confirm,
    });
    expect(done.isError, done.text).toBe(false);
    expect(await budgetedNow(AVG_MONTH, a)).toBe(500);
  });

  it('Is undone by write_undo', async () => {
    await start();
    const { a } = await spending();
    const done = await h.call('write_set_budget_to_average', {
      month: AVG_MONTH,
      months: 3,
    });
    const undo = await h.call('write_undo', { write_id: done.json.write_id });
    expect(undo.isError, undo.text).toBe(false);
    expect(await budgetedNow(AVG_MONTH, a)).toBe(1);
  });
});
