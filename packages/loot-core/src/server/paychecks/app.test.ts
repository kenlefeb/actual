import MockDate from 'mockdate';

import { reconcileTransactions } from '#server/accounts/sync';
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { getRuleForSchedule, app as schedulesApp } from '#server/schedules/app';
import { loadRules } from '#server/transactions/transaction-rules';
import { undo } from '#server/undo';
import { setBusinessCalendars } from '#shared/business-calendar-lookup';
import { businessCalendarPresets } from '#shared/business-calendar-presets';
import { q } from '#shared/query';
import { setScheduleDates } from '#shared/schedule-date-lookup';
import type { PaycheckDefinition } from '#types/models';

import { app } from './app';

const handlers = app.handlers;

const federal = {
  id: 'federal',
  name: 'U.S. Federal Holidays',
  ...businessCalendarPresets[0].calendar,
};
const reserve = {
  id: 'reserve',
  name: 'U.S. Federal Reserve',
  ...businessCalendarPresets[1].calendar,
};

async function addAccount(id: string, offbudget: 0 | 1 = 0) {
  await db.insertAccount({ id, name: id, offbudget });
  await db.insertPayee({ id: `transfer-${id}`, name: '', transfer_acct: id });
}

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
    { id: 'tax', name: 'Federal tax', amount: 45000, category: 'taxes' },
    { id: 'health', name: 'Health', amount: 12000, category: 'insurance' },
    {
      id: '401k',
      name: '401(k)',
      amount: 18000,
      category: 'retirement-contrib',
      transferAccount: 'retirement',
    },
  ],
  deposits: [
    { id: 'savings', account: 'savings', kind: 'percent', value: 10 },
    { id: 'checking', account: 'checking', kind: 'remainder', value: 0 },
  ],
  ...fields,
});

const getPaycheck = async (id: string) =>
  (await handlers['paychecks-get']()).find(p => p.id === id);

const scheduleRow = async (id: string | null | undefined) =>
  (await aqlQuery(q('schedules').filter({ id }).select('*'))).data[0];

// The schedules view reads conditions through paths the app tracks at
// runtime, so tests read them from the rule
const condition = async (id: string | null | undefined, field: string) =>
  (await getRuleForSchedule(id ?? null))
    .serialize()
    .conditions.find(c => c.field === field)?.value;

const dateCondition = (id: string | null | undefined) => condition(id, 'date');

const amount = (id: string | null | undefined) => condition(id, 'amount');

const upcoming = async (id: string | null | undefined, count = 2) =>
  schedulesApp.handlers['schedule/get-upcoming-dates']({
    config: await dateCondition(id),
    count,
  });

const transactions = () =>
  db.all<db.DbViewTransactionInternal>(
    'SELECT * FROM v_transactions_internal WHERE tombstone = 0',
  );

async function createAcme(fields: Partial<PaycheckDefinition> = {}) {
  const id = await handlers['paycheck-create']({
    name: 'Acme',
    definition: acme(fields),
  });
  const paycheck = await getPaycheck(id);
  if (!paycheck) throw new Error('Missing paycheck');
  const deposit = (account: string) =>
    paycheck.definition.deposits.find(d => d.account === account)?.schedule ??
    '';
  return {
    id,
    pay: paycheck.definition.paySchedule ?? '',
    checking: deposit('checking'),
    savings: deposit('savings'),
  };
}

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
  await loadRules();
  // Fills the schedule view's condition paths, as at budget load
  schedulesApp.startServices();
  MockDate.set(new Date(2026, 10, 1));
  setBusinessCalendars([federal, reserve]);

  await addAccount('clearing');
  await addAccount('checking');
  await addAccount('savings');
  await addAccount('retirement', 1);
  await db.insertPayee({ id: 'acme', name: 'Acme' });
  await db.insertCategoryGroup({
    id: 'income-group',
    name: 'Income',
    is_income: 1,
  });
  await db.insertCategory({
    id: 'income',
    name: 'Income',
    cat_group: 'income-group',
    is_income: 1,
  });
  await db.insertCategoryGroup({
    id: 'expenses',
    name: 'Expenses',
    is_income: 0,
  });
  for (const id of ['taxes', 'insurance', 'retirement-contrib']) {
    await db.insertCategory({
      id,
      name: id,
      cat_group: 'expenses',
      is_income: 0,
    });
  }

  await handlers['account-set-business-days']({
    id: 'clearing',
    businessCalendarId: 'federal',
    depositDaysEarly: 0,
  });
  await handlers['account-set-business-days']({
    id: 'checking',
    businessCalendarId: 'reserve',
    depositDaysEarly: 2,
  });
  await handlers['account-set-business-days']({
    id: 'savings',
    businessCalendarId: 'reserve',
    depositDaysEarly: 0,
  });
});

