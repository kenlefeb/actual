// Scenarios from openspec/changes/account-move-on-budget (sc-467)
import { Timestamp } from '@actual-app/crdt';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as sqlite from '#platform/server/sqlite';
import { createAllBudgets } from '#server/budget/base';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import * as sheet from '#server/sheet';
import { applyMessages, setSyncingMode } from '#server/sync';
import type { Message } from '#server/sync';
import { deserializeValue } from '#server/sync/serialization';
import { loadRules } from '#server/transactions/transaction-rules';
import { undo } from '#server/undo';

import { app } from './app';

// Tests fix "today" at 2017-01-01; the start date is the 1st of December
const START = '2016-12-01';

type BudgetType = 'envelope' | 'tracking';

const preview = (id = 'vanguard', startDate = START) =>
  app.handlers['account-move-on-budget-preview']({ id, startDate });
const move = (id = 'vanguard', startDate = START) =>
  app.handlers['account-move-on-budget']({ id, startDate });

async function setUp(budgetType: BudgetType = 'envelope') {
  await db.insertCategoryGroup({ id: 'income', name: 'Income', is_income: 1 });
  await db.insertCategory({
    id: 'starting',
    name: 'Starting Balances',
    cat_group: 'income',
    is_income: 1,
  });
  await db.insertCategoryGroup({ id: 'expenses', name: 'Expenses' });
  for (const name of ['Groceries', 'Savings', 'Investments']) {
    await db.insertCategory({
      id: name.toLowerCase(),
      name,
      cat_group: 'expenses',
    });
  }
  for (const [id, name, offbudget] of [
    ['checking', 'Checking', 0],
    ['vanguard', 'Vanguard', 1],
    ['mortgage', 'Mortgage', 1],
  ] as const) {
    await db.insertAccount({ id, name, offbudget, closed: 0 });
    await db.insertPayee({ id: `payee-${id}`, name: '', transfer_acct: id });
  }
  db.runQuery("INSERT INTO preferences (id, value) VALUES ('budgetType', ?)", [
    budgetType,
  ]);
}

async function addTransaction(
  id: string,
  date: string,
  amount: number,
  category: string | null = null,
  account = 'vanguard',
) {
  await db.insertTransaction({ id, account, date, amount, category });
}

// A transfer between Vanguard and another account; the categories are per side
async function addTransfer(
  id: string,
  date: string,
  amount: number,
  other: string,
  otherCategory: string | null,
  ownCategory: string | null = null,
) {
  await db.insertTransaction({
    id,
    account: 'vanguard',
    date,
    amount,
    category: ownCategory,
    payee: `payee-${other}`,
    transfer_id: `${id}-other`,
  });
  await db.insertTransaction({
    id: `${id}-other`,
    account: other,
    date,
    amount: -amount,
    category: otherCategory,
    payee: 'payee-vanguard',
    transfer_id: id,
  });
}

async function loadBudget(budgetType: BudgetType = 'envelope') {
  await sheet.loadSpreadsheet(db);
  sheet.get().meta().budgetType = budgetType;
  await createAllBudgets();
  await sheet.waitOnSpreadsheet();
}

const cell = (month: string, name: string) =>
  sheet.getCellValue(`budget${month.replace('-', '')}`, name) as number;

async function settle() {
  await sheet.waitOnSpreadsheet();
}

async function balance(account = 'vanguard') {
  const row = await db.first<{ total: number }>(
    `SELECT SUM(amount) AS total FROM v_transactions_internal_alive
      WHERE account = ? AND is_parent = 0`,
    [account],
  );
  return row?.total ?? 0;
}

async function categoryOf(id: string) {
  const row = await db.first<{ category: string | null }>(
    'SELECT category FROM v_transactions_internal_alive WHERE id = ?',
    [id],
  );
  return row?.category ?? null;
}

async function offbudget(id = 'vanguard') {
  const row = await db.first<{ offbudget: number }>(
    'SELECT offbudget FROM accounts WHERE id = ?',
    [id],
  );
  return row?.offbudget;
}

