import {
  appendFileSync,
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'fs';

import * as api from '@actual-app/api';

import { startHarness } from '#client-harness';
import { SCOPES } from '#grants';
import type { Grant, Scope } from '#grants';

import { budgetId } from './shared';

const ME = { user_id: 'u1', subject: 'sub1' };
const UNDO_REFUSAL = /cannot be undone/;

type Item = { write_id: string; undoable: boolean; reason?: string };
type Json = Record<string, unknown>;
type Change = { field: string; before: unknown; after: unknown };

let h: Awaited<ReturnType<typeof startHarness>>;
let grant: Grant;
let loadedBudget = '';

afterEach(async () => {
  vi.restoreAllMocks();
  await h.close();
});

async function start(
  count = 3,
  over: Partial<Grant> = {},
  identity: { user_id: string; subject: string } = ME,
) {
  grant = { scopes: [...SCOPES], confirm_destructive: false, ...over };
  h = await startHarness({ count }, { grant, identity });
  loadedBudget = await budgetId();
  return h;
}

function lines() {
  if (!existsSync(h.auditLog)) return [];
  return readFileSync(h.auditLog, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));
}

function plant(line: Record<string, unknown>) {
  appendFileSync(h.auditLog, `${JSON.stringify(line)}\n`);
}

/** An attempt and a clean outcome line for a write, as `loggedWrite` writes them. */
function plantWrite(
  call_id: string,
  over: Record<string, unknown> = {},
  outcome: Record<string, unknown> = {},
) {
  plant({
    time: '2026-01-01T00:00:00.000Z',
    ...ME,
    scopes: [],
    tool: 'write_update_transactions',
    call_id,
    phase: 'attempt',
    schema: 2,
    budget_id: loadedBudget,
    ids: [],
    changes: [],
    ...over,
  });
  plant({
    time: '2026-01-01T00:00:01.000Z',
    ...ME,
    scopes: [],
    tool: over.tool ?? 'write_update_transactions',
    call_id,
    phase: 'outcome',
    status: 'ok',
    applied: [],
    failed: null,
    created: [],
    ...outcome,
  });
}

async function rows() {
  const { data } = (await api.runQuery(
    api
      .q('transactions')
      .select(['id', 'date', 'amount', 'category', 'payee', 'notes', 'cleared'])
      .orderBy(['date', 'id']),
  )) as {
    data: Array<{
      id: string;
      date: string;
      amount: number;
      category: string | null;
      payee: string | null;
      notes: string | null;
      cleared: boolean;
    }>;
  };
  return data;
}

async function cat(name: string) {
  const groups = await api.getCategoryGroups();
  const existing = (await api.getCategories()).find(c => c.name === name);
  if (existing) return existing.id;
  return api.createCategory({
    name,
    group_id: groups.find(g => g.name === 'Bills')!.id,
  } satisfies Parameters<typeof api.createCategory>[0]);
}

async function write(tool: string, args: Record<string, unknown>) {
  const res = await h.call(tool, args);
  expect(res.isError, res.text).toBe(false);
  return res.json as { write_id: string } & Record<string, unknown>;
}

async function setCategory(ids: string[], category_id: string | null) {
  return write('write_update_transactions', {
    updates: ids.map(id => ({ id, category_id })),
  });
}

describe('Audit schema 2', () => {
  it('attempt lines carry schema 2 and no secret reaches any line', async () => {
    await start(1);
    const [t] = await rows();
    const w = await write('write_update_transactions', {
      updates: [{ id: t.id, notes: 'hello' }],
    });
    const attempt = lines().find(l => l.phase === 'attempt')!;
    expect(attempt.schema).toBe(2);
    expect(attempt.call_id).toBe(w.write_id);
    expect(readFileSync(h.auditLog, 'utf8')).not.toContain(h.secret);
  });

  it('a v1 line is recognized as not undoable', async () => {
    await start(1);
    plantWrite('v1-line', { schema: undefined });
    const list = await h.call('list_writes');
    const item = list.json.writes.find((w: Item) => w.write_id === 'v1-line');
    expect(item).toMatchObject({ undoable: false });
    expect(item.reason).toBeTruthy();
    const res = await h.call('write_undo', { write_id: 'v1-line' });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(UNDO_REFUSAL);
  });
});