afterEach(async () => {
  await schedulesApp.stopServices();
  setBusinessCalendars([]);
  setScheduleDates([]);
  MockDate.reset();
});

describe('account business days', () => {
  it('stores the calendar and days early, and undo restores them', async () => {
    const account = () =>
      db.first<db.DbAccount>('SELECT * FROM accounts WHERE id = ?', [
        'checking',
      ]);
    expect(await account()).toMatchObject({
      business_calendar_id: 'reserve',
      deposit_days_early: 2,
    });

    await handlers['account-set-business-days']({
      id: 'checking',
      businessCalendarId: null,
      depositDaysEarly: 1,
    });
    expect(await account()).toMatchObject({
      business_calendar_id: null,
      deposit_days_early: 1,
    });

    await undo();
    expect(await account()).toMatchObject({
      business_calendar_id: 'reserve',
      deposit_days_early: 2,
    });
  });

  it.each([-1, 1.5, 11])('rejects %s days early', async days => {
    await expect(
      handlers['account-set-business-days']({
        id: 'checking',
        businessCalendarId: null,
        depositDaysEarly: days,
      }),
    ).rejects.toThrow('whole number from 0 to 10');
  });

  it('moves deposit dates when the account changes, and undo restores them', async () => {
    const { checking } = await createAcme();
    expect(await upcoming(checking)).toEqual(['2026-11-10', '2026-11-25']);

    // Stored next dates compare write times, so let the clock move on
    MockDate.set(new Date(2026, 10, 1, 12));
    await handlers['account-set-business-days']({
      id: 'checking',
      businessCalendarId: 'reserve',
      depositDaysEarly: 1,
    });
    // One business day before Fri Nov 13 is Thu Nov 12
    expect(await upcoming(checking)).toEqual(['2026-11-12', '2026-11-27']);
    expect((await scheduleRow(checking)).next_date).toBe('2026-11-12');

    await undo();
    await vi.waitFor(async () =>
      expect(await upcoming(checking)).toEqual(['2026-11-10', '2026-11-25']),
    );
  });
});

