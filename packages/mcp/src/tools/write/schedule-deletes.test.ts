import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';

import * as api from '@actual-app/api';
import * as db from '@actual-app/core/server/db/index';

import { startHarness } from '#client-harness';
import * as connection from '#connection';
import type { Grant, Scope } from '#grants';

import { NOT_UNDOABLE, UNDOABLE } from './declarations';

let h: Awaited<ReturnType<typeof startHarness>>;

afterEach(async () => {
  vi.restoreAllMocks();
  await h.close();
});

const ALL: Scope[] = [
  'budget:read',
  'schedules:write',
  'transactions:write',
  'delete',
];
const grant = (scopes: Scope[] = ALL, more: Partial<Grant> = {}): Grant => ({
  scopes,
  confirm_destructive: false,
  ...more,
});
async function start(g: Grant = grant()) {
  h = await startHarness({ count: 1 }, { grant: g });
}

function auditLines() {
  if (!existsSync(h.auditLog)) return [];
  return readFileSync(h.auditLog, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));
}

const pad = (n: number) => String(n).padStart(2, '0');
const nextMonthStart = () => {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + 2, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
};

const schedules = () => api.getSchedules();
const paychecks = () => api.getPaychecks();

async function clearingAccount(name: string) {
  return api.createAccount({ name }, 0);
}

/** The create call for the tool and, in the same words, the app's `paycheck-create` payload. */
async function pay(clearing: string, over: Record<string, unknown> = {}) {
  return {
    name: 'Acme',
    clearing_account_id: clearing,
    recurrence: {
      frequency: 'monthly',
      interval: 1,
      start: nextMonthStart(),
      patterns: [{ type: 'day', value: 15 }],
      end_mode: 'never',
    },
    weekend_solve_mode: 'before',
    gross_amount: 300000,
    deductions: [{ name: 'Tax', amount: 50000 }],
    deposits: [
      {
        account_id: h.fixture.accountId,
        kind: 'remainder',
        post_automatically: true,
      },
    ],
    ...over,
  };
}

function appPayload(name: string, clearing: string) {
  return {
    name,
    definition: {
      payee: null,
      clearingAccount: clearing,
      date: {
        start: nextMonthStart(),
        frequency: 'monthly' as const,
        interval: 1,
        patterns: [{ type: 'day' as const, value: 15 }],
        endMode: 'never' as const,
      },
      weekendSolveMode: 'before' as const,
      grossAmount: 300000,
      incomeCategory: null,
      deductions: [{ id: 'd1', name: 'Tax', amount: 50000 }],
      deposits: [
        {
          id: 'p1',
          account: h.fixture.accountId,
          kind: 'remainder' as const,
          value: 0,
          postAutomatically: true,
        },
      ],
    },
  };
}

/** A paycheck as stored, without the ids that differ between two creates. */
async function shape(id: string) {
  const all = await schedules();
  const p = (await paychecks()).find(x => x.id === id)!;
  const d = p.definition;
  const sched = (sid: string | null | undefined) => {
    const s = all.find(x => x.id === sid)!;
    const date =
      typeof s.date === 'object' && 'relativeTo' in s.date
        ? { ...s.date, relativeTo: { ...s.date.relativeTo, scheduleId: 'pay' } }
        : s.date;
    return {
      amount: s.amount,
      amountOp: s.amountOp,
      posts_transaction: s.posts_transaction,
      account: s.account === d.clearingAccount ? 'clearing' : s.account,
      next_date: s.next_date,
      date,
    };
  };
  // Unset and null fields mean the same, as the app leaves them out
  return JSON.parse(
    JSON.stringify(
      {
        gross: d.grossAmount,
        solve: d.weekendSolveMode,
        date: d.date,
        deductions: d.deductions.map(x => ({ ...x, id: '' })),
        deposits: d.deposits.map(x => ({ ...x, id: '', schedule: '' })),
        pay: sched(d.paySchedule),
        depositSchedules: d.deposits.map(x => sched(x.schedule)),
      },
      (_k, v) => (v === null ? undefined : v),
    ),
  );
}

