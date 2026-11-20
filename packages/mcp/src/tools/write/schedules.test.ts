import { existsSync, readFileSync } from 'fs';

import * as api from '@actual-app/api';
import * as db from '@actual-app/core/server/db/index';
import { currentDay } from '@actual-app/core/shared/months';

import { startHarness } from '#client-harness';
import { internal } from '#connection';
import type { Grant, Scope } from '#grants';

import { NOT_UNDOABLE, UNDOABLE } from './declarations';

let h: Awaited<ReturnType<typeof startHarness>>;

afterEach(async () => {
  vi.restoreAllMocks();
  await h.close();
});

const grant = (scopes: Scope[]): Grant => ({
  scopes,
  confirm_destructive: false,
});
const ALL: Scope[] = [
  'budget:read',
  'schedules:write',
  'transactions:write',
  'structure:write',
];

async function start(g: Grant = grant(ALL)) {
  h = await startHarness({ count: 1 }, { grant: g });
}

const cmp = (a: string, b: string) => a.localeCompare(b);
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** The first of the month `n` months from now: always after today. */
const firstOfMonth = (n: number) => {
  const now = new Date();
  return ymd(new Date(now.getFullYear(), now.getMonth() + n, 1));
};
// The engine's clock is fixed under test
const today = () => currentDay();

function auditLines() {
  if (!existsSync(h.auditLog)) return [];
  return readFileSync(h.auditLog, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));
}

const schedules = () => api.getSchedules();
const byName = async (name: string) =>
  (await schedules()).find(s => s.name === name)!;

async function payeeId() {
  return (await api.getPayees()).find(p => p.name === 'Landlord')!.id;
}

const monthly = (start = firstOfMonth(2)) => ({
  frequency: 'monthly',
  interval: 1,
  start,
});

/** The create call of Ken's scenario: a monthly loan payment, auto-post off. */
async function loan(over: Record<string, unknown> = {}) {
  return {
    name: 'Car loan',
    payee_id: await payeeId(),
    account_id: h.fixture.accountId,
    amount_op: 'is',
    amount: -35000,
    posts_transaction: false,
    recurrence: monthly(),
    ...over,
  };
}

/** What the app's schedule form sends to `schedule/create`. */
async function appCreate(
  name: string,
  date: unknown,
  amountOp = 'is',
  amount: unknown = -35000,
) {
  return (await internal()!.send(
    'schedule/create' as never,
    {
      schedule: { name, posts_transaction: false },
      conditions: [
        { op: 'is', field: 'payee', value: await payeeId() },
        { op: 'is', field: 'account', value: h.fixture.accountId },
        { op: 'isapprox', field: 'date', value: date },
        { op: amountOp, field: 'amount', value: amount },
      ],
    } as never,
  )) as unknown as string;
}

async function ruleOf(scheduleId: string) {
  const s = (await schedules()).find(x => x.id === scheduleId)!;
  const rule = (await api.getRules()).find(r => r.id === s.rule)!;
  return {
    conditions: rule.conditions,
    actions: rule.actions.map(a => ({ ...a, value: 'link' })),
  };
}

async function expectRefused(
  tool: string,
  args: Record<string, unknown>,
  text?: RegExp,
) {
  const before = JSON.stringify(await schedules());
  const logged = auditLines().length;
  const res = await h.call(tool, args);
  expect(res.isError).toBe(true);
  expect(res.text).toMatch(text ?? /failed|validation/i);
  expect(JSON.stringify(await schedules())).toBe(before);
  expect(auditLines().length).toBe(logged);
  return res;
}