// Every category amount and income total for a month
function monthTotals(month: string) {
  return Object.fromEntries(
    ['groceries', 'savings', 'investments', 'starting']
      .map(id => [id, cell(month, `sum-amount-${id}`)])
      .concat([['total-income', cell(month, 'total-income')]]),
  );
}

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
  await loadRules();
});

describe('Move an off-budget account on budget', () => {
  it('The account keeps everything', async () => {
    await setUp();
    await addTransaction('t1', '2016-11-05', -1_500_00);
    await addTransaction('t2', '2016-12-05', 250_00);
    await db.update('accounts', {
      id: 'vanguard',
      account_id: 'bank-123',
    });
    const before = await balance();

    await move();

    expect(await offbudget()).toBe(0);
    expect(await balance()).toBe(before);
    const account = await db.first<db.DbAccount>(
      'SELECT * FROM accounts WHERE id = ?',
      ['vanguard'],
    );
    expect(account?.account_id).toBe('bank-123');
    expect(await categoryOf('t1')).toBe(null);
    const ids = await db.all<{ id: string }>(
      "SELECT id FROM v_transactions_internal_alive WHERE account = 'vanguard' AND id IN ('t1', 't2')",
    );
    expect(ids).toHaveLength(2);
  });

  it('refuses closed, on-budget and unknown accounts', async () => {
    await setUp();
    await db.update('accounts', { id: 'mortgage', closed: 1 });
    await expect(move('mortgage')).rejects.toThrow('closed');
    await expect(move('checking')).rejects.toThrow('already on budget');
    await expect(move('nope')).rejects.toThrow('not found');
  });
});

describe('Invalid start dates', () => {
  it.each(['2026-13-01', '2026-02-30', '10/01/2026', ''])(
    'rejects %j in both handlers and writes nothing',
    async startDate => {
      await setUp();
      await addTransaction('h1', '2016-11-15', -80_00, 'groceries');
      const count = async () =>
        (
          await db.first<{ n: number }>(
            'SELECT COUNT(*) AS n FROM transactions',
          )
        )?.n;
      const before = await count();

      await expect(preview('vanguard', startDate)).rejects.toThrow(
        'Invalid start date',
      );
      await expect(move('vanguard', startDate)).rejects.toThrow(
        'Invalid start date',
      );

      expect(await offbudget()).toBe(1);
      expect(await categoryOf('h1')).toBe('groceries');
      expect(await count()).toBe(before);
    },
  );
});

