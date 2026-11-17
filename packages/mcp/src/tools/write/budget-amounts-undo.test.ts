import * as api from '@actual-app/api';

import { startHarness } from '#client-harness';
import { SCOPES } from '#grants';
import type { Grant } from '#grants';

let h: Awaited<ReturnType<typeof startHarness>>;

afterEach(async () => {
  vi.restoreAllMocks();
  await h.close();
});

async function start(over: Partial<Grant> = {}) {
  const grant: Grant = {
    scopes: [...SCOPES],
    confirm_destructive: false,
    ...over,
  };
  h = await startHarness({ count: 1 }, { grant });
  return grant;
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

const cell = (month: string, category_id: string, amount: number) => ({
  month,
  category_id,
  amount,
});

const months = (n: number) =>
  Array.from({ length: n }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);

describe('Undo of budget cells', () => {
  it('A large write is undone', async () => {
    await start();
    const ids = await cats(Array.from({ length: 20 }, (_, i) => `K${i}`));
    const written = ids.flatMap((c, i) =>
      months(10).map(m => cell(m, c, 100 + i)),
    );
    expect(written).toHaveLength(200);
    const w = await h.call('write_set_budget_amounts', { cells: written });
    expect(w.isError, w.text).toBe(false);
    const undo = await h.call('write_undo', { write_id: w.json.write_id });
    expect(undo.isError, undo.text).toBe(false);
    expect(undo.json.restored).toBe(200);
    for (const c of ids) {
      for (const m of months(10)) expect(await budgetedNow(m, c)).toBe(0);
    }
  });

  it('Round trip, and only once', async () => {
    await start({ max_rows: 1 });
    const [a, b] = await cats(['A', 'B']);
    await api.setBudgetAmount('2026-02', a, 40);
    const w = await h.call('write_set_budget_amounts', {
      cells: [
        cell('2026-02', a, 100),
        cell('2026-02', b, 200),
        cell('2026-03', a, 300),
      ],
    });
    expect(w.isError, w.text).toBe(false);
    // three cells with a row limit of 1: cells are not rows
    const undo = await h.call('write_undo', { write_id: w.json.write_id });
    expect(undo.isError, undo.text).toBe(false);
    expect(await budgetedNow('2026-02', a)).toBe(40);
    expect(await budgetedNow('2026-02', b)).toBe(0);
    expect(await budgetedNow('2026-03', a)).toBe(0);
    const again = await h.call('write_undo', { write_id: w.json.write_id });
    expect(again.isError).toBe(true);
    expect(again.text).toMatch(/already undone/);
  });

  it('A write that stopped midway', async () => {
    await start();
    const [a] = await cats(['A']);
    const real = api.setBudgetAmount;
    let calls = 0;
    vi.spyOn(api, 'setBudgetAmount').mockImplementation(async (...args) => {
      calls += 1;
      if (calls === 2) throw new Error('engine down');
      return real(...args);
    });
    const w = await h.call('write_set_budget_amounts', {
      cells: [cell('2026-02', a, 10), cell('2026-03', a, 20)],
    });
    expect(w.json.failed).toBe(`${a}:2026-03`);
    vi.restoreAllMocks();
    // the second cell is changed by hand; it was never applied, so no conflict
    await api.setBudgetAmount('2026-03', a, 77);
    const list = await h.call('list_writes');
    expect(list.json.writes[0]).toMatchObject({ undoable: true });
    const undo = await h.call('write_undo', { write_id: w.json.write_id });
    expect(undo.isError, undo.text).toBe(false);
    expect(await budgetedNow('2026-02', a)).toBe(0);
    expect(await budgetedNow('2026-03', a)).toBe(77);
  });

  it('One applied cell changed since', async () => {
    await start();
    const [a, b] = await cats(['A', 'B']);
    const w = await h.call('write_set_budget_amounts', {
      cells: [cell('2026-02', a, 10), cell('2026-02', b, 20)],
    });
    await api.setBudgetAmount('2026-02', b, 21);
    const undo = await h.call('write_undo', { write_id: w.json.write_id });
    expect(undo.isError).toBe(true);
    expect(undo.text).toContain(`${b}:2026-02`);
    expect(await budgetedNow('2026-02', a)).toBe(10);
    expect(await budgetedNow('2026-02', b)).toBe(21);
  });

  it('An undo over the cell limit is refused, naming it', async () => {
    const grant = await start();
    const [a] = await cats(['A']);
    const w = await h.call('write_set_budget_amounts', {
      cells: months(3).map(m => cell(m, a, 5)),
    });
    expect(w.isError, w.text).toBe(false);
    grant.max_cells = 2;
    const undo = await h.call('write_undo', { write_id: w.json.write_id });
    expect(undo.isError).toBe(true);
    expect(undo.text).toMatch(/At most 2 budget cells.*would change 3/);
    expect(await budgetedNow('2026-01', a)).toBe(5);
  });
});
