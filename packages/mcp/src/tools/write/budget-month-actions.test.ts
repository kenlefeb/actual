import { existsSync, readFileSync } from 'fs';

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
  h = await startHarness(
    { count: 1 },
    { grant: { scopes: [...SCOPES], confirm_destructive: false, ...over } },
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

const rent = async () =>
  (await api.getCategories()).find(c => c.name === 'Rent')!.id;

/** Puts money into the month's to-budget: income in 2026-02. */
async function fund(amount: number) {
  const account = (await api.getAccounts())[0];
  const income = (await api.getCategories()).find(c => c.is_income)!;
  await api.addTransactions(account.id, [
    { date: '2026-02-05', amount, category: income.id },
  ]);
}

describe('Budget carryover', () => {
  it('Sets carryover from the start month on and audits it', async () => {
    await start();
    const id = await rent();
    const res = await h.call('write_set_budget_carryover', {
      month: '2026-02',
      category_id: id,
      flag: true,
    });
    expect(res.isError, res.text).toBe(false);
    expect(res.json).toMatchObject({ month: '2026-02', carryover: true });
    for (const m of ['2026-02', '2026-03']) {
      const cat = (await api.getBudgetMonth(m)).categoryGroups
        .flatMap(g => g.categories ?? [])
        .find(c => c.id === id)!;
      expect(cat.carryover).toBe(true);
    }
    const attempt = lines().find(
      l => l.tool === 'write_set_budget_carryover' && l.phase === 'attempt',
    );
    expect(attempt.changes).toMatchObject([
      { id, field: 'carryover:2026-02', before: false, after: true },
    ]);
    expect(attempt.months).toBeGreaterThan(1);
  });

  it('Is refused without budget:write', async () => {
    await start({ scopes: ['budget:read'] });
    const res = await h.call('write_set_budget_carryover', {
      month: '2026-02',
      category_id: await rent(),
      flag: true,
    });
    expect(res.isError).toBe(true);
    expect(lines().map(l => l.phase)).toEqual(['refused']);
  });

  it('Is not undoable', async () => {
    await start();
    const w = await h.call('write_set_budget_carryover', {
      month: '2026-02',
      category_id: await rent(),
      flag: true,
    });
    const undo = await h.call('write_undo', { write_id: w.json.write_id });
    expect(undo.isError).toBe(true);
    expect(undo.text).toContain('cannot be undone');
  });
});

describe('Budget hold', () => {
  it('Holds, reads back, and resets', async () => {
    await start();
    await fund(100000);
    const res = await h.call('write_hold_budget_for_next_month', {
      month: '2026-02',
      amount: 30000,
    });
    expect(res.isError, res.text).toBe(false);
    expect(res.json).toMatchObject({ held: true, for_next_month: 30000 });
    expect((await api.getBudgetMonth('2026-02')).forNextMonth).toBe(30000);
    const entry = lines().find(
      l =>
        l.tool === 'write_hold_budget_for_next_month' && l.phase === 'attempt',
    );
    expect(entry.changes).toMatchObject([
      { field: 'hold:2026-02', before: 0, after: 30000 },
    ]);

    const reset = await h.call('write_reset_budget_hold', { month: '2026-02' });
    expect(reset.isError, reset.text).toBe(false);
    expect(reset.json).toMatchObject({ for_next_month: 0 });
    expect((await api.getBudgetMonth('2026-02')).forNextMonth).toBe(0);
  });

  it('Reads back the clamped value', async () => {
    await start();
    await fund(100000);
    const res = await h.call('write_hold_budget_for_next_month', {
      month: '2026-02',
      amount: 500000,
    });
    expect(res.json).toMatchObject({ held: true, for_next_month: 100000 });
  });

  it('Says nothing was held when there is nothing to budget', async () => {
    await start();
    const res = await h.call('write_hold_budget_for_next_month', {
      month: '2026-02',
      amount: 10000,
    });
    expect(res.isError, res.text).toBe(false);
    expect(res.json).toMatchObject({ held: false, for_next_month: 0 });
    expect((await api.getBudgetMonth('2026-02')).forNextMonth).toBe(0);
  });

  it('Refuses in a tracking budget', async () => {
    await start();
    await api.internal!.send('preferences/save', {
      id: 'budgetType',
      value: 'tracking',
    });
    for (const [tool, args] of [
      ['write_hold_budget_for_next_month', { month: '2026-02', amount: 100 }],
      ['write_reset_budget_hold', { month: '2026-02' }],
    ] as const) {
      const res = await h.call(tool, args);
      expect(res.isError).toBe(true);
      expect(res.text).toContain('envelope');
    }
    expect(lines()).toEqual([]);
  });

  it('Is refused without budget:write', async () => {
    await start({ scopes: ['budget:read'] });
    const res = await h.call('write_reset_budget_hold', { month: '2026-02' });
    expect(res.isError).toBe(true);
  });

  it('Is not undoable', async () => {
    await start();
    await fund(100000);
    const w = await h.call('write_hold_budget_for_next_month', {
      month: '2026-02',
      amount: 100,
    });
    const undo = await h.call('write_undo', { write_id: w.json.write_id });
    expect(undo.isError).toBe(true);
  });
});