describe('paychecks', () => {
  it('creates a clearing account when asked', async () => {
    const id = await handlers['paycheck-create']({
      name: 'Acme',
      definition: acme({ clearingAccount: '' }),
      newClearingAccountName: 'Acme Paycheck',
    });
    const paycheck = await getPaycheck(id);
    const account = await db.first<db.DbAccount>(
      'SELECT * FROM accounts WHERE id = ?',
      [paycheck?.definition.clearingAccount ?? ''],
    );
    expect(account).toMatchObject({ name: 'Acme Paycheck', offbudget: 0 });
    expect(
      (await transactions()).filter(t => t.account === account?.id),
    ).toEqual([]);
  });

  it('rejects an invalid paycheck', async () => {
    await expect(
      handlers['paycheck-create']({
        name: 'Acme',
        definition: acme({
          deposits: [
            { id: 'c', account: 'checking', kind: 'fixed', value: 200000 },
          ],
        }),
      }),
    ).rejects.toThrow('deposits-do-not-add-up');
  });

  it('schedules the pay date and each deposit on its bank date', async () => {
    const { pay, checking, savings } = await createAcme();
    expect(await upcoming(pay)).toEqual(['2026-11-13', '2026-11-30']);
    // Wed Nov 11 is Veterans Day; Thu Nov 26 is Thanksgiving
    expect(await upcoming(checking)).toEqual(['2026-11-10', '2026-11-25']);
    expect(await upcoming(savings)).toEqual(['2026-11-13', '2026-11-30']);

    expect(await scheduleRow(pay)).toMatchObject({
      name: 'Acme',
      posts_transaction: true,
    });
    expect(await amount(pay)).toBe(225000);
    expect(await scheduleRow(checking)).toMatchObject({
      name: 'Acme → checking',
      posts_transaction: false,
    });
    expect(await amount(checking)).toBe(202500);
    expect(await amount(savings)).toBe(22500);
  });

  it('posts gross pay and deductions as one split transaction', async () => {
    const { pay } = await createAcme();
    await schedulesApp.handlers['schedule/post-transaction']({ id: pay });

    const rows = await transactions();
    const parent = rows.find(t => t.account === 'clearing' && t.is_parent);
    expect(parent).toMatchObject({ amount: 225000, schedule: pay });
    const children = rows.filter(t => t.parent_id === parent?.id);
    expect(children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: 300000, category: 'income' }),
        expect.objectContaining({ amount: -45000, category: 'taxes' }),
        expect.objectContaining({ amount: -12000, category: 'insurance' }),
        expect.objectContaining({
          amount: -18000,
          payee: 'transfer-retirement',
          category: 'retirement-contrib',
        }),
      ]),
    );
    expect(children).toHaveLength(4);
    expect(rows.find(t => t.account === 'retirement')?.amount).toBe(18000);
  });

  it('posts a deposit only when it posts automatically', async () => {
    const { savings, checking } = await createAcme({
      deposits: [
        {
          id: 'savings',
          account: 'savings',
          kind: 'percent',
          value: 10,
          postAutomatically: true,
        },
        { id: 'checking', account: 'checking', kind: 'remainder', value: 0 },
      ],
    });
    expect((await scheduleRow(savings)).posts_transaction).toBe(true);
    expect((await scheduleRow(checking)).posts_transaction).toBe(false);

    await schedulesApp.handlers['schedule/post-transaction']({ id: savings });
    const rows = await transactions();
    expect(rows.find(t => t.account === 'savings')).toMatchObject({
      amount: 22500,
      date: 20261113,
      payee: 'transfer-clearing',
    });
    expect(rows.find(t => t.account === 'clearing')?.amount).toBe(-22500);

    // An exact import merges with the posted deposit
    await reconcileTransactions('savings', [
      { date: '2026-11-13', amount: 22500, imported_payee: 'ACME PAYROLL' },
    ]);
    expect(
      (await transactions()).filter(t => t.account === 'savings'),
    ).toHaveLength(1);
  });

  it('links an imported deposit near the expected amount as a transfer', async () => {
    const { checking } = await createAcme();
    await reconcileTransactions('checking', [
      { date: '2026-11-10', amount: 203140, imported_payee: 'ACME PAYROLL' },
    ]);
    const rows = await transactions();
    expect(rows.find(t => t.account === 'checking')).toMatchObject({
      amount: 203140,
      schedule: checking,
      payee: 'transfer-clearing',
    });
    expect(rows.find(t => t.account === 'clearing')?.amount).toBe(-203140);
  });

  it('does not link an import far from the expected amount', async () => {
    await createAcme();
    await reconcileTransactions('checking', [
      { date: '2026-11-10', amount: 260000, imported_payee: 'ACME PAYROLL' },
    ]);
    expect(
      (await transactions()).find(t => t.account === 'checking'),
    ).toMatchObject({ schedule: null });
  });

  it('updates future amounts without changing posted transactions', async () => {
    const { id, pay, checking } = await createAcme();
    await schedulesApp.handlers['schedule/post-transaction']({ id: pay });

    const paycheck = await getPaycheck(id);
    if (!paycheck) throw new Error('Missing paycheck');
    await handlers['paycheck-update']({
      id,
      name: 'Acme',
      definition: { ...paycheck.definition, grossAmount: 320000 },
    });

    expect(await amount(pay)).toBe(245000);
    expect(await amount(checking)).toBe(220500);
    expect(
      (await transactions()).find(t => t.account === 'clearing' && t.is_parent)
        ?.amount,
    ).toBe(225000);
  });

  it('removes a deposit schedule with its deposit', async () => {
    const { id, savings, checking } = await createAcme();
    const paycheck = await getPaycheck(id);
    if (!paycheck) throw new Error('Missing paycheck');
    await handlers['paycheck-update']({
      id,
      name: 'Acme',
      definition: {
        ...paycheck.definition,
        deposits: paycheck.definition.deposits.filter(
          d => d.account !== 'savings',
        ),
      },
    });
    expect(await scheduleRow(savings)).toBeUndefined();
    expect(await amount(checking)).toBe(225000);
  });

  it('deletes a paycheck but keeps its account and transactions', async () => {
    const { id, pay, checking } = await createAcme();
    await schedulesApp.handlers['schedule/post-transaction']({ id: pay });

    await handlers['paycheck-delete']({ id });
    expect(await getPaycheck(id)).toBeUndefined();
    expect(await scheduleRow(pay)).toBeUndefined();
    expect(await scheduleRow(checking)).toBeUndefined();
    expect(
      await db.first('SELECT id FROM accounts WHERE id = ? AND tombstone = 0', [
        'clearing',
      ]),
    ).toBeTruthy();
    expect((await transactions()).some(t => t.account === 'clearing')).toBe(
      true,
    );

    await undo();
    await vi.waitFor(async () => {
      expect(await getPaycheck(id)).toBeDefined();
      expect(await scheduleRow(checking)).toBeDefined();
    });
  });

  it('skips the next paycheck and its deposits together', async () => {
    const { id, pay, checking, savings } = await createAcme();
    await handlers['paycheck-skip-next']({ id });
    expect((await scheduleRow(pay)).next_date).toBe('2026-11-30');
    expect((await scheduleRow(checking)).next_date).toBe('2026-11-25');
    expect((await scheduleRow(savings)).next_date).toBe('2026-11-30');
  });

  it('keeps a skipped paycheck skipped when it is saved again', async () => {
    const { id, pay, checking } = await createAcme();
    await handlers['paycheck-skip-next']({ id });
    const paycheck = await getPaycheck(id);
    if (!paycheck) throw new Error('Missing paycheck');
    await handlers['paycheck-update']({
      id,
      name: 'Acme pay',
      definition: { ...paycheck.definition, grossAmount: 310000 },
    });
    expect((await scheduleRow(pay)).next_date).toBe('2026-11-30');
    expect((await scheduleRow(checking)).next_date).toBe('2026-11-25');
  });

  it('ignores schedule ids sent by the client', async () => {
    const rent = await schedulesApp.handlers['schedule/create']({
      schedule: { name: 'Rent' },
      conditions: [{ op: 'is', field: 'date', value: '2026-12-01' }],
    });
    const id = await handlers['paycheck-create']({
      name: 'Acme',
      definition: { ...acme(), paySchedule: rent },
    });
    expect((await getPaycheck(id))?.definition.paySchedule).not.toBe(rent);
    await handlers['paycheck-delete']({ id });
    expect((await scheduleRow(rent))?.name).toBe('Rent');
  });

  it('rejects a paycheck before writing anything', async () => {
    const schedulesBefore = await db.all('SELECT id FROM schedules');
    const accountsBefore = await db.all('SELECT id FROM accounts');
    await expect(
      handlers['paycheck-create']({
        name: 'Acme',
        definition: acme({
          deposits: [
            { id: 'a', account: 'checking', kind: 'fixed', value: 20000 },
            { id: 'b', account: 'checking', kind: 'remainder', value: 0 },
          ],
        }),
        newClearingAccountName: 'Acme Paycheck',
      }),
    ).rejects.toThrow('different account');
    await expect(
      handlers['paycheck-create']({
        name: 'Acme',
        definition: acme({ grossAmount: -5 }),
      }),
    ).rejects.toThrow('amounts must be zero or more');
    await expect(
      handlers['paycheck-create']({
        name: 'Acme',
        definition: acme({ clearingAccount: 'retirement' }),
      }),
    ).rejects.toThrow('open on-budget account');
    expect(await db.all('SELECT id FROM schedules')).toEqual(schedulesBefore);
    expect(await db.all('SELECT id FROM accounts')).toEqual(accountsBefore);
  });

  it('rejects deposit accounts that share a name before writing anything', async () => {
    await db.insertAccount({ id: 'savings-2', name: 'savings', offbudget: 0 });
    const deposits: PaycheckDefinition['deposits'] = [
      { id: 'savings', account: 'savings', kind: 'percent', value: 10 },
      { id: 'savings-2', account: 'savings-2', kind: 'percent', value: 5 },
      { id: 'checking', account: 'checking', kind: 'remainder', value: 0 },
    ];
    const schedulesBefore = await db.all('SELECT * FROM schedules');
    const rulesBefore = await db.all('SELECT * FROM rules');
    const accountsBefore = await db.all('SELECT id FROM accounts');
    await expect(
      handlers['paycheck-create']({
        name: 'Acme',
        definition: acme({ clearingAccount: '', deposits }),
        newClearingAccountName: 'Acme Paycheck',
      }),
    ).rejects.toThrow('different names');
    expect(await db.all('SELECT * FROM schedules')).toEqual(schedulesBefore);
    expect(await db.all('SELECT * FROM rules')).toEqual(rulesBefore);
    expect(await db.all('SELECT id FROM accounts')).toEqual(accountsBefore);

    const { id, pay } = await createAcme();
    const paycheck = await getPaycheck(id);
    if (!paycheck) throw new Error('Missing paycheck');
    const schedulesSaved = await db.all('SELECT * FROM schedules');
    const rulesSaved = await db.all('SELECT * FROM rules');
    await expect(
      handlers['paycheck-update']({
        id,
        name: 'Acme',
        definition: { ...paycheck.definition, grossAmount: 320000, deposits },
      }),
    ).rejects.toThrow('different names');
    expect(await db.all('SELECT * FROM schedules')).toEqual(schedulesSaved);
    expect(await db.all('SELECT * FROM rules')).toEqual(rulesSaved);
    expect(await amount(pay)).toBe(225000);
  });

  it('rejects a deleted transfer account before writing anything', async () => {
    const { id, pay } = await createAcme();
    const paycheck = await getPaycheck(id);
    if (!paycheck) throw new Error('Missing paycheck');
    // As a forced delete of an account with transactions does
    await db.deleteAccount({ id: 'retirement' });
    await db.deleteTransferPayee({ id: 'transfer-retirement' });
    const tables = () =>
      Promise.all(
        ['schedules', 'rules', 'accounts', 'payees'].map(table =>
          db.all(`SELECT * FROM ${table}`),
        ),
      );
    const before = await tables();
    await expect(
      handlers['paycheck-create']({
        name: 'Acme 2',
        definition: acme({ clearingAccount: '' }),
        newClearingAccountName: 'Acme Paycheck',
      }),
    ).rejects.toThrow('transfer account for 401(k) no longer exists');
    await expect(
      handlers['paycheck-update']({
        id,
        name: 'Acme',
        definition: { ...paycheck.definition, grossAmount: 320000 },
      }),
    ).rejects.toThrow('transfer account for 401(k) no longer exists');
    expect(await tables()).toEqual(before);
    expect(await amount(pay)).toBe(225000);
  });

  it('rejects a paycheck whose schedule name is taken', async () => {
    await schedulesApp.handlers['schedule/create']({
      schedule: { name: 'Acme' },
      conditions: [{ op: 'is', field: 'date', value: '2026-12-01' }],
    });
    await expect(createAcme()).rejects.toThrow('"Acme" already exists');
  });

  it('records schedules recreated by an account change', async () => {
    const { id, checking } = await createAcme();
    await schedulesApp.handlers['schedule/delete']({ id: checking });
    await handlers['account-set-business-days']({
      id: 'checking',
      businessCalendarId: 'reserve',
      depositDaysEarly: 1,
    });
    const recreated = (await getPaycheck(id))?.definition.deposits.find(
      d => d.account === 'checking',
    )?.schedule;
    expect(recreated).not.toBe(checking);
    expect(await scheduleRow(recreated)).toBeDefined();
  });
});

