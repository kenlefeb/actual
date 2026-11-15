// Fork-only (sc-4341). The contract for `native/schedules-paychecks`: the
// Swift tests decode the same fixtures, so a shape change fails both sides.
// Regenerate with `vitest -u`.
import { aqlQuery } from '#server/aql';
import { app as businessCalendarsApp } from '#server/business-calendars/app';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { app as paychecksApp } from '#server/paychecks/app';
import * as prefs from '#server/prefs';
import { app as schedulesApp } from '#server/schedules/app';
import { loadRules } from '#server/transactions/transaction-rules';
import { businessCalendarPresets } from '#shared/business-calendar-presets';
import { planPaycheck } from '#shared/paychecks';
import { q } from '#shared/query';
import { setScheduleDates } from '#shared/schedule-date-lookup';
import type { PaycheckDefinition, ScheduleEntity } from '#types/models';

import { app } from './app';

const read = () => app.handlers['native/schedules-paychecks']();

async function addAccount(id: string, name: string) {
  await db.insertAccount({ id, name });
  await db.insertPayee({ id: `transfer-${id}`, name: '', transfer_acct: id });
}

let calendar = '';

const acme = (
  fields: Partial<PaycheckDefinition> = {},
): PaycheckDefinition => ({
  payee: 'acme',
  clearingAccount: 'clearing',
  // The 15th and last day of each month, moved before non-business days
  date: {
    start: '2026-11-01',
    frequency: 'monthly',
    patterns: [
      { type: 'day', value: 15 },
      { type: 'day', value: -1 },
    ],
  },
  weekendSolveMode: 'before',
  grossAmount: 300000,
  incomeCategory: 'income',
  deductions: [
    { id: 'tax', name: 'Federal tax', amount: 60000, category: 'taxes' },
  ],
  deposits: [
    { id: 'savings', account: 'savings', kind: 'fixed', value: 40000 },
    { id: 'checking', account: 'checking', kind: 'remainder', value: 0 },
  ],
  ...fields,
});

async function createPaycheck(name: string, fields = {}) {
  const id = await paychecksApp.handlers['paycheck-create']({
    name,
    definition: acme(fields),
  });
  const paycheck = (await paychecksApp.handlers['paychecks-get']()).find(
    p => p.id === id,
  );
  return { id, pay: paycheck?.definition.paySchedule ?? '' };
}

let count = 0;
// A posted pay transaction: split into gross pay and the deduction
async function postPay(pay: string, date: string) {
  const parent = await db.insertTransaction({
    id: `pay-${++count}`,
    account: 'clearing',
    amount: 240000,
    date,
    schedule: pay,
    is_parent: true,
  });
  for (const [index, amount] of [300000, -60000].entries()) {
    await db.insertTransaction({
      id: `${parent}-${index + 1}`,
      account: 'clearing',
      date,
      amount,
      is_child: true,
      parent_id: parent,
    });
  }
  return parent;
}

async function createRent() {
  return schedulesApp.handlers['schedule/create']({
    schedule: { name: 'Rent' },
    conditions: [
      { op: 'is', field: 'date', value: '2026-11-12' },
      { op: 'is', field: 'amount', value: -150000 },
      { op: 'is', field: 'account', value: 'checking' },
    ],
  });
}

// What the web Paychecks section computes for the same budget
async function webPlans() {
  const paychecks = await paychecksApp.handlers['paychecks-get']();
  const { data: schedules } = (await aqlQuery(q('schedules').select('*'))) as {
    data: ScheduleEntity[];
  };
  setScheduleDates(schedules.map(s => [s.id, s._date] as const));
  const { data: posted } = (await aqlQuery(
    q('transactions')
      .filter({
        schedule: {
          $oneof: paychecks.flatMap(p => p.definition.paySchedule ?? []),
        },
      })
      .select(['schedule', 'date']),
  )) as { data: { schedule: string; date: string }[] };
  const byId = new Map(schedules.map(s => [s.id, s]));
  return paychecks.map(p => ({
    id: p.id,
    plan: planPaycheck(
      p,
      byId,
      '2026-11-10',
      posted.flatMap(t =>
        t.schedule === p.definition.paySchedule ? t.date : [],
      ),
    ),
  }));
}