describe('Warn before moving', () => {
  it('Counts match the account', async () => {
    await setUp();
    // 30 before the start date totalling 2,000.00
    for (let i = 0; i < 26; i++) {
      await addTransaction(`b${i}`, '2016-11-10', 50_00);
    }
    await addTransfer('in1', '2016-11-12', 300_00, 'checking', 'savings');
    await addTransfer('out1', '2016-11-13', 100_00, 'mortgage', null);
    // a rule set categories on 4 before the start date
    await addTransaction('h1', '2016-11-14', 50_00, 'groceries');
    await addTransaction('h2', '2016-11-15', 50_00, 'groceries');
    // 5 from the start date on totalling 150.00
    await addTransfer(
      'in2',
      '2016-12-12',
      100_00,
      'checking',
      'savings',
      'investments',
    );
    await addTransaction('k1', '2016-12-14', 20_00, 'groceries');
    await addTransaction('f1', '2016-12-15', 10_00);
    await addTransaction('f2', '2016-12-16', 10_00);
    await addTransaction('f3', '2016-12-17', 10_00);
    await db.update('transactions', { id: 'b0', category: 'groceries' });
    await db.update('transactions', { id: 'b1', category: 'groceries' });

    const result = await preview();

    expect(result.before).toBe(30);
    expect(result.categoriesCleared).toBe(5);
    expect(result.fromUncategorized).toBe(4);
    expect(result.categoriesKept).toBe(1);
    expect(result.startingBalance).toBe(1_800_00);
    expect(
      result.transfers.map(t => [
        t.date,
        t.otherAccountName,
        t.amount,
        t.keptCategory,
      ]),
    ).toEqual([
      ['2016-12-12', 'Checking', 100_00, 'savings'],
      ['2016-11-13', 'Mortgage', 100_00, null],
      ['2016-11-12', 'Checking', 300_00, 'savings'],
    ]);
  });

  it('Transfer sides count as cleared, not kept', async () => {
    await setUp();
    await addTransaction('k1', '2016-12-05', -40_00, 'groceries');
    await addTransfer(
      'in1',
      '2016-12-12',
      500_00,
      'checking',
      'savings',
      'investments',
    );

    const result = await preview();

    expect(result.categoriesCleared).toBe(1);
    expect(result.categoriesKept).toBe(1);
  });

  it('Many transfers', async () => {
    await setUp();
    for (let i = 0; i < 25; i++) {
      await addTransfer(`x${i}`, '2016-11-01', 1_00, 'checking', null);
    }
    expect((await preview()).transfers).toHaveLength(25);
  });

  it('Cancelling changes nothing', async () => {
    await setUp();
    await addTransaction('h1', '2016-11-14', -80_00, 'groceries');
    await preview();
    expect(await offbudget()).toBe(1);
    expect(await categoryOf('h1')).toBe('groceries');
    const count = await db.first<{ n: number }>(
      'SELECT COUNT(*) AS n FROM transactions',
    );
    expect(count?.n).toBe(1);
  });
});

describe('Start date', () => {
  it('The counts follow the start date', async () => {
    await setUp();
    await addTransaction('t1', '2016-08-05', 100_00);
    await addTransaction('t2', '2016-11-05', 200_00);

    expect((await preview('vanguard', START)).startingBalance).toBe(300_00);
    const july = await preview('vanguard', '2016-07-01');
    expect(july.startingBalance).toBe(0);
    expect(july.before).toBe(0);
    expect(july.fromUncategorized).toBe(2);
  });
});

describe.each(['envelope', 'tracking'] as const)(
  'Starting balance on the start date (%s)',
  budgetType => {
    async function history() {
      await setUp(budgetType);
      await addTransaction('t1', '2016-11-05', 1_800_00);
      await addTransfer('in1', '2016-11-12', 500_00, 'checking', 'savings');
      await addTransaction('h1', '2016-11-15', -300_00, 'investments');
      await addTransaction('t2', '2016-12-05', 100_00);
      await loadBudget(budgetType);
    }

    it('Balance unchanged, starting balance in the start month, earlier months unchanged', async () => {
      await history();
      const before = await balance();
      const november = monthTotals('2016-11');
      const december = monthTotals('2016-12');
      // "To Budget" exists only in envelope budgeting; tracking shows income
      const toBudgetCell =
        budgetType === 'envelope' ? 'to-budget' : 'total-income';
      const toBudget = cell('2016-12', toBudgetCell);

      await move();
      await settle();

      expect(await balance()).toBe(before);
      // The balance on Dec 1: 1,800.00 + 500.00 − 300.00
      expect(cell('2016-12', 'sum-amount-starting')).toBe(
        december.starting + 2_000_00,
      );
      expect(cell('2016-12', toBudgetCell)).toBe(toBudget + 2_000_00);
      expect(monthTotals('2016-11')).toEqual(november);
    });

    it('A negative balance', async () => {
      await setUp(budgetType);
      await addTransaction('t1', '2016-11-05', -1_250_00);
      await loadBudget(budgetType);
      const december = monthTotals('2016-12');

      await move();
      await settle();

      expect(cell('2016-12', 'sum-amount-starting')).toBe(
        december.starting - 1_250_00,
      );
      expect(await balance()).toBe(-1_250_00);
    });
  },
);

describe('Nothing before the start date', () => {
  it('adds no starting balance', async () => {
    await setUp();
    await addTransaction('t1', '2016-12-05', 100_00);
    await move();
    const added = await db.all(
      "SELECT id FROM transactions WHERE acct = 'vanguard' AND id != 't1'",
    );
    expect(added).toEqual([]);
  });
});

