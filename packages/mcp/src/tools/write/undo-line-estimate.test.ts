import { existsSync, readFileSync } from 'fs';

import * as api from '@actual-app/api';

import { startHarness } from '#client-harness';
import { SCOPES } from '#grants';

import { UNDOABLE } from './declarations';
import { lineBytes } from './shared';

/** Worst-case text: quotes and backslashes (escaped in JSON) and multi-byte characters. */
const W = '\\"é😀';
const NAME = W.repeat(20); // 100 UTF-16 units, the name limit
const NOTES = W.repeat(200); // 1,000, the notes limit

let h: Awaited<ReturnType<typeof startHarness>> | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  global.currentMonth = '2026-01';
  await h?.close();
});

function lines() {
  if (!existsSync(h!.auditLog)) return [];
  return readFileSync(h!.auditLog, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));
}

async function call(tool: string, args: Record<string, unknown>) {
  const res = await h!.call(tool, args);
  expect(res.isError, res.text).toBe(false);
  return res.json as { write_id: string };
}

const MONTH = '2026-03';

async function bills() {
  return (await api.getCategoryGroups()).find(g => g.name === 'Bills')!;
}

async function category(name: string, group?: string) {
  return api.createCategory({
    name,
    group_id: group ?? (await bills()).id,
  } satisfies Parameters<typeof api.createCategory>[0]);
}

async function firstRow() {
  const { data } = (await api.runQuery(
    api.q('transactions').select(['id']).orderBy(['date', 'id']),
  )) as { data: Array<{ id: string }> };
  return data[0].id;
}

/** Each undoable tool, with a write of worst-case content. */
const WRITES: Record<string, () => Promise<{ write_id: string }>> = {
  write_update_transactions: async () =>
    call('write_update_transactions', {
      updates: [{ id: await firstRow(), notes: NOTES }],
    }),
  write_create_transactions: async () =>
    call('write_create_transactions', {
      account_id: h!.fixture.accountId,
      transactions: [
        { date: '2026-01-05', amount: -100, notes: NOTES },
        { date: '2026-01-06', amount: 100, notes: NOTES },
      ],
    }),
  write_set_budget_amount: async () =>
    call('write_set_budget_amount', {
      month: MONTH,
      category_id: await category('A'),
      amount: -1e12,
    }),
  write_set_budget_amounts: async () => {
    const [a, b] = [await category('A'), await category('B')];
    return call('write_set_budget_amounts', {
      cells: [
        { month: MONTH, category_id: a, amount: -1e12 },
        { month: '2026-04', category_id: b, amount: 1e12 },
      ],
    });
  },
  write_copy_budget_month: async () => {
    await api.setBudgetAmount('2026-02', await category('A'), 123456789);
    return call('write_copy_budget_month', { month: MONTH });
  },
  write_set_budget_to_average: async () => {
    const a = await category('A');
    await api.addTransactions(h!.fixture.accountId, [
      { date: '2026-02-10', amount: -987654, category: a },
    ]);
    // The average starts from the month before the current one
    global.currentMonth = '2026-04';
    return call('write_set_budget_to_average', { month: '2026-04', months: 3 });
  },
  write_update_category: async () =>
    call('write_update_category', {
      category_id: await category('A'),
      name: NAME,
      hidden: true,
    }),
  write_update_category_group: async () =>
    call('write_update_category_group', {
      group_id: await api.createCategoryGroup({ name: 'G' }),
      name: NAME,
      hidden: true,
    }),
  write_create_category: async () =>
    call('write_create_category', { name: NAME, group_id: (await bills()).id }),
  write_create_category_group: async () =>
    call('write_create_category_group', { name: NAME }),
  write_delete_transactions: async () => {
    const id = await firstRow();
    await api.updateTransaction(id, { notes: NOTES });
    return call('write_delete_transactions', { ids: [id] });
  },
  write_delete_category: async () =>
    call('write_delete_category', { category_id: await category(NAME) }),
  write_delete_category_group: async () => {
    const g = await api.createCategoryGroup({ name: NAME });
    await category(NAME, g);
    return call('write_delete_category_group', { group_id: g });
  },
  write_move_category: async () => {
    const g = await api.createCategoryGroup({ name: 'G' });
    return call('write_move_category', {
      category_id: await category('A'),
      group_id: g,
    });
  },
  write_move_category_group: async () =>
    call('write_move_category_group', {
      group_id: await api.createCategoryGroup({ name: 'G' }),
      before_group_id: (await bills()).id,
    }),
};

describe('The undo-line estimate never undercounts', () => {
  it('covers every undoable tool', () => {
    expect(Object.keys(WRITES).sort()).toEqual(Object.keys(UNDOABLE).sort());
  });

  it.each(Object.keys(WRITES))('%s', async tool => {
    h = await startHarness(
      { count: 2 },
      {
        grant: { scopes: [...SCOPES], confirm_destructive: false },
        identity: { user_id: 'u1', subject: 'sub1' },
      },
    );
    vi.spyOn(api, 'sync').mockResolvedValue(undefined);
    const w = await WRITES[tool]();
    const attempt = lines().find(
      l => l.call_id === w.write_id && l.phase === 'attempt',
    );
    const { user_id, subject, scopes, grant } = attempt;
    const estimate = lineBytes(
      { user_id, subject, scopes, ...(grant ? { grant } : {}) },
      attempt.budget_id,
      tool,
      { ids: attempt.ids, changes: attempt.changes },
    );
    const undo = await call('write_undo', { write_id: w.write_id });
    const real = lines().find(
      l => l.call_id === undo.write_id && l.phase === 'attempt',
    );
    expect(estimate.undo).toBeGreaterThanOrEqual(
      Buffer.byteLength(JSON.stringify(real)),
    );
  });
});