beforeEach(async () => {
  await global.emptyDatabase()();
  await prefs.loadPrefs();
  await loadMappings();
  await loadRules();
  schedulesApp.startServices();
  vi.useFakeTimers({ toFake: ['Date'] });
  // Tuesday
  vi.setSystemTime(new Date(2026, 10, 10));
  await db.insert('preferences', {
    id: 'flags.businessCalendars',
    value: 'true',
  });

  calendar = await businessCalendarsApp.handlers['business-calendar-create']({
    name: 'U.S. Federal Holidays',
    ...businessCalendarPresets[0].calendar,
  });
  await addAccount('clearing', 'Acme Paycheck');
  await addAccount('checking', 'Checking');
  await addAccount('savings', 'Savings');
  await db.insertPayee({ id: 'acme', name: 'Acme' });
  await db.insertCategoryGroup({ id: 'ig', name: 'Income', is_income: 1 });
  await db.insertCategory({
    id: 'income',
    name: 'Income',
    cat_group: 'ig',
    is_income: 1,
  });
  await db.insertCategoryGroup({ id: 'eg', name: 'Expenses' });
  await db.insertCategory({ id: 'taxes', name: 'Taxes', cat_group: 'eg' });
  for (const id of ['clearing', 'checking', 'savings']) {
    await paychecksApp.handlers['account-set-business-days']({
      id,
      businessCalendarId: calendar,
      depositDaysEarly: 0,
    });
  }
});

afterEach(() => {
  vi.useRealTimers();
});