describe('Audit lines name the budget', () => {
  it('every attempt line carries the loaded budget id', async () => {
    await start(1);
    const [t] = await rows();
    await write('write_update_transactions', {
      updates: [{ id: t.id, notes: 'x' }],
    });
    const attempt = lines().find(l => l.phase === 'attempt');
    expect(loadedBudget).not.toBe('');
    expect(attempt.budget_id).toBe(loadedBudget);
  });

  it('refuses an undo of a line without budget_id or with another budget as unknown', async () => {
    await start(1);
    const [t] = await rows();
    plantWrite('no-budget', { ids: [t.id], budget_id: undefined });
    plantWrite('other-budget', { ids: [t.id], budget_id: 'some-other-budget' });
    for (const id of ['no-budget', 'other-budget']) {
      const res = await h.call('write_undo', { write_id: id });
      expect(res.isError, id).toBe(true);
      expect(res.text, id).toMatch(UNDO_REFUSAL);
    }
  });
});

describe('Writes return their id', () => {
  it('every write tool returns the call_id of its audit lines', async () => {
    await start(2);
    const [t] = await rows();
    const rent = await cat('Rent');
    const group = (await api.getCategoryGroups()).find(
      g => g.name === 'Bills',
    )!;
    const calls: Array<[string, Record<string, unknown>]> = [
      [
        'write_create_transactions',
        {
          account_id: h.fixture.accountId,
          transactions: [{ date: '2026-02-01', amount: -5 }],
        },
      ],
      ['write_update_transactions', { updates: [{ id: t.id, notes: 'x' }] }],
      [
        'write_set_budget_amount',
        { month: '2026-02', category_id: rent, amount: 100 },
      ],
      ['write_create_category_group', { name: 'Fun' }],
      ['write_create_category', { name: 'Games', group_id: group.id }],
      ['write_update_category', { category_id: rent, hidden: true }],
      ['write_update_category_group', { group_id: group.id, hidden: true }],
      ['write_move_category', { category_id: rent, group_id: group.id }],
      ['write_move_category_group', { group_id: group.id }],
    ];
    for (const [tool, args] of calls) {
      const w = await write(tool, args);
      const attempt = lines().find(
        l => l.phase === 'attempt' && l.call_id === w.write_id,
      );
      expect(attempt?.tool, tool).toBe(tool);
    }
    const games = (await api.getCategories()).find(c => c.name === 'Games')!;
    const del = await write('write_delete_category', { category_id: games.id });
    expect(lines().some(l => l.call_id === del.write_id)).toBe(true);
  });
});

describe('Writes return their id (skip and move on budget)', () => {
  it('write_skip_paycheck and write_move_on_budget return their call_id', async () => {
    await start(1);
    const paycheck = await api.createPaycheck({
      name: 'Acme',
      newClearingAccountName: 'Acme Paycheck',
      definition: {
        payee: null,
        clearingAccount: '',
        date: { start: '2027-01-01', frequency: 'monthly' },
        weekendSolveMode: 'before',
        grossAmount: 300000,
        incomeCategory: null,
        deductions: [],
        deposits: [
          {
            id: 'checking',
            account: h.fixture.accountId,
            kind: 'remainder',
            value: 0,
          },
        ],
      },
    });
    const skip = await write('write_skip_paycheck', { paycheck_id: paycheck });
    const account = await api.createAccount(
      { name: 'Vanguard 401k', offbudget: true },
      10000,
    );
    await api.addTransactions(account, [{ date: '2026-09-01', amount: 100 }]);
    const preview = await h.call('preview_move_on_budget', {
      account_id: account,
      start_date: '2026-10-01',
    });
    const move = await write('write_move_on_budget', {
      account_id: account,
      start_date: '2026-10-01',
      confirm: preview.json.confirm,
    });
    for (const [tool, w] of [
      ['write_skip_paycheck', skip],
      ['write_move_on_budget', move],
    ] as const) {
      expect(
        lines().find(l => l.phase === 'attempt' && l.call_id === w.write_id)
          ?.tool,
      ).toBe(tool);
    }
  });
});