async function createPaycheck() {
  const id = await api.createPaycheck({
    name: 'Acme',
    newClearingAccountName: 'Acme Paycheck',
    definition: {
      payee: null,
      clearingAccount: '',
      date: { start: firstOfMonth(1), frequency: 'monthly' },
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
  const paycheck = (await api.getPaychecks()).find(p => p.id === id)!;
  return { id, schedule: paycheck.definition.paySchedule! };
}

describe('list_schedules shows what an edit needs (1.1)', () => {
  beforeEach(async () => start());

  it('A created schedule shows every field', async () => {
    const id = await appCreate('Car loan', monthly());
    const res = await h.call('list_schedules');
    const row = res.json.items.find((r: { id: string }) => r.id === id);
    expect(row).toMatchObject({
      payee_id: await payeeId(),
      account_id: h.fixture.accountId,
      amount_op: 'is',
      amount: -35000,
      posts_transaction: false,
      paycheck_id: null,
    });
    expect(row.text.date).toMatchObject({ frequency: 'monthly' });
  });

  it('A range shows its minimum and maximum', async () => {
    const id = await appCreate('Power', monthly(), 'isbetween', {
      num1: -9000,
      num2: -7000,
    });
    const row = (await h.call('list_schedules')).json.items.find(
      (r: { id: string }) => r.id === id,
    );
    expect(row).toMatchObject({
      amount_op: 'isbetween',
      amount_min: -9000,
      amount_max: -7000,
    });
  });

  it("A paycheck's schedule names its paycheck", async () => {
    const paycheck = await createPaycheck();
    const row = (await h.call('list_schedules')).json.items.find(
      (r: { id: string }) => r.id === paycheck.schedule,
    );
    expect(row.paycheck_id).toBe(paycheck.id);
  });
});

describe('API wrappers (1.2)', () => {
  beforeEach(async () => start());

  it('skipScheduleNextDate moves the next date', async () => {
    const id = await appCreate('Car loan', monthly());
    await api.skipScheduleNextDate(id);
    const s = (await schedules()).find(x => x.id === id)!;
    expect(s.next_date).toBe(firstOfMonth(3));
  });

  it('postScheduleTransaction adds a linked transaction', async () => {
    const id = await appCreate('Car loan', monthly());
    await api.postScheduleTransaction(id);
    const { data } = (await api.runQuery(
      api
        .q('transactions')
        .filter({ schedule: id })
        .select(['date', 'amount', 'account']),
    )) as { data: Array<{ date: string; amount: number; account: string }> };
    expect(data).toMatchObject([
      {
        date: firstOfMonth(2),
        amount: -35000,
        account: h.fixture.accountId,
      },
    ]);
  });
});

describe('write_create_schedule (1.3)', () => {
  beforeEach(async () => start());

  it('Adds a monthly loan payment, and the stored rule equals the app form', async () => {
    const res = await h.call('write_create_schedule', await loan());
    expect(res.isError).toBe(false);
    const s = await byName('Car loan');
    expect(res.json.schedule_id).toBe(s.id);
    expect(res.json.next_date).toBe(firstOfMonth(2));
    expect(s.next_date).toBe(firstOfMonth(2));
    expect(s.posts_transaction).toBe(false);

    const appId = await appCreate('Car loan (app)', monthly());
    expect(await ruleOf(s.id)).toEqual(await ruleOf(appId));

    const listed = (await h.call('list_schedules')).json.items.find(
      (r: { id: string }) => r.id === s.id,
    );
    expect(listed.amount).toBe(-35000);

    const lines = auditLines().filter(l => l.tool === 'write_create_schedule');
    expect(lines.map(l => l.phase)).toEqual(['attempt', 'outcome']);
    expect(lines[1].created).toEqual([s.id]);
    expect(lines[0].changes.map((c: { field: string }) => c.field)).toEqual(
      expect.arrayContaining(['name', 'payee_id', 'account_id', 'amount']),
    );
  });

  it('A one-time date', async () => {
    const date = firstOfMonth(3);
    const { recurrence: _, ...rest } = await loan();
    const res = await h.call('write_create_schedule', { ...rest, date });
    expect(res.isError).toBe(false);
    const s = await byName('Car loan');
    expect(s.date).toBe(date);
    expect(await ruleOf(s.id)).toEqual(
      await ruleOf(await appCreate('app', date)),
    );
  });

  it('Each recurrence end mode', async () => {
    const start = firstOfMonth(2);
    const cases: Array<[string, Record<string, unknown>, number]> = [
      ['never', { end_mode: 'never' }, 20],
      ['after', { end_mode: 'after_n_occurrences', end_occurrences: 3 }, 3],
      ['on', { end_mode: 'on_date', end_date: firstOfMonth(4) }, 3],
    ];
    for (const [name, ends, count] of cases) {
      const res = await h.call(
        'write_create_schedule',
        await loan({ name, recurrence: { ...monthly(start), ...ends } }),
      );
      expect(res.isError, res.text).toBe(false);
      const s = await byName(name);
      expect(
        (await api.getScheduleDates(s.date, { start, count: 20 })).length,
      ).toBe(count);
    }
  });

  it('A day pattern, with the weekend moved', async () => {
    const res = await h.call(
      'write_create_schedule',
      await loan({
        recurrence: {
          ...monthly(),
          patterns: [{ value: 15, type: 'day' }],
          skip_weekend: true,
          weekend_solve_mode: 'after',
        },
      }),
    );
    expect(res.isError, res.text).toBe(false);
    expect(await byName('Car loan')).toMatchObject({
      date: {
        patterns: [{ value: 15, type: 'day' }],
        skipWeekend: true,
        weekendSolveMode: 'after',
      },
    });
  });

  it('A date relative to another schedule, with a business calendar', async () => {
    const source = await appCreate('Payday', monthly());
    const calendar = await api.createBusinessCalendar({ name: 'Bank days' });
    const { recurrence: _, ...rest } = await loan();
    const res = await h.call('write_create_schedule', {
      ...rest,
      relative_to: {
        schedule_id: source,
        offset: 2,
        unit: 'business-days',
        direction: 'before',
        business_calendar_id: calendar,
      },
    });
    expect(res.isError, res.text).toBe(false);
    expect((await byName('Car loan')).date).toMatchObject({
      relativeTo: {
        scheduleId: source,
        offset: 2,
        unit: 'business-days',
        direction: 'before',
      },
      businessCalendarId: calendar,
    });
  });

  it('A range amount', async () => {
    const res = await h.call(
      'write_create_schedule',
      await loan({
        amount_op: 'isbetween',
        amount: undefined,
        amount_min: -9000,
        amount_max: -7000,
      }),
    );
    expect(res.isError, res.text).toBe(false);
    expect(await byName('Car loan')).toMatchObject({
      amountOp: 'isbetween',
      amount: { num1: -9000, num2: -7000 },
    });
  });

  it('Refusals change nothing and write no audit line', async () => {
    const good = await loan();
    const closed = await api.createAccount({ name: 'Old', offbudget: false });
    await api.closeAccount(closed);
    await appCreate('Taken', monthly());
    const cases: Array<[Record<string, unknown>, RegExp?]> = [
      [{ ...good, payee_id: 'nope' }, /payee_id/],
      [{ ...good, account_id: 'nope' }, /account_id/],
      [{ ...good, account_id: closed }, /account_id/],
      [{ ...good, amount: 1.5 }],
      [{ ...good, amount: undefined }, /amount/],
      [
        {
          ...good,
          amount_op: 'isbetween',
          amount: undefined,
          amount_min: -100,
          amount_max: -200,
        },
        /amount_min/,
      ],
      [{ ...good, amount_min: -1 }, /amount/],
      [{ ...good, date: firstOfMonth(3) }, /exactly one/],
      [{ ...good, recurrence: undefined }, /exactly one/],
      [{ ...good, recurrence: { ...monthly(), interval: 0 } }],
      [
        { ...good, recurrence: { ...monthly(), end_mode: 'on_date' } },
        /end_date/,
      ],
      [
        {
          ...good,
          recurrence: {
            ...monthly(),
            end_mode: 'on_date',
            end_date: firstOfMonth(1),
          },
        },
        /before/,
      ],
      [
        {
          ...good,
          recurrence: { ...monthly(), end_mode: 'after_n_occurrences' },
        },
        /end_occurrences/,
      ],
      [
        { ...good, recurrence: { ...monthly(), business_calendar_id: 'nope' } },
        /calendar/,
      ],
      [{ ...good, recurrence: { ...monthly('2999-01-01') } }, /date/],
      [{ ...good, name: 'Taken' }, /already/],
      [{ ...good, name: '   ' }],
    ];
    for (const [args, text] of cases) {
      await expectRefused('write_create_schedule', args, text);
    }
  });

  it('Refuses a relative date whose source is unknown or itself relative', async () => {
    const source = await appCreate('Payday', monthly());
    const rel = (schedule_id: string) => ({
      schedule_id,
      offset: 1,
      unit: 'days',
      direction: 'before',
    });
    const { recurrence: _, ...rest } = await loan();
    await expectRefused(
      'write_create_schedule',
      { ...rest, relative_to: rel('nope') },
      /schedule/,
    );
    const ok = await h.call('write_create_schedule', {
      ...rest,
      name: 'Rel',
      relative_to: rel(source),
    });
    expect(ok.isError).toBe(false);
    await expectRefused(
      'write_create_schedule',
      { ...rest, relative_to: rel(ok.json.schedule_id) },
      /relative/,
    );
  });
});

describe('write_update_schedule (1.4)', () => {
  beforeEach(async () => start());

  it('One field changes only that field', async () => {
    const created = await h.call('write_create_schedule', await loan());
    const id = created.json.schedule_id;
    const before = await byName('Car loan');
    const res = await h.call('write_update_schedule', {
      schedule_id: id,
      amount: -36000,
    });
    expect(res.isError, res.text).toBe(false);
    expect(res.json.text.changes).toEqual([
      { field: 'amount', before: -35000, after: -36000 },
    ]);
    const after = await byName('Car loan');
    expect(after).toEqual({ ...before, amount: -36000 });
    expect(res.json.next_date).toEqual({
      before: before.next_date,
      after: before.next_date,
    });
    const lines = auditLines().filter(l => l.tool === 'write_update_schedule');
    expect(lines.map(l => l.phase)).toEqual(['attempt', 'outcome']);
    expect(lines[0].changes).toEqual([
      { id, field: 'amount', before: -35000, after: -36000 },
    ]);
  });

  it('A new date follows the engine', async () => {
    const id = (await h.call('write_create_schedule', await loan())).json
      .schedule_id;
    const res = await h.call('write_update_schedule', {
      schedule_id: id,
      recurrence: monthly(firstOfMonth(4)),
    });
    expect(res.isError, res.text).toBe(false);
    expect(res.json.next_date.after).toBe(firstOfMonth(4));
    expect((await byName('Car loan')).next_date).toBe(firstOfMonth(4));
  });

  it('Changes the name, payee, account, auto-post and operator', async () => {
    const id = (await h.call('write_create_schedule', await loan())).json
      .schedule_id;
    const other = await api.createAccount({
      name: 'Savings',
      offbudget: false,
    });
    const res = await h.call('write_update_schedule', {
      schedule_id: id,
      name: 'Truck loan',
      account_id: other,
      posts_transaction: true,
      amount_op: 'isapprox',
    });
    expect(res.isError, res.text).toBe(false);
    expect(await byName('Truck loan')).toMatchObject({
      account: other,
      posts_transaction: true,
      amountOp: 'isapprox',
      amount: -35000,
    });
  });

  it('Refusals change nothing and write no audit line', async () => {
    const id = (await h.call('write_create_schedule', await loan())).json
      .schedule_id;
    await appCreate('Taken', monthly());
    const paycheck = await createPaycheck();
    const cases: Array<[Record<string, unknown>, RegExp?]> = [
      [{ schedule_id: id }, /nothing|field/i],
      [{ schedule_id: 'nope', amount: 1 }, /schedule/],
      [{ schedule_id: paycheck.schedule, amount: 1 }, new RegExp(paycheck.id)],
      [{ schedule_id: id, name: 'Taken' }, /already/],
      [{ schedule_id: id, payee_id: 'nope' }, /payee_id/],
      [{ schedule_id: id, amount_op: 'isbetween' }, /amount_min/],
      [{ schedule_id: id, amount_min: -1, amount_max: -2 }, /amount/],
      [{ schedule_id: id, recurrence: { ...monthly(), interval: 0 } }],
      [{ schedule_id: id, amount: -35000 }, /nothing/i],
    ];
    for (const [args, text] of cases) {
      await expectRefused('write_update_schedule', args, text);
    }
  });
});

describe('dry_run (1.5)', () => {
  beforeEach(async () => start());

  it('Create returns the next dates and writes nothing', async () => {
    const res = await h.call(
      'write_create_schedule',
      await loan({ dry_run: true }),
    );
    expect(res.isError, res.text).toBe(false);
    expect(res.json.dry_run).toBe(true);
    expect(res.json.next_dates.slice(0, 2)).toEqual([
      firstOfMonth(2),
      firstOfMonth(3),
    ]);
    expect(await schedules()).toEqual([]);
    expect(auditLines()).toEqual([]);
  });

  it('Update returns the changes and next dates and writes nothing', async () => {
    const id = (await h.call('write_create_schedule', await loan())).json
      .schedule_id;
    const logged = auditLines().length;
    const before = await schedules();
    const res = await h.call('write_update_schedule', {
      schedule_id: id,
      recurrence: monthly(firstOfMonth(4)),
      dry_run: true,
    });
    expect(res.isError, res.text).toBe(false);
    expect(res.json.dry_run).toBe(true);
    expect(res.json.next_dates[0]).toBe(firstOfMonth(4));
    expect(
      res.json.text.changes.map((c: { field: string }) => c.field),
    ).toEqual(['date']);
    expect(await schedules()).toEqual(before);
    expect(auditLines().length).toBe(logged);
  });
});

describe('write_skip_schedule_date and write_post_schedule_transaction (1.6)', () => {
  beforeEach(async () => start());

  async function made() {
    return (await h.call('write_create_schedule', await loan())).json
      .schedule_id as string;
  }

  it('Skip moves the next date and says both', async () => {
    const id = await made();
    const res = await h.call('write_skip_schedule_date', { schedule_id: id });
    expect(res.isError, res.text).toBe(false);
    expect(res.json.next_date).toEqual({
      before: firstOfMonth(2),
      after: firstOfMonth(3),
    });
    expect((await byName('Car loan')).next_date).toBe(firstOfMonth(3));
  });

  it('Post adds a linked transaction, at the next date or today', async () => {
    const id = await made();
    const res = await h.call('write_post_schedule_transaction', {
      schedule_id: id,
    });
    expect(res.isError, res.text).toBe(false);
    const today1 = await h.call('write_post_schedule_transaction', {
      schedule_id: id,
      today: true,
    });
    expect(today1.isError, today1.text).toBe(false);
    const { data } = (await api.runQuery(
      api
        .q('transactions')
        .filter({ schedule: id })
        .select(['id', 'date', 'amount', 'payee', 'account']),
    )) as { data: Array<Record<string, unknown>> };
    expect(data.map(r => String(r.date)).sort(cmp)).toEqual(
      [today(), firstOfMonth(2)].sort(cmp),
    );
    expect(data.every(r => r.amount === -35000)).toBe(true);
    expect(res.json.transaction_ids).toHaveLength(1);
    expect(data.map(r => r.id)).toContain(res.json.transaction_ids[0]);
  });

  it('Refuses completed, accountless and paycheck-managed schedules', async () => {
    const id = await made();
    const done = await appCreate('Done', monthly());
    db.runQuery(
      'UPDATE schedules SET completed = 1 WHERE id = ?',
      [done],
      false,
    );
    const noAccount = (await internal()!.send(
      'schedule/create' as never,
      {
        schedule: { name: 'No account' },
        conditions: [{ op: 'isapprox', field: 'date', value: monthly() }],
      } as never,
    )) as unknown as string;
    const paycheck = await createPaycheck();
    for (const tool of [
      'write_skip_schedule_date',
      'write_post_schedule_transaction',
    ]) {
      await expectRefused(tool, { schedule_id: 'nope' }, /schedule/);
      await expectRefused(tool, { schedule_id: done }, /completed/);
      await expectRefused(tool, { schedule_id: noAccount }, /account/);
      await expectRefused(
        tool,
        { schedule_id: paycheck.schedule },
        new RegExp(paycheck.id),
      );
    }
    expect(id).toBeTruthy();
  });

  it('Both are declared not undoable, and write_undo gives the reason', async () => {
    expect(NOT_UNDOABLE.write_skip_schedule_date).toBeTruthy();
    expect(NOT_UNDOABLE.write_post_schedule_transaction).toMatch(
      /write_delete_transactions/,
    );
    const id = await made();
    const skip = await h.call('write_skip_schedule_date', { schedule_id: id });
    const undo = await h.call('write_undo', { write_id: skip.json.write_id });
    expect(undo.isError).toBe(true);
    expect(undo.text).toContain(NOT_UNDOABLE.write_skip_schedule_date);
    expect((await byName('Car loan')).next_date).toBe(firstOfMonth(3));
  });
});

describe('write_undo of schedule creates and updates (1.7)', () => {
  beforeEach(async () => start());

  it('Declares both undoable with schedules:write', () => {
    expect(UNDOABLE.write_create_schedule).toEqual(['schedules:write']);
    expect(UNDOABLE.write_update_schedule).toEqual(['schedules:write']);
  });

  it('Undoes a create, once', async () => {
    const made = await h.call('write_create_schedule', await loan());
    const res = await h.call('write_undo', { write_id: made.json.write_id });
    expect(res.isError, res.text).toBe(false);
    expect(await schedules()).toEqual([]);
    const undoLine = auditLines().find(
      l => l.tool === 'write_undo' && l.phase === 'attempt',
    );
    expect(undoLine.undoes).toBe(made.json.write_id);
    const again = await h.call('write_undo', { write_id: made.json.write_id });
    expect(again.isError).toBe(true);
    expect(again.text).toMatch(/already undone/);
  });

  it('Undoes an update', async () => {
    const id = (await h.call('write_create_schedule', await loan())).json
      .schedule_id;
    const before = await byName('Car loan');
    const upd = await h.call('write_update_schedule', {
      schedule_id: id,
      name: 'Renamed',
      amount: -1,
      recurrence: monthly(firstOfMonth(4)),
    });
    expect(upd.isError, upd.text).toBe(false);
    const res = await h.call('write_undo', { write_id: upd.json.write_id });
    expect(res.isError, res.text).toBe(false);
    expect(await byName('Car loan')).toEqual(before);
  });

  it('Undoes a range to single amount update', async () => {
    const id = (await h.call('write_create_schedule', await loan())).json
      .schedule_id;
    const upd = await h.call('write_update_schedule', {
      schedule_id: id,
      amount_op: 'isbetween',
      amount_min: -2,
      amount_max: -1,
    });
    expect(upd.isError, upd.text).toBe(false);
    const res = await h.call('write_undo', { write_id: upd.json.write_id });
    expect(res.isError, res.text).toBe(false);
    expect(await byName('Car loan')).toMatchObject({
      amountOp: 'is',
      amount: -35000,
    });
  });

  it('Refuses an update undo after another edit', async () => {
    const id = (await h.call('write_create_schedule', await loan())).json
      .schedule_id;
    const upd = await h.call('write_update_schedule', {
      schedule_id: id,
      amount: -36000,
    });
    await api.updateSchedule(id, { amount: -37000 });
    const res = await h.call('write_undo', { write_id: upd.json.write_id });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/later change/);
    expect((await byName('Car loan')).amount).toBe(-37000);
  });

  it('Refuses a create undo after an edit, with linked transactions, or with dependents', async () => {
    const edited = await h.call('write_create_schedule', await loan());
    await api.updateSchedule(edited.json.schedule_id, { amount: -1 });
    expect(
      (await h.call('write_undo', { write_id: edited.json.write_id })).text,
    ).toMatch(/later change/);

    const posted = await h.call(
      'write_create_schedule',
      await loan({ name: 'Posted', recurrence: monthly() }),
    );
    await api.postScheduleTransaction(posted.json.schedule_id);
    expect(
      (await h.call('write_undo', { write_id: posted.json.write_id })).text,
    ).toMatch(/later change/);

    const source = await h.call(
      'write_create_schedule',
      await loan({ name: 'Source' }),
    );
    const { recurrence: _, ...rest } = await loan();
    await h.call('write_create_schedule', {
      ...rest,
      name: 'Dependent',
      relative_to: {
        schedule_id: source.json.schedule_id,
        offset: 1,
        unit: 'days',
        direction: 'before',
      },
    });
    expect(
      (await h.call('write_undo', { write_id: source.json.write_id })).text,
    ).toMatch(/later change/);
    expect((await schedules()).length).toBe(4);
  });
});

describe('Scopes (1.8)', () => {
  it.each([
    ['write_create_schedule', ['schedules:write'], 'schedules:write'],
    ['write_update_schedule', ['schedules:write'], 'schedules:write'],
    ['write_skip_schedule_date', ['schedules:write'], 'schedules:write'],
    [
      'write_post_schedule_transaction',
      ['schedules:write', 'transactions:write'],
      'schedules:write',
    ],
    [
      'write_post_schedule_transaction',
      ['schedules:write', 'transactions:write'],
      'transactions:write',
    ],
  ])('%s is refused without %s', async (tool, needs, missing) => {
    await start(
      grant(['budget:read', ...(needs as Scope[]).filter(s => s !== missing)]),
    );
    const listed = (await h.client.listTools()).tools.find(
      t => t.name === tool,
    )!;
    for (const s of needs) expect(listed.description).toContain(s);
    expect(listed.description).toMatch(/write_undo reverses it|Not undoable/);
    const res = await h.call(
      tool,
      tool === 'write_create_schedule'
        ? await loan()
        : { schedule_id: 'x', name: 'x' },
    );
    expect(res.isError).toBe(true);
    expect(res.text).toContain(missing);
    expect(auditLines().every(l => l.phase === 'refused')).toBe(true);
  });
});
