// Fork-only (sc-4343). The native paycheck editor's loot-core side:
// `native/paycheck-preview` (design Decision 3), the all-or-nothing
// `native/paycheck-save` (Decision 4) and year-to-date's `hasHistory`
// (Decision 6).
import { readFileSync } from 'node:fs';

import { aqlQuery } from '#server/aql';
import { app as businessCalendarsApp } from '#server/business-calendars/app';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { app as paychecksApp } from '#server/paychecks/app';
import * as prefs from '#server/prefs';
import { app as schedulesApp } from '#server/schedules/app';
import { loadRules } from '#server/transactions/transaction-rules';
import { clearUndo, redo, undo } from '#server/undo';
import { businessCalendarPresets } from '#shared/business-calendar-presets';
import { q } from '#shared/query';
import type { PaycheckDefinition } from '#types/models';

import { app } from './app';

const handlers = paychecksApp.handlers;
const preview = app.handlers['native/paycheck-preview'];
const save = app.handlers['native/paycheck-save'];
const nativeUndo = (token: string) => app.handlers['native/undo']({ token });

async function addAccount(id: string, name: string) {
  await db.insertAccount({ id, name });
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
    interval: 1,
    patterns: [
      { type: 'day', value: 15 },
      { type: 'day', value: -1 },
    ],
    endMode: 'never',
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

const daysEarly = async (id: string) =>
  (
    await db.first<{ deposit_days_early: number }>(
      'SELECT deposit_days_early FROM accounts WHERE id = ?',
      [id],
    )
  )?.deposit_days_early ?? 0;

// Everything a save can change, to compare before and after
async function snapshot() {
  return {
    paychecks: await db.all(
      'SELECT id, name, definition, tombstone FROM paychecks ORDER BY id',
    ),
    schedules: await db.all(
      'SELECT id, name, rule, tombstone, posts_transaction FROM schedules ORDER BY id',
    ),
    rules: await db.all(
      'SELECT id, conditions, actions, tombstone FROM rules ORDER BY id',
    ),
    generated: await db.all(
      'SELECT id, paycheck, tombstone FROM paycheck_schedules ORDER BY id',
    ),
    accounts: await db.all(
      'SELECT id, name, deposit_days_early, business_calendar_id, tombstone FROM accounts ORDER BY id',
    ),
  };
}

// Live rows only: undo tombstones the rows a reverted write created
async function liveSnapshot() {
  return Object.fromEntries(
    Object.entries(await snapshot()).map(([table, rows]) => [
      table,
      (rows as { tombstone: number }[]).filter(row => !row.tombstone),
    ]),
  );
}

let calendar = '';

beforeEach(async () => {
  await global.emptyDatabase()();
  await prefs.loadPrefs();
  await loadMappings();
  await loadRules();
  schedulesApp.startServices();
  vi.useFakeTimers({ toFake: ['Date'] });
  // Sunday November 1, 2026
  vi.setSystemTime(new Date(2026, 10, 1));
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
  await addAccount('retirement', 'Retirement');
  await db.insertAccount({ id: 'closed', name: 'Old', closed: 1 });
  await db.insertPayee({
    id: 'transfer-closed',
    name: '',
    transfer_acct: 'closed',
  });
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
  for (const id of ['clearing', 'savings']) {
    await handlers['account-set-business-days']({
      id,
      businessCalendarId: calendar,
      depositDaysEarly: 0,
    });
  }
  clearUndo();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('native/paycheck-preview', () => {
  it('returns net pay, deposits, dates moved for business days and the employer', async () => {
    const result = await preview({
      name: 'Acme',
      definition: acme(),
      isNewAccount: false,
      // Savings is two business days early; November 11 is a holiday
      daysEarly: { savings: 2 },
    });
    // The Swift tests decode this fixture
    await expect(JSON.stringify(result, null, 2) + '\n').toMatchFileSnapshot(
      './fixtures/paycheck-preview.json',
    );

    expect(result).toEqual({
      netAmount: 240000,
      // Sunday the 15th moves to Friday the 13th
      payDate: '2026-11-13',
      employerName: 'Acme',
      deposits: [
        {
          id: 'savings',
          amount: 40000,
          date: '2026-11-10',
          savedDaysEarly: 0,
          calendarName: 'U.S. Federal Holidays',
        },
        {
          id: 'checking',
          amount: 200000,
          date: '2026-11-13',
          savedDaysEarly: 0,
          calendarName: null,
        },
      ],
      errors: [],
    });
  });

  it('never gives a pay date before today', async () => {
    // Sunday the 15th moves back to Friday the 13th, which has passed
    vi.setSystemTime(new Date(2026, 10, 15));
    const result = await preview({
      name: 'Acme',
      definition: acme(),
      isNewAccount: false,
    });
    expect(result.payDate).toBe('2026-11-30');
  });

  it('returns error codes with their fields', async () => {
    const result = await preview({
      name: '',
      definition: acme({
        grossAmount: 200000,
        deductions: [{ id: 't', name: 'Tax', amount: 210000 }],
        deposits: [
          { id: 'c', account: 'clearing', kind: 'remainder', value: 0 },
        ],
      }),
      isNewAccount: false,
      daysEarly: { clearing: 11 },
    });

    expect(result.errors).toEqual([
      { code: 'name-missing', field: 'name' },
      { code: 'deposit-to-clearing-account', field: 'deposits' },
      { code: 'days-early-invalid', field: 'deposits' },
      { code: 'deductions-exceed-gross', field: 'deductions' },
      { code: 'deposits-exceed-net', field: 'deposits' },
    ]);
  });

  it('checks the clearing account it names', async () => {
    const result = await preview({
      name: 'Acme',
      definition: acme({ clearingAccount: 'closed' }),
      isNewAccount: false,
    });
    expect(result.errors).toContainEqual({
      code: 'clearing-account-not-open-on-budget',
      field: 'clearingAccount',
    });
  });

  it('accepts a new clearing account named after the employer', async () => {
    const draft = {
      name: 'Acme',
      definition: acme({ clearingAccount: '' }),
      isNewAccount: true,
    };
    expect((await preview(draft)).errors).toEqual([]);
    expect(
      (
        await preview({
          ...draft,
          definition: { ...draft.definition, payee: null },
        })
      ).errors,
    ).toEqual([{ code: 'clearing-name-missing', field: 'clearingAccount' }]);
  });

  it("shows an unedited paycheck's stored next date, as the list does", async () => {
    const id = await handlers['paycheck-create']({
      name: 'Acme',
      definition: acme(),
    });
    await handlers['paycheck-skip-next']({ id });
    const [{ definition }] = await handlers['paychecks-get']();
    const draft = { name: 'Acme', definition, isNewAccount: false, id };

    // Skipped the 13th: the schedule's next date, not the recurrence's
    expect((await preview(draft)).payDate).toBe('2026-11-30');
    // An edited pay date has no stored next date yet
    expect(
      (
        await preview({
          ...draft,
          definition: { ...definition, weekendSolveMode: 'after' },
        })
      ).payDate,
    ).toBe('2026-11-16');
  });

  it('gives no dates for a pay schedule it cannot read', async () => {
    const result = await preview({
      name: 'Acme',
      definition: acme({
        date: { start: 'nope', frequency: 'monthly' } as never,
      }),
      isNewAccount: false,
    });
    expect(result.payDate).toBeNull();
    expect(result.deposits.map(d => d.date)).toEqual([null, null]);
  });
});

describe('native/paycheck-save', () => {
  it('creates a paycheck as one undo step', async () => {
    const before = await liveSnapshot();
    const id = await save({
      name: 'Acme',
      definition: acme({ clearingAccount: '' }),
      newClearingAccountName: 'Acme Pay',
      daysEarly: { savings: 2 },
      undoToken: 'C',
    });

    const [paycheck] = await handlers['paychecks-get']();
    expect(paycheck.id).toBe(id);
    expect(paycheck.definition.paySchedule).toBeTruthy();
    expect(await daysEarly('savings')).toBe(2);

    await nativeUndo('C');

    expect(await handlers['paychecks-get']()).toEqual([]);
    expect(await liveSnapshot()).toEqual(before);
  });

  it('updates a paycheck and its days early as one undo step', async () => {
    const id = await handlers['paycheck-create']({
      name: 'Acme',
      definition: acme(),
    });
    clearUndo();
    const [{ definition }] = await handlers['paychecks-get']();
    const before = await liveSnapshot();

    await save({
      id,
      name: 'Acme',
      definition: {
        ...definition,
        deposits: [
          ...definition.deposits,
          {
            id: 'retire',
            account: 'retirement',
            kind: 'fixed',
            value: 10000,
          },
        ],
      },
      daysEarly: { savings: 3 },
      undoToken: 'U',
    });
    expect(
      (await handlers['paychecks-get']())[0].definition.deposits,
    ).toHaveLength(3);
    expect(await daysEarly('savings')).toBe(3);

    await nativeUndo('U');

    expect(await liveSnapshot()).toEqual(before);
  });

  // PR 366 review: an older native app decodes the definition with a typed
  // model, so fields a newer loot-core added would be lost on its save
  it('keeps definition fields the native draft left out', async () => {
    const id = await handlers['paycheck-create']({
      name: 'Acme',
      definition: acme(),
    });
    const [{ definition: stored }] = await handlers['paychecks-get']();
    const withExtras = {
      ...stored,
      futureTop: 'top',
      date: { ...stored.date, futureDate: 'date' },
      deductions: stored.deductions.map(d => ({ ...d, futureDeduction: 1 })),
      deposits: stored.deposits.map(d => ({ ...d, futureDeposit: true })),
    };
    await db.update('paychecks', {
      id,
      definition: JSON.stringify(withExtras),
    });

    // What an older app sends: the known fields, one deposit changed, one
    // deposit added, the deduction removed
    await save({
      id,
      name: 'Acme',
      definition: {
        ...stored,
        grossAmount: 310000,
        deductions: [],
        deposits: [
          { ...stored.deposits[0], value: 50000 },
          stored.deposits[1],
          { id: 'new', account: 'retirement', kind: 'fixed', value: 100 },
        ],
      },
      daysEarly: {},
      undoToken: 'M',
    });

    const [{ definition }] = (await handlers['paychecks-get']()) as never as [
      { definition: Record<string, unknown> & typeof withExtras },
    ];
    expect(definition.futureTop).toBe('top');
    expect(definition.grossAmount).toBe(310000);
    expect(definition.date).toMatchObject({ futureDate: 'date' });
    expect(definition.deductions).toEqual([]);
    expect(definition.deposits).toMatchObject([
      { id: 'savings', value: 50000, futureDeposit: true },
      { id: 'checking', futureDeposit: true },
      { id: 'new', account: 'retirement' },
    ]);
    expect(definition.deposits[2]).not.toHaveProperty('futureDeposit');
  });

  it('skips days early that did not change', async () => {
    await save({
      name: 'Acme',
      definition: acme(),
      daysEarly: { savings: 0, checking: 0 },
      undoToken: 'C',
    });
    expect(await daysEarly('savings')).toBe(0);
  });

  describe('a rejected save changes nothing', () => {
    let web = '';
    beforeEach(async () => {
      // A web edit, which must stay undoable
      await handlers['account-set-business-days']({
        id: 'checking',
        businessCalendarId: null,
        depositDaysEarly: 4,
      });
      web = JSON.stringify(await snapshot());
    });

    async function expectUnchanged() {
      expect(JSON.stringify(await snapshot())).toBe(web);
      await undo();
      expect(await daysEarly('checking')).toBe(0);
    }

    it('when a schedule name is taken', async () => {
      await schedulesApp.handlers['schedule/create']({
        schedule: { name: 'Acme → Savings' },
        conditions: [
          { op: 'is', field: 'date', value: '2026-11-12' },
          { op: 'is', field: 'amount', value: -100 },
          { op: 'is', field: 'account', value: 'checking' },
        ],
      });
      web = JSON.stringify(await snapshot());
      await expect(
        save({
          name: 'Acme',
          definition: acme(),
          daysEarly: { savings: 3 },
          undoToken: 'X',
        }),
      ).rejects.toThrow(/already exists/);
      expect(JSON.stringify(await snapshot())).toBe(web);
      expect(await daysEarly('savings')).toBe(0);
    });

    it('when the draft is invalid', async () => {
      await expect(
        save({
          name: ' ',
          definition: acme(),
          daysEarly: { savings: 3 },
          undoToken: 'X',
        }),
      ).rejects.toThrow(/^\[native:invalid-draft:name-missing\] /);
      await expectUnchanged();
    });

    it.each([
      ['a days-early value out of range', { daysEarly: { savings: 11 } }],
      ['a fractional days-early value', { daysEarly: { savings: 1.5 } }],
      [
        'days early for an account it does not deposit to',
        {
          daysEarly: { retirement: 1 },
        },
      ],
      ['no undo token', { undoToken: '' }],
      ['a negative gross', { definition: acme({ grossAmount: -1 }) }],
      ['a missing paycheck', { id: 'gone' }],
    ])('for %s', async (_, fields) => {
      await expect(
        save({
          name: 'Acme',
          definition: acme(),
          daysEarly: {},
          undoToken: 'X',
          ...fields,
        }),
      ).rejects.toThrow();
      await expectUnchanged();
    });

    it('for a closed account', async () => {
      await expect(
        save({
          name: 'Acme',
          definition: acme({
            deposits: [
              { id: 'old', account: 'closed', kind: 'remainder', value: 0 },
            ],
          }),
          daysEarly: {},
          undoToken: 'X',
        }),
      ).rejects.toThrow(/closed/);
      await expectUnchanged();
    });
  });

  it('reverts a save whose later step fails, leaving no redo', async () => {
    // Another paycheck also deposits to Savings; its transfer deduction's
    // payee goes missing, so rewriting it for Savings' days early throws
    await handlers['paycheck-create']({
      name: 'Side gig',
      definition: acme({
        payee: null,
        deductions: [
          {
            id: '401k',
            name: '401(k)',
            amount: 10000,
            transferAccount: 'retirement',
          },
        ],
        deposits: [
          { id: 'savings', account: 'savings', kind: 'remainder', value: 0 },
        ],
      }),
    });
    const id = await handlers['paycheck-create']({
      name: 'Acme',
      definition: acme(),
    });
    await db.update('payees', { id: 'transfer-retirement', tombstone: 1 });
    clearUndo();
    // A web edit before the save
    await handlers['account-set-business-days']({
      id: 'checking',
      businessCalendarId: null,
      depositDaysEarly: 4,
    });
    const acmeBefore = (await handlers['paychecks-get']()).find(
      p => p.id === id,
    )!;
    const before = await liveSnapshot();

    await expect(
      save({
        id,
        name: 'Acme',
        definition: {
          ...acmeBefore.definition,
          deposits: [
            ...acmeBefore.definition.deposits,
            { id: 'r', account: 'retirement', kind: 'fixed', value: 100 },
          ],
        },
        daysEarly: { savings: 3 },
        undoToken: 'L',
      }),
    ).rejects.toThrow(/transfer payee/);

    expect(await liveSnapshot()).toEqual(before);
    // Redo can't re-apply the half save
    await redo();
    expect(await liveSnapshot()).toEqual(before);
    // The web edit is still the one Undo reverses
    await undo();
    expect(await daysEarly('checking')).toBe(0);
  });

  it('never undoes a web edit when it throws before writing', async () => {
    const id = await handlers['paycheck-create']({
      name: 'Acme',
      definition: acme(),
    });
    clearUndo();
    // A web edit, undone so that it has a Redo
    await handlers['account-set-business-days']({
      id: 'checking',
      businessCalendarId: null,
      depositDaysEarly: 4,
    });
    await undo();
    await redo();
    expect(await daysEarly('checking')).toBe(4);
    const before = JSON.stringify(await snapshot());
    const [{ definition }] = await handlers['paychecks-get']();
    // The transfer payee lookup throws before any write
    const first = db.first;
    vi.spyOn(db, 'first').mockImplementation(async (sql, params) => {
      if (/FROM payees WHERE transfer_acct/.test(sql)) {
        throw new Error('Account has no transfer payee');
      }
      return first(sql, params);
    });

    await expect(
      save({
        id,
        name: 'Acme',
        definition: {
          ...definition,
          deductions: [
            ...definition.deductions,
            {
              id: '401k',
              name: '401(k)',
              amount: 1000,
              transferAccount: 'retirement',
            },
          ],
        },
        daysEarly: {},
        undoToken: 'B',
      }),
    ).rejects.toThrow(/transfer payee/);
    vi.restoreAllMocks();

    expect(JSON.stringify(await snapshot())).toBe(before);
    await undo();
    expect(await daysEarly('checking')).toBe(0);
    await redo();
    expect(await daysEarly('checking')).toBe(4);
  });
});

describe('paycheck-year-to-date hasHistory', () => {
  it('is false for each year without posted pay, true with it', async () => {
    const id = await handlers['paycheck-create']({
      name: 'Acme',
      definition: acme(),
    });
    expect(
      (await handlers['paycheck-year-to-date']({ id })).map(y => y.hasHistory),
    ).toEqual([false, false]);

    const [{ definition }] = await handlers['paychecks-get']();
    await db.insertTransaction({
      id: 'pay',
      account: 'clearing',
      amount: 240000,
      date: '2025-12-15',
      schedule: definition.paySchedule,
    });

    const yearToDate = await handlers['paycheck-year-to-date']({ id });
    expect(yearToDate.map(y => y.hasHistory)).toEqual([false, true]);
    // The Swift tests decode this fixture
    await expect(
      JSON.stringify(yearToDate, null, 2) + '\n',
    ).toMatchFileSnapshot('./fixtures/paycheck-year-to-date.json');
  });
});

// The pickers' and the stored paycheck's AQL, as Swift sends them through
// `query` (PaycheckEditorQuery); the Swift tests check their encoding
// against this fixture
describe('native paycheck editor queries', () => {
  const queries = {
    paycheck: q('paychecks')
      .filter({ id: 'PAYCHECK_ID' })
      .select(['id', 'name', 'definition']),
    accounts: q('accounts')
      .select(['id', 'name', 'offbudget', 'closed'])
      .orderBy('sort_order'),
    payees: q('payees')
      .filter({ transfer_acct: null })
      .select(['id', 'name'])
      .orderBy('name'),
    categories: q('categories')
      .select(['id', 'name', 'is_income', 'hidden'])
      .orderBy('sort_order'),
  };

  it('match the fixture and read what the editor needs', async () => {
    const serialized = Object.fromEntries(
      Object.entries(queries).map(([name, query]) => [name, query.serialize()]),
    );
    expect(serialized).toEqual(
      JSON.parse(
        readFileSync(
          new URL('./fixtures/paycheck-editor-queries.json', import.meta.url),
          'utf8',
        ),
      ),
    );

    const id = await handlers['paycheck-create']({
      name: 'Acme',
      definition: acme(),
    });
    const read = async (name: keyof typeof queries) =>
      (
        (await aqlQuery(
          JSON.parse(
            JSON.stringify(serialized[name]).replace('PAYCHECK_ID', id),
          ),
        )) as { data: Record<string, unknown>[] }
      ).data;

    const [paycheck] = await read('paycheck');
    expect(paycheck).toMatchObject({ id, name: 'Acme' });
    expect((paycheck.definition as PaycheckDefinition).deposits).toHaveLength(
      2,
    );
    expect(await read('accounts')).toContainEqual({
      id: 'closed',
      name: 'Old',
      offbudget: false,
      closed: true,
    });
    expect(await read('payees')).toEqual([{ id: 'acme', name: 'Acme' }]);
    expect(await read('categories')).toContainEqual({
      id: 'income',
      name: 'Income',
      is_income: true,
      hidden: false,
    });
  });
});
