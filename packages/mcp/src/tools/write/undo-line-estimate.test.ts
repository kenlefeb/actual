import { existsSync, readFileSync } from 'fs';

import * as api from '@actual-app/api';

import { startHarness } from '#client-harness';
import { internal } from '#connection';
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

/** The budget's rows, groups and cells, to show a refused write changed nothing. */
async function snapshot() {
  const { data } = (await api.runQuery(
    api
      .q('transactions')
      .select(['id', 'notes', 'amount', 'category'])
      .orderBy(['id']),
  )) as { data: unknown[] };
  const months = await Promise.all(
    ['2026-03', '2026-04'].map(m => api.getBudgetMonth(m)),
  );
  return JSON.stringify([data, await api.getCategoryGroups(), months]);
}

/** Set by the gate test: the write tool's call is refused, and nothing may change. */
let gated: { before?: string; text?: string } | undefined;

async function call(tool: string, args: Record<string, unknown>) {
  if (gated) gated.before = await snapshot();
  const res = await h!.call(tool, args);
  if (gated) {
    expect(res.isError, 'the write was allowed').toBe(true);
    gated.text = res.text;
    return { write_id: '' };
  }
  expect(res.isError, res.text).toBe(false);
  return res.json as { write_id: string };
}

async function start(maxAuditLineBytes?: number) {
  h = await startHarness(
    { count: 2 },
    {
      grant: { scopes: [...SCOPES], confirm_destructive: false },
      identity: { user_id: 'u1', subject: 'sub1' },
      ...(maxAuditLineBytes ? { limits: { maxAuditLineBytes } } : {}),
    },
  );
  vi.spyOn(api, 'sync').mockResolvedValue(undefined);
}

/** The estimate for the write's own logged line. */
function estimateOf(writeId: string, tool: string) {
  const attempt = lines().find(
    l => l.call_id === writeId && l.phase === 'attempt',
  );
  const { user_id, subject, scopes, grant } = attempt;
  return lineBytes(
    { user_id, subject, scopes, ...(grant ? { grant } : {}) },
    attempt.budget_id,
    tool,
    { ids: attempt.ids, changes: attempt.changes },
  );
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

/** A schedule with the longest name and the widest amounts and dates. */
async function worstSchedule() {
  return {
    name: NAME,
    payee_id: await api.createPayee({ name: NAME }),
    account_id: h!.fixture.accountId,
    posts_transaction: true,
    amount_op: 'isbetween',
    amount_min: -1e12,
    amount_max: 1e12,
    recurrence: {
      frequency: 'monthly',
      interval: 99999,
      start: '2026-01-05',
      end_mode: 'on_date',
      end_date: '2100-12-31',
      skip_weekend: true,
      weekend_solve_mode: 'before',
    },
  };
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
  write_create_payee: async () => call('write_create_payee', { name: NAME }),
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
  write_create_schedule: async () =>
    call('write_create_schedule', await worstSchedule()),
  write_update_schedule: async () => {
    // Set up outside the audited tools, so only the update is gated
    const schedule_id = (await internal()!.send(
      'schedule/create' as never,
      {
        schedule: { name: 'Small', posts_transaction: false },
        conditions: [
          { op: 'isapprox', field: 'date', value: '2026-02-01' },
          { op: 'is', field: 'amount', value: -100 },
        ],
      } as never,
    )) as unknown as string;
    return call('write_update_schedule', {
      ...(await worstSchedule()),
      schedule_id,
    });
  },
  write_create_paycheck: async () => {
    const clearing = await api.createAccount({ name: 'Clearing' }, 0);
    return call('write_create_paycheck', {
      name: NAME,
      clearing_account_id: clearing,
      recurrence: {
        frequency: 'monthly',
        interval: 99999,
        start: '2026-01-05',
        end_mode: 'on_date',
        end_date: '2100-12-31',
      },
      weekend_solve_mode: 'before',
      gross_amount: 1e12,
      deductions: [
        { name: NAME, amount: 1e11 },
        { name: `${NAME}2`, amount: 1e11 },
      ],
      deposits: [
        {
          account_id: h!.fixture.accountId,
          kind: 'remainder',
          post_automatically: true,
        },
      ],
    });
  },
};

describe('The undo-line estimate never undercounts', () => {
  it('covers every undoable tool', () => {
    expect(Object.keys(WRITES).sort()).toEqual(Object.keys(UNDOABLE).sort());
  });

  it.each(Object.keys(WRITES))('%s', async tool => {
    await start();
    const w = await WRITES[tool]();
    const estimate = estimateOf(w.write_id, tool);
    const undo = await call('write_undo', { write_id: w.write_id });
    const real = lines().find(
      l => l.call_id === undo.write_id && l.phase === 'attempt',
    );
    expect(estimate.undo).toBeGreaterThanOrEqual(
      Buffer.byteLength(JSON.stringify(real)),
    );
  });
});

describe('Each undoable tool refuses a write whose undo line would not fit', () => {
  afterEach(() => {
    gated = undefined;
  });

  // The same write on a fresh budget gives a line of the same size (ids are UUIDs)
  it.each(Object.keys(WRITES))('%s', async tool => {
    await start();
    const { own, undo } = estimateOf((await WRITES[tool]()).write_id, tool);
    expect(own).toBeLessThan(undo);
    await h!.close();
    global.currentMonth = '2026-01';
    await start(undo - 1);
    gated = {};
    await WRITES[tool]();
    expect(gated.text).toMatch(/its undo would make an audit line/);
    expect(lines()).toEqual([]);
    expect(await snapshot()).toBe(gated.before);
  });
});