describe('One adjustment transaction', () => {
  it('The adjustment in the register', async () => {
    await setUp();
    await addTransaction('t1', '2016-11-05', 2_000_00);
    await move();

    const rows = await db.all<{
      amount: number;
      category: string | null;
      notes: string | null;
      is_parent: number;
      date: number;
    }>(
      `SELECT amount, category, notes, is_parent, date
         FROM v_transactions_internal_alive
        WHERE account = 'vanguard' AND id != 't1'
        ORDER BY is_parent DESC, amount DESC`,
    );
    expect(rows).toEqual([
      { amount: 0, category: null, notes: null, is_parent: 1, date: 20161201 },
      {
        amount: 2_000_00,
        category: 'starting',
        notes: 'Starting balance',
        is_parent: 0,
        date: 20161201,
      },
      {
        amount: -2_000_00,
        category: null,
        notes: 'Offsets transactions before 2016-12-01 (moved on budget)',
        is_parent: 0,
        date: 20161201,
      },
    ]);
  });
});

async function budgetStart(id = 'vanguard') {
  const row = await db.first<{
    budget_start_date: number | null;
    budget_start_offset: string | null;
  }>(
    'SELECT budget_start_date, budget_start_offset FROM accounts WHERE id = ?',
    [id],
  );
  return { date: row?.budget_start_date, offset: row?.budget_start_offset };
}

describe('The move remembers its start date', () => {
  it('Recorded with the account', async () => {
    await setUp();
    await addTransaction('t1', '2016-11-05', 2_000_00);

    await move();

    const { date, offset } = await budgetStart();
    expect(date).toBe(20161201);
    // The client reads the date as YYYY-MM-DD
    const account = (await app.handlers['accounts-get']()).find(
      a => a.id === 'vanguard',
    );
    expect(account?.budget_start_date).toBe('2016-12-01');
    expect(account?.budget_start_offset).toBe(offset);
    const line = await db.first<{ amount: number; category: string | null }>(
      'SELECT amount, category FROM v_transactions_internal_alive WHERE id = ?',
      [offset ?? null],
    );
    expect(line).toEqual({ amount: -2_000_00, category: null });
  });

  it('Records the date but no offset when nothing is before it', async () => {
    await setUp();
    await addTransaction('t1', '2016-12-05', 100_00);
    await move();
    expect(await budgetStart()).toEqual({ date: 20161201, offset: null });
  });

  it('Undo clears them', async () => {
    await setUp();
    await addTransaction('t1', '2016-11-05', 2_000_00);
    await move();
    await undo();
    expect(await budgetStart()).toEqual({ date: null, offset: null });
  });

  it('A database that already has the columns migrates', async () => {
    const { default: runMigration } =
      await import('#migrations/1793400000000_add_account_budget_start');
    const database = db.getDatabase()!;
    await runMigration({
      runQuery: (q: string, p: [], all: true) =>
        sqlite.runQuery(database, q, p, all),
      execQuery: (q: string) => sqlite.execQuery(database, q),
    });
    expect(await budgetStart()).toEqual({ date: undefined, offset: undefined });
  });
});