describe('Undo checks what it restores still exists', () => {
  it('refuses restoring a name another category now holds', async () => {
    await start(1);
    const food = await cat('Food');
    const w = await write('write_update_category', {
      category_id: food,
      name: 'Dining',
    });
    await cat('Food');
    const res = await h.call('write_undo', { write_id: w.write_id });
    expect(res.isError).toBe(true);
    expect(res.text).toContain(food);
    expect(res.text).toContain('name');
    expect((await api.getCategories()).find(c => c.id === food)!.name).toBe(
      'Dining',
    );
  });

  it('refuses restoring a group name another group now holds', async () => {
    await start(1);
    const group = await write('write_create_category_group', { name: 'Fun' });
    const w = await write('write_update_category_group', {
      group_id: group.group_id,
      name: 'Games',
    });
    await api.createCategoryGroup({ name: 'Fun' });
    const res = await h.call('write_undo', { write_id: w.write_id });
    expect(res.isError).toBe(true);
    expect(res.text).toContain(group.group_id as string);
  });

  it('refuses restoring a category that was deleted', async () => {
    await start(1);
    const [t] = await rows();
    const a = await cat('Rent');
    const b = await cat('Utilities');
    await setCategory([t.id], a);
    const w = await setCategory([t.id], b);
    await api.deleteCategory(a, b);
    // the delete moved the row to b, so put it back where the write left it
    const res = await h.call('write_undo', { write_id: w.write_id });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('category_id');
    expect((await rows())[0].category).toBe(b);
  });

  it('refuses restoring a payee that was deleted', async () => {
    await start(1);
    const [t] = await rows();
    const first = await api.createPayee({ name: 'First' });
    const second = await api.createPayee({ name: 'Second' });
    await write('write_update_transactions', {
      updates: [{ id: t.id, payee_id: first }],
    });
    const w = await write('write_update_transactions', {
      updates: [{ id: t.id, payee_id: second }],
    });
    await api.deletePayee(first);
    const res = await h.call('write_undo', { write_id: w.write_id });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('payee_id');
    expect((await rows())[0].payee).toBe(second);
  });
});

describe('A create undo matches account and cleared too', () => {
  it('refuses when a created row was unmarked cleared since', async () => {
    await start(1);
    const w = await write('write_create_transactions', {
      account_id: h.fixture.accountId,
      transactions: [{ date: '2026-03-01', amount: -10 }],
    });
    const made = (await rows()).find(t => t.date === '2026-03-01')!;
    await api.updateTransaction(made.id, { cleared: false });
    const res = await h.call('write_undo', { write_id: w.write_id });
    expect(res.isError).toBe(true);
    expect(res.text).toContain(made.id);
    expect(await rows()).toHaveLength(2);
  });

  it('refuses when a created row moved account', async () => {
    await start(1);
    const w = await write('write_create_transactions', {
      account_id: h.fixture.accountId,
      transactions: [{ date: '2026-03-01', amount: -10 }],
    });
    const made = (await rows()).find(t => t.date === '2026-03-01')!;
    const other = await api.createAccount({ name: 'Other' }, 0);
    await api.updateTransaction(made.id, { account: other });
    const res = await h.call('write_undo', { write_id: w.write_id });
    expect(res.isError).toBe(true);
    expect(await rows()).toHaveLength(2);
  });
});

describe('A category is in use by anything that refers to it', () => {
  async function created() {
    const group = (await api.getCategoryGroups()).find(
      g => g.name === 'Bills',
    )!;
    return write('write_create_category', {
      name: 'Games',
      group_id: group.id,
    });
  }
  /** True when the undo was refused and the category is still there. */
  const refusedAndKept = async (w: { write_id: string }) => {
    const res = await h.call('write_undo', { write_id: w.write_id });
    return (
      res.isError && (await api.getCategories()).some(c => c.name === 'Games')
    );
  };

  it('only by a rule', async () => {
    await start(1);
    const w = await created();
    const landlord = (await api.getPayees()).find(p => p.name === 'Landlord')!;
    await api.createRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ field: 'payee', op: 'is', value: landlord.id }],
      actions: [{ op: 'set', field: 'category', value: w.category_id }],
    } as never);
    expect(await refusedAndKept(w)).toBe(true);
  });

  it('only by a schedule', async () => {
    await start(1);
    const w = await created();
    const schedule = await api.createSchedule({
      name: 'Rent day',
      date: { start: '2027-01-01', frequency: 'monthly' },
      amount: -100,
      amountOp: 'is',
    } as never);
    const sched = (await api.getSchedules()).find(x => x.id === schedule)!;
    await api.updateRule({
      id: sched.rule!,
      stage: null,
      conditionsOp: 'and',
      conditions: [],
      actions: [{ op: 'set', field: 'category', value: w.category_id }],
    } as never);
    expect(await refusedAndKept(w)).toBe(true);
  });

  it('only by a budget amount', async () => {
    await start(1);
    const w = await created();
    await api.setBudgetAmount('2026-02', w.category_id as string, 500);
    expect(await refusedAndKept(w)).toBe(true);
  });
});

