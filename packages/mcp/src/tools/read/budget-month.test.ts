import * as api from '@actual-app/api';

import { startHarness } from '#client-harness';

let h: Awaited<ReturnType<typeof startHarness>>;

afterEach(async () => {
  await h.close();
});

const MONTH = '2026-01';

type Cat = { id: string };
type Group = { id: string; categories: Cat[] };

async function addGroup(name: string, categories: number) {
  const id = await api.createCategoryGroup({ name });
  for (let i = 0; i < categories; i++) {
    await api.createCategory({ name: `${name} ${i}`, group_id: id });
  }
  return id;
}

async function monthCategoryCount() {
  const m = await api.getBudgetMonth(MONTH);
  return m.categoryGroups.reduce((n, g) => n + (g.categories ?? []).length, 0);
}

describe('get_budget_month paging', () => {
  it('A month larger than one page', async () => {
    h = await startHarness();
    // Six groups with 120 categories in all, however many the fixture and a
    // new budget start with
    const base = await monthCategoryCount();
    for (let i = 0; i < 4; i++) {
      await addGroup(`Group ${i}`, 20);
    }
    await addGroup('Group 4', 120 - base - 80);
    expect(await monthCategoryCount()).toBe(120);

    const pages: Array<{
      groups: Group[];
      has_more: boolean;
      next_cursor: string | null;
      category_count: number;
      to_budget: number;
      total_budgeted: number;
      total_spent: number;
      total_balance: number;
      total_income: number;
    }> = [];
    let cursor: string | undefined;
    do {
      const res = await h.call('get_budget_month', { month: MONTH, cursor });
      expect(res.isError).toBe(false);
      pages.push(res.json);
      cursor = res.json.next_cursor ?? undefined;
    } while (cursor);

    const count = (p: (typeof pages)[number]) =>
      p.groups.reduce((n, g) => n + g.categories.length, 0);
    expect(pages.map(count)).toEqual([50, 50, 20]);
    expect(pages.map(p => p.has_more)).toEqual([true, true, false]);

    // Every category exactly once, each under its own group
    const expected = (await api.getBudgetMonth(MONTH)).categoryGroups;
    const owner = new Map(
      expected.flatMap(g => (g.categories ?? []).map(c => [c.id, g.id])),
    );
    const seen = pages.flatMap(p =>
      p.groups.flatMap(g =>
        g.categories.map(c => {
          expect(owner.get(c.id)).toBe(g.id);
          return c.id;
        }),
      ),
    );
    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);

    // The same whole-month totals and count on every page
    for (const p of pages) {
      expect(p.category_count).toBe(120);
      expect({
        to_budget: p.to_budget,
        total_budgeted: p.total_budgeted,
        total_spent: p.total_spent,
        total_balance: p.total_balance,
        total_income: p.total_income,
      }).toEqual({
        to_budget: pages[0].to_budget,
        total_budgeted: pages[0].total_budgeted,
        total_spent: pages[0].total_spent,
        total_balance: pages[0].total_balance,
        total_income: pages[0].total_income,
      });
    }

    // A group that straddles a page boundary appears on both pages
    const pageIdsByGroup = new Map<string, number>();
    for (const p of pages) {
      for (const g of p.groups) {
        pageIdsByGroup.set(g.id, (pageIdsByGroup.get(g.id) ?? 0) + 1);
      }
    }
    expect([...pageIdsByGroup.values()].some(n => n > 1)).toBe(true);
  });

  it('An empty group appears on the first page only', async () => {
    h = await startHarness();
    const empty = await addGroup('Empty', 0);
    await addGroup('Big', 120);

    const first = await h.call('get_budget_month', { month: MONTH });
    const second = await h.call('get_budget_month', {
      month: MONTH,
      cursor: first.json.next_cursor,
    });
    expect(first.json.groups.map((g: Group) => g.id)).toContain(empty);
    expect(second.json.groups.map((g: Group) => g.id)).not.toContain(empty);
  });

  it('A small month is one page', async () => {
    h = await startHarness();
    await addGroup('Few', 12);
    const res = await h.call('get_budget_month', { month: MONTH });

    expect(res.json.has_more).toBe(false);
    expect(res.json.next_cursor).toBe(null);
    const total = res.json.groups.reduce(
      (n: number, g: Group) => n + g.categories.length,
      0,
    );
    expect(total).toBe(await monthCategoryCount());
    expect(res.json.category_count).toBe(total);
  });

  it('A malformed cursor', async () => {
    h = await startHarness();
    const res = await h.call('get_budget_month', {
      month: MONTH,
      cursor: 'not-a-cursor',
    });

    expect(res.isError).toBe(true);
    expect(res.text).toContain('get_budget_month failed');
    expect(res.json).toBe(null);
  });
});