describe('Categories before and from the start date', () => {
  it('Hidden category before the start date', async () => {
    await setUp();
    await addTransaction('h1', '2016-11-15', -80_00, 'groceries');
    await addTransaction('t1', '2016-11-01', 1_000_00);
    await loadBudget();
    const groceries = cell('2016-11', 'sum-amount-groceries');
    const before = await balance();

    await move();
    await settle();

    expect(await categoryOf('h1')).toBe(null);
    expect(cell('2016-11', 'sum-amount-groceries')).toBe(groceries);
    expect(await balance()).toBe(before);
  });

  it('Hidden category after the start date', async () => {
    await setUp();
    await addTransaction('h1', '2016-12-10', -60_00, 'groceries');
    await loadBudget();
    const groceries = cell('2016-12', 'sum-amount-groceries');

    await move();
    await settle();

    expect(await categoryOf('h1')).toBe('groceries');
    expect(cell('2016-12', 'sum-amount-groceries')).toBe(groceries - 60_00);
  });

  it('Hidden category on this side of a later transfer', async () => {
    await setUp();
    await addTransfer(
      'in1',
      '2016-12-12',
      500_00,
      'checking',
      'savings',
      'investments',
    );
    await loadBudget();
    const savings = cell('2016-12', 'sum-amount-savings');
    const investments = cell('2016-12', 'sum-amount-investments');

    await move();
    await settle();

    expect(await categoryOf('in1')).toBe(null);
    expect(await categoryOf('in1-other')).toBe('savings');
    expect(cell('2016-12', 'sum-amount-investments')).toBe(investments);
    expect(cell('2016-12', 'sum-amount-savings')).toBe(savings);
  });

  it('A categorized transfer', async () => {
    await setUp();
    await addTransfer('in1', '2016-11-12', 500_00, 'checking', 'savings');
    await loadBudget();
    const savings = cell('2016-11', 'sum-amount-savings');

    await move();
    await settle();

    expect(await categoryOf('in1-other')).toBe('savings');
    expect(cell('2016-11', 'sum-amount-savings')).toBe(savings);
  });
});

describe('Undo and sync', () => {
  it('Undo, including cleared categories', async () => {
    await setUp();
    await addTransaction('h1', '2016-11-15', -80_00, 'groceries');
    await addTransaction('t1', '2016-11-01', 1_000_00);
    await loadBudget();
    const december = monthTotals('2016-12');

    await move();
    await settle();
    await undo();
    await settle();

    expect(await offbudget()).toBe(1);
    expect(await categoryOf('h1')).toBe('groceries');
    const added = await db.all(
      "SELECT id FROM v_transactions_internal_alive WHERE account = 'vanguard' AND id NOT IN ('h1', 't1')",
    );
    expect(added).toEqual([]);
    expect(monthTotals('2016-12')).toEqual(december);
  });

  describe('Another device', () => {
    beforeEach(() => {
      setSyncingMode('enabled');
    });

    afterEach(() => {
      setSyncingMode('disabled');
    });

    it('shows the same result after it syncs', async () => {
      await setUp();
      await addTransaction('h1', '2016-11-15', -80_00, 'groceries');
      await addTransaction('t1', '2016-11-01', 1_000_00);
      // The other device's copy, before the move
      // better-sqlite3 in tests
      const snapshot = (
        db.getDatabase() as unknown as { serialize(): Uint8Array }
      ).serialize();
      const since = db.runQuery<{ timestamp: string }>(
        'SELECT MAX(timestamp) AS timestamp FROM messages_crdt',
        [],
        true,
      )[0].timestamp;

      await loadBudget();
      await move();
      await settle();
      const expected = monthTotals('2016-12');
      const messages: Message[] = db
        .runQuery<db.DbCrdtMessage>(
          'SELECT * FROM messages_crdt WHERE timestamp > ? ORDER BY timestamp',
          [since],
          true,
        )
        .map(row => ({
          dataset: row.dataset,
          row: row.row,
          column: row.column,
          value: deserializeValue(row.value as unknown as string),
          timestamp: Timestamp.parse(row.timestamp) as Timestamp,
        }));
      await sheet.waitOnSpreadsheet();
      sheet.unloadSpreadsheet();

      // The other device receives the move
      db.setDatabase(await sqlite.openDatabase(snapshot));
      await loadMappings();
      await loadBudget();
      await applyMessages(messages);
      await settle();

      expect(await offbudget()).toBe(0);
      expect(await categoryOf('h1')).toBe(null);
      expect(monthTotals('2016-12')).toEqual(expected);
      const { date, offset } = await budgetStart();
      expect(date).toBe(20161201);
      expect(offset).not.toBeNull();
    });
  });
});