describe('write_create_paycheck (2.3)', () => {
  beforeEach(async () => start());

  it('creates the paycheck and schedules the app makes for the same input', async () => {
    const a = await clearingAccount('Clear App');
    const t = await clearingAccount('Clear Tool');
    const appId = await api.createPaycheck(appPayload('Acme App', a));
    const res = await h.call('write_create_paycheck', {
      ...(await pay(t)),
      name: 'Acme Tool',
    });
    expect(res.isError, res.text).toBe(false);
    expect(res.json.paycheck_id).toBeTruthy();
    expect(res.json.schedule_ids).toHaveLength(2);
    expect(await shape(res.json.paycheck_id)).toEqual(await shape(appId));
  });

  it('logs an attempt and an outcome with the created id', async () => {
    const res = await h.call(
      'write_create_paycheck',
      await pay(await clearingAccount('Clear')),
    );
    const lines = auditLines();
    expect(lines.map(l => l.phase)).toEqual(['attempt', 'outcome']);
    expect(lines[1].created).toEqual([res.json.paycheck_id]);
    expect(lines[0].tool).toBe('write_create_paycheck');
  });

  it("leaves the accounts' business calendar and days early alone", async () => {
    const before = JSON.stringify(await api.getAccounts());
    const res = await h.call(
      'write_create_paycheck',
      await pay(await clearingAccount('Clear')),
    );
    expect(res.isError, res.text).toBe(false);
    const after = (await api.getAccounts()).filter(a => a.name !== 'Clear');
    expect(JSON.stringify(after)).toBe(before);
  });

  it('refuses a bad clearing account, changing nothing and writing no audit line', async () => {
    const off = await api.createAccount({ name: 'Off', offbudget: true }, 0);
    const closed = await clearingAccount('Closed');
    await api.closeAccount(closed);
    const calls = [
      await pay('nope'),
      await pay(off),
      await pay(closed),
      await pay(h.fixture.accountId, {
        deposits: [{ account_id: h.fixture.accountId, kind: 'remainder' }],
      }),
    ];
    for (const args of calls) {
      const res = await h.call('write_create_paycheck', args);
      expect(res.isError).toBe(true);
    }
    expect(await paychecks()).toEqual([]);
    expect(auditLines()).toEqual([]);
  });

  it('refuses an unknown payee, category or deposit account before writing', async () => {
    const c = await clearingAccount('Clear');
    for (const over of [
      { payee_id: 'nope' },
      { income_category_id: 'nope' },
      { deductions: [{ name: 'X', amount: 1, category_id: 'nope' }] },
      { deductions: [{ name: 'X', amount: 1, transfer_account_id: 'nope' }] },
      {
        deposits: [{ account_id: 'nope', kind: 'remainder' }],
      },
    ]) {
      const res = await h.call('write_create_paycheck', await pay(c, over));
      expect(res.isError, JSON.stringify(over)).toBe(true);
      expect(res.text).toMatch(/Nothing changed/);
    }
    expect(await paychecks()).toEqual([]);
    expect(auditLines()).toEqual([]);
  });

  it("refuses deductions and deposits above the connection's row limit", async () => {
    await h.close();
    await start(grant(ALL, { max_rows: 2 }));
    const c = await clearingAccount('Clear');
    const res = await h.call(
      'write_create_paycheck',
      await pay(c, {
        deductions: [
          { name: 'A', amount: 1 },
          { name: 'B', amount: 1 },
          { name: 'C', amount: 1 },
        ],
      }),
    );
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/at most 2/);
    expect(await paychecks()).toEqual([]);
    expect(auditLines()).toEqual([]);
  });

  it('passes an engine refusal through as a failed outcome', async () => {
    const c = await clearingAccount('Clear');
    // deductions above gross: the engine refuses
    const res = await h.call(
      'write_create_paycheck',
      await pay(c, { deductions: [{ name: 'Big', amount: 999999999 }] }),
    );
    expect(res.isError).toBe(true);
    expect(await paychecks()).toEqual([]);
  });

  it('is declared undoable and write_undo deletes it while no pay has posted', async () => {
    expect(UNDOABLE.write_create_paycheck).toEqual(['schedules:write']);
    const before = (await schedules()).length;
    const res = await h.call(
      'write_create_paycheck',
      await pay(await clearingAccount('Clear')),
    );
    const undo = await h.call('write_undo', { write_id: res.json.write_id });
    expect(undo.isError, undo.text).toBe(false);
    expect(await paychecks()).toEqual([]);
    expect((await schedules()).length).toBe(before);
    const again = await h.call('write_undo', { write_id: res.json.write_id });
    expect(again.isError).toBe(true);
  });

  it.each([0, 1])(
    'write_undo is refused once schedule %s has posted',
    async which => {
      const res = await h.call(
        'write_create_paycheck',
        await pay(await clearingAccount('Clear')),
      );
      // A direct row, as the schedules service links a posted pay
      await db.insertTransaction({
        id: randomUUID(),
        account: (await paychecks())[0].definition.clearingAccount,
        date: '2027-01-15',
        amount: 1,
        schedule: res.json.schedule_ids[which],
      });
      const undo = await h.call('write_undo', { write_id: res.json.write_id });
      expect(undo.isError).toBe(true);
      expect(undo.text).toMatch(/later change|in use/i);
      expect((await paychecks()).length).toBe(1);
    },
  );

  it('is refused without schedules:write, naming it', async () => {
    await h.close();
    await start(grant(['budget:read']));
    const listed = (await h.client.listTools()).tools.find(
      t => t.name === 'write_create_paycheck',
    )!;
    expect(listed.description).toContain('schedules:write');
    expect(listed.description).toContain('write_undo reverses it');
    expect(listed.description).toMatch(
      /cannot see a pay posted by hand \(deleting a paycheck never deletes posted transactions\)/,
    );
    const res = await h.call(
      'write_create_paycheck',
      await pay(await clearingAccount('Clear')),
    );
    expect(res.isError).toBe(true);
    expect(res.text).toContain('schedules:write');
  });
});