describe('List my writes', () => {
  it('lists the caller own writes newest first, not another identity', async () => {
    await start(3);
    const [a, b, c] = await rows();
    const ids = [];
    for (const t of [a, b, c]) {
      ids.push(
        (
          await write('write_update_transactions', {
            updates: [{ id: t.id, notes: t.id.slice(0, 4) }],
          })
        ).write_id,
      );
    }
    plantWrite(
      'theirs',
      { subject: 'other', user_id: 'u2' },
      { subject: 'other', user_id: 'u2' },
    );
    const res = await h.call('list_writes');
    const listed = res.json.writes.map((w: Item) => w.write_id);
    expect(listed).toEqual([...ids].reverse());
    expect(res.json.writes[0]).toMatchObject({
      tool: 'write_update_transactions',
      status: 'ok',
      undone: false,
      undoable: true,
      rows: 1,
    });
    // no budget values
    expect(res.text).not.toMatch(/"notes"|"before"|"after"/);
  });

  it('is 20 by default and at most 50', async () => {
    await start(1);
    for (let i = 0; i < 55; i++) plantWrite(`w${i}`);
    expect((await h.call('list_writes')).json.writes).toHaveLength(20);
    expect(
      (await h.call('list_writes', { limit: 50 })).json.writes,
    ).toHaveLength(50);
    expect((await h.call('list_writes', { limit: 51 })).isError).toBe(true);
  });

  it('works for a read-only connection and skips a damaged line', async () => {
    await start(1, { scopes: ['budget:read'] });
    plantWrite('one');
    appendFileSync(h.auditLog, '{not json\n');
    plantWrite('two');
    const res = await h.call('list_writes');
    expect(res.isError).toBe(false);
    expect(res.json.writes.map((w: Item) => w.write_id)).toEqual([
      'two',
      'one',
    ]);
  });

  it('reads at most the last 2 MB', async () => {
    await start(1);
    plantWrite('old');
    const filler = `${JSON.stringify({ filler: 'x'.repeat(1000) })}\n`;
    appendFileSync(h.auditLog, filler.repeat(2200));
    plantWrite('new');
    expect(statSync(h.auditLog).size).toBeGreaterThan(2 * 1024 * 1024);
    const listed = (await h.call('list_writes')).json.writes.map(
      (w: Item) => w.write_id,
    );
    expect(listed).toEqual(['new']);
    const res = await h.call('write_undo', { write_id: 'old' });
    expect(res.text).toMatch(UNDO_REFUSAL);
  });
});