describe('editor additions', () => {
  it('moves every paycheck depositing to an account when its days early change', async () => {
    const acmePaycheck = await createAcme();
    await addAccount('side-clearing');
    const sideId = await handlers['paycheck-create']({
      name: 'Side gig',
      definition: acme({
        payee: null,
        clearingAccount: 'side-clearing',
        deductions: [],
        deposits: [
          { id: 'checking', account: 'checking', kind: 'remainder', value: 0 },
        ],
      }),
    });
    const sideChecking =
      (await getPaycheck(sideId))?.definition.deposits[0].schedule ?? '';
    expect(await upcoming(acmePaycheck.checking)).toEqual([
      '2026-11-10',
      '2026-11-25',
    ]);
    expect(await upcoming(sideChecking)).toEqual(['2026-11-10', '2026-11-25']);

    MockDate.set(new Date(2026, 10, 1, 12));
    await handlers['account-set-business-days']({
      id: 'checking',
      businessCalendarId: 'reserve',
      depositDaysEarly: 1,
    });
    expect(
      await db.first<db.DbAccount>('SELECT * FROM accounts WHERE id = ?', [
        'checking',
      ]),
    ).toMatchObject({ deposit_days_early: 1 });
    expect(await upcoming(acmePaycheck.checking)).toEqual([
      '2026-11-12',
      '2026-11-27',
    ]);
    expect(await upcoming(sideChecking)).toEqual(['2026-11-12', '2026-11-27']);
  });

  it('totals posted pay transactions by year, including edits', async () => {
    const { id, pay } = await createAcme();
    let count = 0;
    const post = async (date: string) => {
      const parent = await db.insertTransaction({
        id: `pay-${++count}`,
        account: 'clearing',
        amount: 225000,
        date,
        schedule: pay,
        is_parent: true,
      });
      const splits = [
        { amount: 300000, notes: null },
        { amount: -45000, notes: 'Federal tax' },
        { amount: -12000, notes: 'Health' },
        { amount: -18000, notes: '401(k)' },
      ];
      for (const [index, split] of splits.entries()) {
        await db.insertTransaction({
          id: `${parent}-${index + 1}`,
          account: 'clearing',
          date,
          is_child: true,
          parent_id: parent,
          ...split,
        });
      }
      return parent;
    };
    for (let month = 1; month <= 12; month++) {
      const mm = String(month).padStart(2, '0');
      await post(`2025-${mm}-15`);
      await post(`2025-${mm}-28`);
    }
    // A 500.00 bonus added to gross pay on one paycheck
    await db.updateTransaction({ id: 'pay-5-1', amount: 350000 });
    await db.updateTransaction({ id: 'pay-5', amount: 275000 });
    // This year's paycheck posted by the schedule itself
    await schedulesApp.handlers['schedule/post-transaction']({ id: pay });
    // Outside both years, and a transaction not from the pay schedule
    await post('2024-12-31');
    await db.insertTransaction({
      account: 'clearing',
      amount: 1000,
      date: '2025-06-01',
    });

    expect(await handlers['paycheck-year-to-date']({ id })).toEqual([
      {
        year: 2026,
        gross: 300000,
        deductions: [
          { name: 'Federal tax', amount: 45000 },
          { name: 'Health', amount: 12000 },
          { name: '401(k)', amount: 18000 },
        ],
        net: 225000,
      },
      {
        year: 2025,
        gross: 7250000,
        deductions: [
          { name: 'Federal tax', amount: 1080000 },
          { name: 'Health', amount: 288000 },
          { name: '401(k)', amount: 432000 },
        ],
        net: 5450000,
      },
    ]);
  });
});