/** A paycheck (via the app's call) and a one-off schedule to delete. */
async function made() {
  const c = await clearingAccount('Clear');
  const paycheckId = await api.createPaycheck(appPayload('Acme', c));
  const schedule_id = (await internalSend('schedule/create', {
    schedule: { name: 'Gym', posts_transaction: false },
    conditions: [
      { op: 'isapprox', field: 'date', value: nextMonthStart() },
      { op: 'is', field: 'amount', value: -4000 },
    ],
  })) as string;
  return { paycheckId, schedule_id };
}
const internalSend = (name: string, payload: unknown) =>
  connection
    .internal()!
    .send(name as never, payload as never) as Promise<unknown>;

describe('write_delete_schedule (2.1, 2.2)', () => {
  beforeEach(async () => start());

  it('is refused without delete, naming it', async () => {
    await h.close();
    await start(grant(['budget:read', 'schedules:write']));
    const res = await h.call('write_delete_schedule', { schedule_id: 'x' });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('delete');
  });

  it('always answers the first call with a dry run, even with confirm_destructive off', async () => {
    const { schedule_id } = await made();
    const first = await h.call('write_delete_schedule', { schedule_id });
    expect(first.isError, first.text).toBe(false);
    expect(first.json.dry_run).toBe(true);
    expect(typeof first.json.confirm).toBe('string');
    expect(first.json.definition).toMatchObject({
      name: 'Gym',
      amount: -4000,
      posts_transaction: false,
    });
    expect(first.json.next_date).toBe(nextMonthStart());
    expect(first.json.linked_transactions).toBe(0);
    expect(first.json.relative_dependents).toEqual([]);
    expect(auditLines()).toEqual([]);
    expect((await schedules()).some(s => s.id === schedule_id)).toBe(true);

    const done = await h.call('write_delete_schedule', {
      schedule_id,
      confirm: first.json.confirm,
    });
    expect(done.isError, done.text).toBe(false);
    expect((await schedules()).some(s => s.id === schedule_id)).toBe(false);
    const lines = auditLines();
    expect(lines.map(l => l.phase)).toEqual(['attempt', 'outcome']);
    expect(JSON.stringify(lines[0].changes)).toContain('Gym');
    expect(lines[0].changes.map((c: { field: string }) => c.field)).toContain(
      'date',
    );
    expect(lines[0].relative_dependents).toEqual([]);
  });

  it('names its relative dependents and linked transactions in the dry run', async () => {
    const { schedule_id } = await made();
    await internalSend('schedule/create', {
      schedule: { name: 'Dep', posts_transaction: false },
      conditions: [
        {
          op: 'isapprox',
          field: 'date',
          value: {
            relativeTo: {
              scheduleId: schedule_id,
              offset: 1,
              unit: 'days',
              direction: 'before',
            },
          },
        },
        { op: 'is', field: 'amount', value: -1 },
      ],
    });
    const res = await h.call('write_delete_schedule', { schedule_id });
    expect(res.json.relative_dependents).toHaveLength(1);
  });

  it('refuses a paycheck-managed schedule and an unknown id, changing nothing', async () => {
    const { paycheckId } = await made();
    const managed = (await paychecks()).find(p => p.id === paycheckId)!
      .definition.paySchedule!;
    const before = JSON.stringify(await schedules());
    for (const id of [managed, 'nope']) {
      const res = await h.call('write_delete_schedule', { schedule_id: id });
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/Nothing changed/);
    }
    expect(JSON.stringify(await schedules())).toBe(before);
    expect(auditLines()).toEqual([]);
  });

  it('is declared not undoable; list_writes and write_undo give the reason', async () => {
    expect(NOT_UNDOABLE.write_delete_schedule).toBe(
      "recreate from the dry run's definition; a restore is planned in sc-5522",
    );
    const { schedule_id } = await made();
    const first = await h.call('write_delete_schedule', { schedule_id });
    const done = await h.call('write_delete_schedule', {
      schedule_id,
      confirm: first.json.confirm,
    });
    const listed = (await h.call('list_writes')).json.writes as Array<{
      write_id: string;
      undoable: boolean;
      reason?: string;
    }>;
    const mine = listed.find(w => w.write_id === done.json.write_id)!;
    expect(mine.undoable).toBe(false);
    expect(mine.reason).toMatch(/sc-5522/);
    const before = JSON.stringify(await schedules());
    const undo = await h.call('write_undo', { write_id: done.json.write_id });
    expect(undo.isError).toBe(true);
    expect(undo.text).toContain(NOT_UNDOABLE.write_delete_schedule);
    expect(JSON.stringify(await schedules())).toBe(before);
  });

  it('a stale confirm is refused', async () => {
    const { schedule_id } = await made();
    const first = await h.call('write_delete_schedule', { schedule_id });
    await api.updateSchedule(schedule_id, { name: 'Gym 2' } as never);
    const res = await h.call('write_delete_schedule', {
      schedule_id,
      confirm: first.json.confirm,
    });
    expect(res.isError).toBe(true);
    expect((await schedules()).some(s => s.id === schedule_id)).toBe(true);
  });
});