describe('Undo a write', () => {
  it('undoes 23 category moves in one call', async () => {
    await start(23);
    const all = (await rows()).map(t => t.id);
    const a = await cat('Rent');
    const b = await cat('Utilities');
    await setCategory(all, a);
    const move = await setCategory(all, b);
    const res = await h.call('write_undo', { write_id: move.write_id });
    expect(res.isError, res.text).toBe(false);
    expect((await rows()).every(t => t.category === a)).toBe(true);
    const undo = lines().find(
      l => l.phase === 'attempt' && l.undoes === move.write_id,
    )!;
    expect(undo.tool).toBe('write_undo');
    expect(
      lines().find(l => l.phase === 'outcome' && l.call_id === undo.call_id)
        .undoes,
    ).toBe(move.write_id);
  });

  it('a later edit refuses the whole undo', async () => {
    await start(3);
    const all = (await rows()).map(t => t.id);
    const a = await cat('Rent');
    const b = await cat('Utilities');
    const w = await setCategory(all, a);
    await api.updateTransaction(all[1], { category: b });
    const res = await h.call('write_undo', { write_id: w.write_id });
    expect(res.isError).toBe(true);
    expect(res.text).toContain(all[1]);
    expect(res.text).toContain('category_id');
    expect(res.text).toMatch(/Nothing changed/);
    const now = await rows();
    expect(now.map(t => t.category)).toEqual([a, b, a]);
  });

  it('an edit of another field does not refuse', async () => {
    await start(1);
    const [t] = await rows();
    const w = await write('write_update_transactions', {
      updates: [{ id: t.id, notes: 'mine' }],
    });
    await api.updateTransaction(t.id, { cleared: true });
    const res = await h.call('write_undo', { write_id: w.write_id });
    expect(res.isError, res.text).toBe(false);
    const [now] = await rows();
    expect(now.notes).toBeNull();
    expect(now.cleared).toBe(true);
  });

  it('a grant that cannot write transactions is refused by scope', async () => {
    await start(1);
    const [t] = await rows();
    const w = await write('write_update_transactions', {
      updates: [{ id: t.id, notes: 'mine' }],
    });
    grant.scopes = ['budget:read', 'budget:write'] as Scope[];
    const res = await h.call('write_undo', { write_id: w.write_id });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/missing transactions:write/);
    expect((await rows())[0].notes).toBe('mine');
    const refused = lines().find(l => l.phase === 'refused')!;
    expect(refused.tool).toBe('write_undo');
    expect(refused.missing).toEqual(['transactions:write']);
  });

  it("another identity's write and an unknown id read the same", async () => {
    await start(
      1,
      { scopes: ['budget:read'] },
      {
        user_id: 'unknown',
        subject: 'sub1',
      },
    );
    plantWrite(
      'theirs',
      { subject: 'other', user_id: 'unknown' },
      { subject: 'other', user_id: 'unknown' },
    );
    const a = await h.call('write_undo', { write_id: 'theirs' });
    const b = await h.call('write_undo', { write_id: 'nope' });
    expect(a.isError && b.isError).toBe(true);
    expect(a.text).toBe(b.text);
    expect(a.text).not.toMatch(/transactions:write|budget:write|missing/);
  });

  it('user_id unknown never matches on its own', async () => {
    await start(1, {}, { user_id: 'unknown', subject: 'sub1' });
    plantWrite('same-subject-other-user', { user_id: 'u9' });
    const res = await h.call('write_undo', {
      write_id: 'same-subject-other-user',
    });
    expect(res.text).toMatch(UNDO_REFUSAL);
  });

  it('refuses writes that are not undoable', async () => {
    await start(1);
    const [t] = await rows();
    // A move logged before moves recorded their place
    const mv = { write_id: 'old-move' };
    plantWrite(
      mv.write_id,
      {
        tool: 'write_move_category_group',
        ids: ['g'],
        changes: [
          { id: 'g', field: 'before_group_id', before: null, after: null },
        ],
      },
      { applied: ['g'] },
    );
    plantWrite('null-applied', {}, { applied: null });
    plantWrite('read-back', {}, { applied: [], read_back: 'failed' });
    plantWrite('failed', { ids: [t.id] }, { status: 'failed', applied: [] });
    plant({
      time: 'x',
      ...ME,
      scopes: [],
      tool: 'write_update_transactions',
      call_id: 'no-outcome',
      phase: 'attempt',
      schema: 2,
      ids: [],
      changes: [],
    });
    const w = await write('write_update_transactions', {
      updates: [{ id: t.id, notes: 'a' }],
    });
    const undo = await write('write_undo', { write_id: w.write_id });
    for (const id of [
      mv.write_id,
      'null-applied',
      'read-back',
      'failed',
      'no-outcome',
      undo.write_id,
    ]) {
      const res = await h.call('write_undo', { write_id: id });
      expect(res.isError, id).toBe(true);
      expect(res.text, id).toMatch(UNDO_REFUSAL);
    }
    const items = (await h.call('list_writes')).json.writes;
    expect(items.find((x: Item) => x.write_id === mv.write_id).undoable).toBe(
      false,
    );
  });

  it('a second undo names the first undo', async () => {
    await start(1);
    const [t] = await rows();
    const w = await write('write_update_transactions', {
      updates: [{ id: t.id, notes: 'mine' }],
    });
    const first = await write('write_undo', { write_id: w.write_id });
    const again = await h.call('write_undo', { write_id: w.write_id });
    expect(again.isError).toBe(true);
    expect(again.text).toContain(first.write_id);
    const listed = (await h.call('list_writes')).json.writes.find(
      (x: Item) => x.write_id === w.write_id,
    );
    expect(listed).toMatchObject({ undone: true, undoable: false });
  });

  it('an engine failure midway records applied and failed, and uses the original', async () => {
    await start(3);
    const all = (await rows()).map(t => t.id);
    const a = await cat('Rent');
    const w = await setCategory(all, a);
    const real = api.updateTransaction;
    let n = 0;
    vi.spyOn(api, 'updateTransaction').mockImplementation((...args) => {
      if (++n === 2) throw new Error('boom');
      return real(...args);
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const res = await h.call('write_undo', { write_id: w.write_id });
    expect(res.isError).toBe(false);
    expect(res.json.failed).toBeTruthy();
    const undo = lines().find(
      l => l.phase === 'attempt' && l.undoes === w.write_id,
    )!;
    const outcome = lines().find(
      l => l.phase === 'outcome' && l.call_id === undo.call_id,
    )!;
    expect(outcome.applied).toHaveLength(1);
    expect(outcome.failed).toBeTruthy();
    vi.restoreAllMocks();
    const again = await h.call('write_undo', { write_id: w.write_id });
    expect(again.isError).toBe(true);
  });

  it('a conflict does not use the original, so the undo can be retried', async () => {
    await start(1);
    const [t] = await rows();
    const w = await write('write_update_transactions', {
      updates: [{ id: t.id, notes: 'mine' }],
    });
    await api.updateTransaction(t.id, { notes: 'theirs' });
    expect((await h.call('write_undo', { write_id: w.write_id })).isError).toBe(
      true,
    );
    await api.updateTransaction(t.id, { notes: 'mine' });
    const res = await h.call('write_undo', { write_id: w.write_id });
    expect(res.isError, res.text).toBe(false);
    expect((await rows())[0].notes).toBeNull();
  });
});

describe('What undo reverses', () => {
  it('a reconciled row needs allow_reconciled', async () => {
    await start(1);
    const [t] = await rows();
    const a = await cat('Rent');
    const w = await setCategory([t.id], a);
    await api.updateTransaction(t.id, { cleared: true, reconciled: true });
    const refused = await h.call('write_undo', { write_id: w.write_id });
    expect(refused.isError).toBe(true);
    expect((await rows())[0].category).toBe(a);
    // the grant must allow it too
    const nogrant = await h.call('write_undo', {
      write_id: w.write_id,
      allow_reconciled: true,
    });
    expect(nogrant.isError).toBe(true);
    grant.allow_reconciled = true;
    const ok = await h.call('write_undo', {
      write_id: w.write_id,
      allow_reconciled: true,
    });
    expect(ok.isError, ok.text).toBe(false);
    expect((await rows())[0].category).toBeNull();
  });

  it('a row that became a transfer is not undoable', async () => {
    await start(1);
    const [t] = await rows();
    const landlord = (await api.getPayees()).find(p => p.name === 'Landlord')!;
    const w = await write('write_update_transactions', {
      updates: [{ id: t.id, payee_id: landlord.id }],
    });
    const savings = await api.createAccount({ name: 'Savings' }, 0);
    const tp = (await api.getPayees()).find(p => p.transfer_acct === savings)!;
    await api.updateTransaction(t.id, { payee: tp.id });
    const res = await h.call('write_undo', { write_id: w.write_id });
    expect(res.isError).toBe(true);
    expect((await rows()).find(r => r.id === t.id)!.payee).toBe(tp.id);
  });

  it('undoes a create by deleting the rows, and refuses when one changed', async () => {
    await start(1);
    const create = () =>
      write('write_create_transactions', {
        account_id: h.fixture.accountId,
        transactions: [
          { date: '2026-03-01', amount: -10, notes: 'a' },
          { date: '2026-03-02', amount: -20 },
        ],
      });
    const w = await create();
    expect(await rows()).toHaveLength(3);
    expect((await h.call('write_undo', { write_id: w.write_id })).isError).toBe(
      false,
    );
    expect(await rows()).toHaveLength(1);

    const w2 = await create();
    const made = (await rows()).find(t => t.date === '2026-03-02')!;
    await api.updateTransaction(made.id, { amount: -21 });
    const res = await h.call('write_undo', { write_id: w2.write_id });
    expect(res.isError).toBe(true);
    expect(res.text).toContain(made.id);
    expect(await rows()).toHaveLength(3);
  });

  it('undoes a budget amount and refuses after a later change', async () => {
    await start(1);
    const rent = await cat('Rent');
    const w = await write('write_set_budget_amount', {
      month: '2026-02',
      category_id: rent,
      amount: 500,
    });
    await api.setBudgetAmount('2026-02', rent, 700);
    const res = await h.call('write_undo', { write_id: w.write_id });
    expect(res.isError).toBe(true);
    await api.setBudgetAmount('2026-02', rent, 500);
    expect((await h.call('write_undo', { write_id: w.write_id })).isError).toBe(
      false,
    );
    const month = await api.getBudgetMonth('2026-02');
    const budgeted = month.categoryGroups
      .flatMap(g => g.categories ?? [])
      .find(c => c.id === rent)!.budgeted;
    expect(Number(budgeted ?? 0)).toBe(0);
  });

  it('undoes category and group updates, and creates while unused', async () => {
    await start(1);
    const rent = await cat('Rent');
    const group = (await api.getCategoryGroups()).find(
      g => g.name === 'Bills',
    )!;
    const upd = await write('write_update_category', {
      category_id: rent,
      name: 'Rent 2',
      hidden: true,
    });
    const gupd = await write('write_update_category_group', {
      group_id: group.id,
      name: 'Bills 2',
    });
    for (const w of [upd, gupd]) {
      expect(
        (await h.call('write_undo', { write_id: w.write_id })).isError,
      ).toBe(false);
    }
    const cats = await api.getCategories();
    expect(cats.find(c => c.id === rent)).toMatchObject({
      name: 'Rent',
      hidden: false,
    });
    expect(
      (await api.getCategoryGroups()).find(g => g.id === group.id)!.name,
    ).toBe('Bills');

    const newCat = await write('write_create_category', {
      name: 'Games',
      group_id: group.id,
    });
    const newGroup = await write('write_create_category_group', {
      name: 'Fun',
    });
    expect(
      (await h.call('write_undo', { write_id: newCat.write_id })).isError,
    ).toBe(false);
    expect(
      (await h.call('write_undo', { write_id: newGroup.write_id })).isError,
    ).toBe(false);
    expect((await api.getCategories()).some(c => c.name === 'Games')).toBe(
      false,
    );
    expect((await api.getCategoryGroups()).some(g => g.name === 'Fun')).toBe(
      false,
    );
  });

  it('a used category or group refuses the undo of its create', async () => {
    await start(1);
    const [t] = await rows();
    const group = (await api.getCategoryGroups()).find(
      g => g.name === 'Bills',
    )!;
    const c = await write('write_create_category', {
      name: 'Games',
      group_id: group.id,
    });
    await api.updateTransaction(t.id, { category: c.category_id as string });
    const g = await write('write_create_category_group', { name: 'Fun' });
    await api.createCategory({
      name: 'Toys',
      group_id: g.group_id as string,
    } satisfies Parameters<typeof api.createCategory>[0]);
    for (const w of [c, g]) {
      expect(
        (await h.call('write_undo', { write_id: w.write_id })).isError,
      ).toBe(true);
    }
    expect((await api.getCategories()).some(x => x.id === c.category_id)).toBe(
      true,
    );
    expect((await api.getCategoryGroups()).some(x => x.id === g.group_id)).toBe(
      true,
    );
  });

  it('replays only allowlisted fields and ids in applied', async () => {
    await start(2);
    const [a, b] = await rows();
    plantWrite(
      'damaged',
      {
        ids: [a.id],
        changes: [
          { id: a.id, field: 'notes', before: 'x', after: null },
          // not allowlisted, and a row that is not in applied
          { id: a.id, field: 'reconciled', before: true, after: false },
          { id: b.id, field: 'notes', before: 'evil', after: null },
        ],
      },
      { applied: [a.id] },
    );
    const res = await h.call('write_undo', { write_id: 'damaged' });
    expect(res.isError, res.text).toBe(false);
    const now = await rows();
    expect(now.find(t => t.id === a.id)!.notes).toBe('x');
    expect(now.find(t => t.id === b.id)!.notes).toBeNull();
  });
});

describe('Undo annotations and confirm', () => {
  it('write_undo is destructive and not read-only', async () => {
    await start(1);
    const { tools } = await h.client.listTools();
    const undo = tools.find(t => t.name === 'write_undo')!;
    expect(undo.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    expect(undo.description).toMatch(/Needs: budget:read\.$/);
    const list = tools.find(t => t.name === 'list_writes')!;
    expect(list.annotations).toMatchObject({ readOnlyHint: true });
  });

  it('a create undo dry-runs under confirm_destructive; an update undo does not', async () => {
    await start(1, { confirm_destructive: true });
    const w = await write('write_create_transactions', {
      account_id: h.fixture.accountId,
      transactions: [{ date: '2026-03-01', amount: -10 }],
    });
    const dry = await h.call('write_undo', { write_id: w.write_id });
    expect(dry.json.dry_run).toBe(true);
    expect(dry.json.confirm).toBeTruthy();
    expect(dry.json.ids).toHaveLength(1);
    expect(await rows()).toHaveLength(2);
    const done = await h.call('write_undo', {
      write_id: w.write_id,
      confirm: dry.json.confirm,
    });
    expect(done.isError, done.text).toBe(false);
    expect(await rows()).toHaveLength(1);

    const [t] = await rows();
    const u = await write('write_update_transactions', {
      updates: [{ id: t.id, notes: 'n' }],
    });
    const res = await h.call('write_undo', { write_id: u.write_id });
    expect(res.json.dry_run).toBeUndefined();
    expect((await rows())[0].notes).toBeNull();
  });
});

describe('Writes are serialized', () => {
  it('two parallel writes to one row log each other as their before', async () => {
    await start(1);
    const [t] = await rows();
    const [r1, r2] = await Promise.all([
      h.call('write_update_transactions', {
        updates: [{ id: t.id, notes: 'one' }],
      }),
      h.call('write_update_transactions', {
        updates: [{ id: t.id, notes: 'two' }],
      }),
    ]);
    expect(r1.isError || r2.isError).toBe(false);
    const attempts = lines().filter(l => l.phase === 'attempt');
    const note = (l: Json) =>
      (l.changes as Change[]).find(c => c.field === 'notes')!;
    expect(note(attempts[0]).before).toBeNull();
    expect(note(attempts[1]).before).toBe(note(attempts[0]).after);
    const res = await h.call('write_undo', { write_id: attempts[0].call_id });
    expect(res.isError).toBe(true);
  });

  it('an undo racing a write is serialized', async () => {
    await start(1);
    const [t] = await rows();
    const w = await write('write_update_transactions', {
      updates: [{ id: t.id, notes: 'one' }],
    });
    await Promise.all([
      h.call('write_undo', { write_id: w.write_id }),
      h.call('write_update_transactions', {
        updates: [{ id: t.id, notes: 'two' }],
      }),
    ]);
    const attempts = lines().filter(
      l => l.phase === 'attempt' && l.tool === 'write_update_transactions',
    );
    // The write ran after the undo finished: its before is the restored null
    expect(
      (attempts[1].changes as Change[]).find(c => c.field === 'notes')!.before,
    ).toBeNull();
    expect((await rows())[0].notes).toBe('two');
  });
});

describe('Undo refusals are logged without budget data', () => {
  it('writes a refused line', async () => {
    await start(1);
    const [t] = await rows();
    const w = await write('write_update_transactions', {
      updates: [{ id: t.id, notes: 'secret-note' }],
    });
    await api.updateTransaction(t.id, { notes: 'theirs' });
    await h.call('write_undo', { write_id: w.write_id });
    const refused = lines().filter(l => l.phase === 'refused');
    expect(refused).toHaveLength(1);
    expect(refused[0].tool).toBe('write_undo');
    expect(JSON.stringify(refused[0])).not.toMatch(/secret-note|theirs/);
  });
});

// keep the unused-import linter honest when the file is trimmed
void writeFileSync;