describe('native/schedules-paychecks', () => {
  it('matches the web plan, hides own schedules and joins the warning', async () => {
    const { id, pay } = await createPaycheck('Acme');
    const rent = await createRent();
    // A split pay transaction, a deleted one and a pay date imported twice
    const deleted = await postPay(pay, '2026-10-30');
    for (const id of [deleted, `${deleted}-1`, `${deleted}-2`]) {
      await db.deleteTransaction({ id });
    }
    await postPay(pay, '2026-10-30');
    await postPay(pay, '2026-10-30');

    const result = await read();

    const web = await webPlans();
    expect(result.paychecks.map(p => p.id)).toEqual([id]);
    const [acmeRow] = result.paychecks;
    const [webAcme] = web;
    expect(acmeRow.netAmount).toBe(webAcme.plan.netAmount);
    expect(acmeRow.next?.date).toBe(webAcme.plan.next?.date);
    expect(acmeRow.skipped).toEqual(webAcme.plan.skipped);
    expect(acmeRow.later.map(l => l.date)).toEqual(
      webAcme.plan.later.map(l => l.date),
    );
    expect(acmeRow.next?.deposits).toEqual(
      webAcme.plan.next?.deposits.map(d => ({
        ...d,
        accountName: d.account === 'savings' ? 'Savings' : 'Checking',
      })),
    );
    expect(acmeRow.next?.date).toBe('2026-11-13');
    expect(acmeRow.later.map(l => l.date)).toEqual([
      '2026-11-30',
      '2026-12-15',
      '2026-12-31',
    ]);

    // Only Rent: Acme's pay and deposit schedules are left out
    expect(result.schedules).toEqual([
      expect.objectContaining({
        id: rent,
        name: 'Rent',
        accountName: 'Checking',
        amount: -150000,
        nextDate: '2026-11-12',
        // getStatus' today is 2017-01-01 under test
        status: 'scheduled',
      }),
    ]);

    // 2,400.00 sits in the clearing account; no deposit for Oct 30 linked
    expect(acmeRow.clearingWarning).toEqual({
      clearingAccount: 'clearing',
      clearingAccountName: 'Acme Paycheck',
      balance: 240000 * 2,
      missingDeposits: [
        { id: 'savings', account: 'savings', accountName: 'Savings' },
        { id: 'checking', account: 'checking', accountName: 'Checking' },
      ],
    });
    expect(result.summary).toEqual({
      hasPaychecks: true,
      nextDate: '2026-11-13',
      netAmount: 240000,
      scheduleCount: 1,
      anyWarning: true,
    });
    expect(result.enabled).toBe(true);
    await expect(
      JSON.stringify(
        { ...result, paychecks: [{ ...acmeRow, id: 'acme' }] },
        null,
        2,
      ).replaceAll(rent, 'rent') + '\n',
    ).toMatchFileSnapshot('./fixtures/schedules-paychecks.json');
  });

  it('shows a skipped pay date and sorts by next date', async () => {
    const { id } = await createPaycheck('Acme');
    const side = await createPaycheck('Side gig', {
      date: {
        start: '2026-12-01',
        frequency: 'monthly',
        patterns: [{ type: 'day', value: 4 }],
      },
    });
    await paychecksApp.handlers['paycheck-skip-next']({ id });

    const result = await read();

    expect(result.paychecks.map(p => p.id)).toEqual([id, side.id]);
    const acmeRow = result.paychecks[0];
    expect(acmeRow.skipped).toEqual(['2026-11-13']);
    expect(acmeRow.next?.date).toBe('2026-11-30');
    expect(acmeRow.later).toHaveLength(3);
    expect(result.summary.nextDate).toBe('2026-11-30');
  });

  it('counts only the schedules the list shows by default', async () => {
    const rent = await createRent();
    const done = await schedulesApp.handlers['schedule/create']({
      schedule: { name: 'Old loan' },
      conditions: [{ op: 'is', field: 'date', value: '2026-01-01' }],
    });
    await db.update('schedules', { id: done, completed: 1 });

    const result = await read();

    // Completed schedules come back flagged; the list hides them by default
    expect(result.schedules.map(s => [s.id, s.completed, s.status])).toEqual(
      expect.arrayContaining([
        [rent, false, 'scheduled'],
        [done, true, 'completed'],
      ]),
    );
    expect(result.schedules).toHaveLength(2);
    expect(result.summary.scheduleCount).toBe(1);
  });

  it('is empty for a budget with no paychecks or schedules', async () => {
    const result = await read();
    expect(result).toMatchObject({
      enabled: true,
      currencyDecimalPlaces: 2,
      paychecks: [],
      schedules: [],
      summary: {
        hasPaychecks: false,
        nextDate: null,
        netAmount: null,
        scheduleCount: 0,
        anyWarning: false,
      },
    });
    await expect(JSON.stringify(result, null, 2) + '\n').toMatchFileSnapshot(
      './fixtures/schedules-paychecks-empty.json',
    );
  });

  it('has no next date when every paycheck ended', async () => {
    const { pay } = await createPaycheck('Acme');
    await db.update('schedules', { id: pay, completed: 1 });

    const result = await read();

    expect(result.paychecks[0].next).toBeNull();
    expect(result.paychecks[0].later).toEqual([]);
    expect(result.summary).toMatchObject({
      hasPaychecks: true,
      nextDate: null,
      netAmount: null,
    });
  });

  it('follows the paychecks feature flag', async () => {
    await db.update('preferences', { id: 'flags.paychecks', value: 'false' });
    expect((await read()).enabled).toBe(false);
  });

  it('shares the currency block with native/budget-month', async () => {
    await db.insert('preferences', { id: 'defaultCurrencyCode', value: 'JPY' });
    expect(await read()).toMatchObject({
      currencyCode: 'JPY',
      currencyDecimalPlaces: 0,
      currencySymbolPosition: 'before',
      numberFormat: 'comma-dot',
    });
  });
});
