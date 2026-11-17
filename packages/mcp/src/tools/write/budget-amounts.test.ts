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
    const found = (await api.getCategories()).find(c => c.name === name);
    out.push(
      found
        ? found.id
        : await api.createCategory({
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

const cell = (month: string, category_id: string, amount: number) => ({
  month,
  category_id,
  amount,
});

describe('Set many budget amounts', () => {
  it('Before and after', async () => {
    await start();
    const [a, b] = await cats(['A', 'B']);
    const res = await h.call('write_set_budget_amounts', {
      cells: [cell('2026-02', a, 100), cell('2026-03', b, 250)],
    });
    expect(res.isError, res.text).toBe(false);
    expect(res.json.cells).toMatchObject([
      { month: '2026-02', category_id: a, before: 0, after: 100 },
      { month: '2026-03', category_id: b, before: 0, after: 250 },
    ]);
    expect(await budgetedNow('2026-02', a)).toBe(100);
    expect(await budgetedNow('2026-03', b)).toBe(250);

    const [attempt, outcome] = lines();
    expect(attempt).toMatchObject({
      tool: 'write_set_budget_amounts',
      phase: 'attempt',
      schema: 2,
      ids: [`${a}:2026-02`, `${b}:2026-03`],
      changes: [
        { id: a, field: 'budgeted:2026-02', before: 0, after: 100 },
        { id: b, field: 'budgeted:2026-03', before: 0, after: 250 },
      ],
    });
    expect(outcome).toMatchObject({
      status: 'ok',
      applied: [`${a}:2026-02`, `${b}:2026-03`],
    });
    expect(outcome.call_id).toBe(res.json.write_id);
  });

  it('A bad cell changes nothing', async () => {
    await start();
    const [a, b] = await cats(['A', 'B']);
    const res = await h.call('write_set_budget_amounts', {
      cells: [
        cell('2026-02', a, 100),
        cell('2026-02', 'no-such-category', 5),
        cell('2026-02', b, 7),
      ],
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/category_id must be the id of an existing/);
    expect(await budgetedNow('2026-02', a)).toBe(0);
    expect(lines()).toEqual([]);
  });

  it.each([
    ['a month that is not real', cell('2026-13', 'X', 1)],
    ['a fractional amount', cell('2026-02', 'X', 1.5)],
    ['an unsafe amount', cell('2026-02', 'X', 1e15)],
  ])('refuses %s before any audit line', async (_, bad) => {
    await start();
    const [a] = await cats(['A']);
    const res = await h.call('write_set_budget_amounts', {
      cells: [cell('2026-02', a, 1), { ...bad, category_id: a }],
    });
    expect(res.isError).toBe(true);
    expect(await budgetedNow('2026-02', a)).toBe(0);
    expect(lines()).toEqual([]);
  });

  it('A duplicate cell', async () => {
    await start();
    const [a] = await cats(['A']);
    const res = await h.call('write_set_budget_amounts', {
      cells: [cell('2026-02', a, 1), cell('2026-02', a, 2)],
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/appear only once/);
    expect(lines()).toEqual([]);
    // the same category in two months is two cells
    const ok = await h.call('write_set_budget_amounts', {
      cells: [cell('2026-02', a, 1), cell('2026-03', a, 2)],
    });
    expect(ok.isError).toBe(false);
  });

  it('Over the cell limit', async () => {
    await start({}, { maxCells: 3 });
    const [a] = await cats(['A']);
    const res = await h.call('write_set_budget_amounts', {
      cells: ['01', '02', '03', '04'].map(m => cell(`2026-${m}`, a, 1)),
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/At most 3 budget cells.*would change 4/);
    expect(lines()).toEqual([]);
  });

  it('Rows are not cells', async () => {
    await start({ max_rows: 1 });
    const [a] = await cats(['A']);
    const res = await h.call('write_set_budget_amounts', {
      cells: ['01', '02', '03'].map(m => cell(`2026-${m}`, a, 1)),
    });
    expect(res.isError, res.text).toBe(false);
  });

  it('A grant cell limit overrides the setting', async () => {
    await start({ max_cells: 2 }, { maxCells: 100 });
    const [a] = await cats(['A']);
    const res = await h.call('write_set_budget_amounts', {
      cells: ['01', '02', '03'].map(m => cell(`2026-${m}`, a, 1)),
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/At most 2 budget cells/);
  });

  it('The schema stops at the cell ceiling', async () => {
    await start({}, { cellsCeiling: 700 });
    const { tools } = await h.client.listTools();
    const t = tools.find(x => x.name === 'write_set_budget_amounts')!;
    expect(JSON.stringify(t.inputSchema)).toContain('"maxItems":700');
    expect(t.description).toContain('up to 500 cells');
  });

  it('Scope refusal', async () => {
    await start({ scopes: ['budget:read', 'transactions:write'] });
    const [a] = await cats(['A']);
    const res = await h.call('write_set_budget_amounts', {
      cells: [cell('2026-02', a, 1)],
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/needs budget:write/);
    expect(await budgetedNow('2026-02', a)).toBe(0);
  });

  it('Stops at an engine failure and names applied and failed cells', async () => {
    await start();
    const [a, b, c] = await cats(['A', 'B', 'C']);
    const real = api.setBudgetAmount;
    let calls = 0;
    vi.spyOn(api, 'setBudgetAmount').mockImplementation(async (...args) => {
      calls += 1;
      if (calls === 2) throw new Error('engine down');
      return real(...args);
    });
    const res = await h.call('write_set_budget_amounts', {
      cells: [
        cell('2026-02', a, 10),
        cell('2026-02', b, 20),
        cell('2026-02', c, 30),
      ],
    });
    expect(res.isError).toBe(false);
    expect(res.json).toMatchObject({
      applied: [`${a}:2026-02`],
      failed: `${b}:2026-02`,
      not_written: [`${c}:2026-02`],
    });
    expect(calls).toBe(2);
    vi.restoreAllMocks();
    expect(await budgetedNow('2026-02', a)).toBe(10);
    expect(await budgetedNow('2026-02', b)).toBe(0);
    expect(await budgetedNow('2026-02', c)).toBe(0);
    expect(lines()[1]).toMatchObject({
      status: 'failed',
      applied: [`${a}:2026-02`],
      failed: `${b}:2026-02`,
    });
  });

  it('A cell changed between plan and write stops the rest', async () => {
    await start();
    const [a, b, c] = await cats(['A', 'B', 'C']);
    const real = api.setBudgetAmount;
    let first = true;
    vi.spyOn(api, 'setBudgetAmount').mockImplementation(async (...args) => {
      await real(...args);
      if (first) {
        first = false;
        // a sync from another device changes the second cell
        await real('2026-02', b, 999);
      }
    });
    const res = await h.call('write_set_budget_amounts', {
      cells: [
        cell('2026-02', a, 10),
        cell('2026-02', b, 20),
        cell('2026-02', c, 30),
      ],
    });
    expect(res.json).toMatchObject({
      applied: [`${a}:2026-02`],
      failed: `${b}:2026-02`,
      not_written: [`${c}:2026-02`],
    });
    vi.restoreAllMocks();
    expect(await budgetedNow('2026-02', a)).toBe(10);
    expect(await budgetedNow('2026-02', b)).toBe(999);
    expect(await budgetedNow('2026-02', c)).toBe(0);
  });
  it('An engine throw after the cell was written counts it applied', async () => {
    await start();
    const [a, b, c] = await cats(['A', 'B', 'C']);
    const real = api.setBudgetAmount;
    let calls = 0;
    vi.spyOn(api, 'setBudgetAmount').mockImplementation(async (...args) => {
      calls += 1;
      await real(...args);
      if (calls === 2) throw new Error('timed out after the write');
    });
    const res = await h.call('write_set_budget_amounts', {
      cells: [
        cell('2026-02', a, 10),
        cell('2026-02', b, 20),
        cell('2026-02', c, 30),
      ],
    });
    expect(res.json).toMatchObject({
      applied: [`${a}:2026-02`, `${b}:2026-02`],
      failed: `${b}:2026-02`,
      not_written: [`${c}:2026-02`],
    });
    expect(res.json.failure).toMatch(/written/);
    expect(lines()[1]).toMatchObject({
      status: 'failed',
      applied: [`${a}:2026-02`, `${b}:2026-02`],
    });
    vi.restoreAllMocks();
    expect(await budgetedNow('2026-02', c)).toBe(0);
    const undo = await h.call('write_undo', { write_id: res.json.write_id });
    expect(undo.isError, undo.text).toBe(false);
    expect(await budgetedNow('2026-02', b)).toBe(0);
  });

  it('An engine throw whose cell cannot be read back is maybe written', async () => {
    await start();
    const [a, b] = await cats(['A', 'B']);
    const realSet = api.setBudgetAmount;
    const realGet = api.getBudgetMonth;
    let broken = false;
    vi.spyOn(api, 'setBudgetAmount').mockImplementation(async (...args) => {
      if (args[1] === b) {
        broken = true;
        throw new Error('engine down');
      }
      return realSet(...args);
    });
    vi.spyOn(api, 'getBudgetMonth').mockImplementation(async m => {
      if (broken) throw new Error('read failed');
      return realGet(m);
    });
    const res = await h.call('write_set_budget_amounts', {
      cells: [cell('2026-02', a, 10), cell('2026-02', b, 20)],
    });
    vi.restoreAllMocks();
    expect(res.isError, res.text).toBe(false);
    expect(res.json.failed).toBe(`${b}:2026-02`);
    expect(res.json.maybe_written).toBe(`${b}:2026-02`);
    expect(res.json.failure).toMatch(/may have been written/);
    expect(lines()[1]).toMatchObject({
      status: 'failed',
      maybe_written: `${b}:2026-02`,
    });
    const list = await h.call('list_writes');
    expect(list.json.writes[0].undoable).toBe(false);
  });
});