describe('write_delete_paycheck (2.4)', () => {
  beforeEach(async () => start());

  it('is refused without delete, naming it', async () => {
    await h.close();
    await start(grant(['budget:read', 'schedules:write']));
    const res = await h.call('write_delete_paycheck', { paycheck_id: 'x' });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('delete');
  });

  it('always dry-runs first with the definition, then deletes with the confirm', async () => {
    const { paycheckId } = await made();
    const before = (await paychecks()).find(p => p.id === paycheckId)!;
    const first = await h.call('write_delete_paycheck', {
      paycheck_id: paycheckId,
    });
    expect(first.isError, first.text).toBe(false);
    expect(first.json.dry_run).toBe(true);
    expect(first.json.definition).toMatchObject({
      name: 'Acme',
      gross_amount: 300000,
      clearing_account_id: before.definition.clearingAccount,
    });
    expect(first.json.definition.deductions).toHaveLength(1);
    expect(first.json.definition.deposits).toHaveLength(1);
    expect(auditLines()).toEqual([]);
    expect((await paychecks()).length).toBe(1);

    const done = await h.call('write_delete_paycheck', {
      paycheck_id: paycheckId,
      confirm: first.json.confirm,
    });
    expect(done.isError, done.text).toBe(false);
    expect(await paychecks()).toEqual([]);
    expect(auditLines().map(l => l.phase)).toEqual(['attempt', 'outcome']);
  });

  it('refuses an unknown id, changing nothing', async () => {
    await made();
    const res = await h.call('write_delete_paycheck', { paycheck_id: 'nope' });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/Nothing changed/);
    expect(auditLines()).toEqual([]);
  });

  it('is declared not undoable naming sc-5522, and write_undo gives the reason', async () => {
    expect(NOT_UNDOABLE.write_delete_paycheck).toMatch(/sc-5522/);
    const { paycheckId } = await made();
    const first = await h.call('write_delete_paycheck', {
      paycheck_id: paycheckId,
    });
    const done = await h.call('write_delete_paycheck', {
      paycheck_id: paycheckId,
      confirm: first.json.confirm,
    });
    const undo = await h.call('write_undo', { write_id: done.json.write_id });
    expect(undo.isError).toBe(true);
    expect(undo.text).toContain(NOT_UNDOABLE.write_delete_paycheck);
    expect(await paychecks()).toEqual([]);
  });

  it("the dry run's definition rebuilds the paycheck through write_create_paycheck", async () => {
    const { paycheckId } = await made();
    const first = await h.call('write_delete_paycheck', {
      paycheck_id: paycheckId,
    });
    const d = first.json.definition;
    const done = await h.call('write_delete_paycheck', {
      paycheck_id: paycheckId,
      confirm: first.json.confirm,
    });
    expect(done.isError, done.text).toBe(false);
    const re = await h.call('write_create_paycheck', {
      name: d.name,
      clearing_account_id: d.clearing_account_id,
      recurrence: d.recurrence,
      weekend_solve_mode: d.weekend_solve_mode,
      gross_amount: d.gross_amount,
      deductions: d.deductions,
      deposits: d.deposits,
    });
    expect(re.isError, re.text).toBe(false);
  });
});

describe('A missing engine (every new tool)', () => {
  beforeEach(async () => start());

  it('is refused with fixed text, writing no audit line', async () => {
    const { paycheckId, schedule_id } = await made();
    const c = await clearingAccount('Other');
    const logged = auditLines().length;
    vi.spyOn(connection, 'internal').mockReturnValue(null);
    const calls: Array<[string, Record<string, unknown>]> = [
      ['write_create_paycheck', { ...(await pay(c)), name: 'Other' }],
      ['write_delete_schedule', { schedule_id }],
      ['write_delete_paycheck', { paycheck_id: paycheckId }],
    ];
    for (const [tool, args] of calls) {
      const res = await h.call(tool, args);
      expect(res.isError, tool).toBe(true);
      expect(res.text, tool).toMatch(
        /engine is not available.*Nothing changed/,
      );
    }
    expect(auditLines().length).toBe(logged);
    expect((await paychecks()).length).toBe(1);
  });
});
