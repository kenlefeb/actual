import * as db from '#server/db';
import type { ServerHandlers } from '#types/server-handlers';

import { installAPI } from './api';
import * as budgetActions from './budget/actions';
import { loadMappings } from './db/mappings';
import * as prefs from './prefs';
import * as rules from './transactions/transaction-rules';

// Wraps setBudget so one test can make it fail midway; every other test runs the real one
vi.mock('./budget/actions', async importOriginal => {
  const actual = await importOriginal<typeof budgetActions>();
  return { ...actual, setBudget: vi.fn(actual.setBudget) };
});

const handlers = installAPI({} as unknown as ServerHandlers);

const budgetId = () => {
  const p = prefs.getPrefs();
  return p.groupId ?? p.id;
};

const undelete = (
  args: Omit<
    Parameters<(typeof handlers)['api/undelete-rows']>[0],
    'budget_id'
  >,
) =>
  handlers['api/undelete-rows']({ budget_id: budgetId() as string, ...args });

async function tombstone(table: string, id: string) {
  return (
    await db.first<{ tombstone: number }>(
      `SELECT tombstone FROM ${table} WHERE id = ?`,
      [id],
    )
  )?.tombstone;
}

async function cell(category: string, month = 202601) {
  return (
    await db.first<{ amount: number }>(
      'SELECT amount FROM zero_budgets WHERE category = ? AND month = ?',
      [category, month],
    )
  )?.amount;
}

async function mapping(id: string) {
  return (
    await db.first<{ transferId: string }>(
      'SELECT transferId FROM category_mapping WHERE id = ?',
      [id],
    )
  )?.transferId;
}

let tpA1: string; // transfer payee of account a1
let tpA2: string; // transfer payee of account a2

beforeEach(global.emptyDatabase());
beforeEach(async () => {
  await prefs.loadPrefs();
  await db.insertAccount({ id: 'a1', name: 'Checking' });
  await db.insertAccount({ id: 'a2', name: 'Savings' });
  tpA1 = await db.insertPayee({ name: '', transfer_acct: 'a1' });
  tpA2 = await db.insertPayee({ name: '', transfer_acct: 'a2' });
});

describe('api/undelete-rows', () => {
  it('brings a deleted transaction back with its id and values, running no rule', async () => {
    await rules.insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ op: 'is', field: 'account', value: 'a1' }],
      actions: [{ op: 'set', field: 'notes', value: 'RULE RAN' }],
    });
    await loadMappings();
    await rules.loadRules();
    await db.insertTransaction({
      id: 't1',
      account: 'a1',
      date: '2026-01-05',
      amount: -1200,
      notes: 'rent',
    });
    await db.deleteTransaction({ id: 't1' });
    const res = await undelete({ rows: [{ table: 'transactions', id: 't1' }] });
    expect(res).toEqual({ check: false, restored: 1, cells: 0 });
    expect(await tombstone('transactions', 't1')).toBe(0);
    const row = await db.first<{ amount: number; notes: string }>(
      'SELECT amount, notes FROM transactions WHERE id = ?',
      ['t1'],
    );
    expect(row).toMatchObject({ amount: -1200, notes: 'rent' });
  });

  it('rejects a live row, an unknown id, another budget, a table outside the list and a duplicate, changing nothing', async () => {
    await db.insertTransaction({
      id: 'live',
      account: 'a1',
      date: '2026-01-05',
      amount: -1,
    });
    await db.insertTransaction({
      id: 'gone',
      account: 'a1',
      date: '2026-01-05',
      amount: -2,
    });
    await db.deleteTransaction({ id: 'gone' });
    const goneRow = { table: 'transactions', id: 'gone' } as const;
    const bad: Array<[unknown[], RegExp]> = [
      [[{ table: 'transactions', id: 'live' }], /not deleted/],
      [[goneRow, { table: 'transactions', id: 'nope' }], /does not exist/],
      [[goneRow, { table: 'accounts', id: 'a1' }], /fixed list/],
      [[goneRow, goneRow], /only once/],
      [[], /at least one row/],
    ];
    for (const [rows, message] of bad) {
      await expect(undelete({ rows } as never)).rejects.toThrow(message);
    }
    await expect(
      handlers['api/undelete-rows']({
        budget_id: 'another-budget',
        rows: [goneRow],
      }),
    ).rejects.toThrow(/not the loaded budget/);
    expect(await tombstone('transactions', 'gone')).toBe(1);
    expect(await tombstone('transactions', 'live')).toBe(0);
  });

  it('check mode changes nothing and returns only the compared columns', async () => {
    await db.insertTransaction({
      id: 't1',
      account: 'a1',
      date: '2026-01-05',
      amount: -1200,
    });
    await db.deleteTransaction({ id: 't1' });
    await db.insertCategoryGroup({ id: 'g1', name: 'Bills' });
    await db.insertCategory({ id: 'c1', name: 'Rent', cat_group: 'g1' });
    const res = await undelete({
      check: true,
      rows: [
        { table: 'transactions', id: 't1' },
        { table: 'categories', id: 'c1' },
        { table: 'category_groups', id: 'g1' },
        { table: 'category_mapping', id: 'c1' },
        { table: 'transactions', id: 'missing' },
      ],
    });
    if (!res.check) throw new Error('expected check mode');
    const [tx, cat, group, map, missing] = res.rows;
    const keys = (c: Record<string, unknown>) =>
      Object.keys(c).sort((a, b) => a.localeCompare(b));
    expect(tx).toMatchObject({ exists: true, deleted: true });
    expect(keys(tx.columns)).toEqual([
      'acct',
      'date',
      'description',
      'isChild',
      'isParent',
      'parent_id',
      'reconciled',
      'transferred_id',
    ]);
    expect(cat).toMatchObject({ exists: true, deleted: false });
    expect(keys(cat.columns)).toEqual([
      'cat_group',
      'hidden',
      'is_income',
      'mapped_from',
      'mapping',
      'name',
    ]);
    expect(keys(group.columns)).toEqual(['category_ids', 'is_income', 'name']);
    expect(map.columns).toEqual({ transferId: 'c1' });
    expect(missing.exists).toBe(false);
    expect(await tombstone('transactions', 't1')).toBe(1);
  });

  describe('categories and their mapping', () => {
    async function deleteDiningInto(food: string) {
      await db.insertCategoryGroup({ id: 'g1', name: 'Bills' });
      await db.insertCategory({
        id: 'dining',
        name: 'Dining',
        cat_group: 'g1',
      });
      await db.insertCategory({ id: 'food', name: 'Food', cat_group: 'g1' });
      await db.insertCategory({ id: 'old', name: 'Old', cat_group: 'g1' });
      await db.deleteCategory({ id: 'old' }, 'dining');
      await budgetActions.setBudget({
        category: 'dining',
        month: '2026-01',
        amount: 500,
      });
      await budgetActions.setBudget({
        category: 'dining',
        month: '2026-02',
        amount: 300,
      });
      await budgetActions.setBudget({
        category: food,
        month: '2026-01',
        amount: 100,
      });
      await budgetActions.setBudget({
        category: food,
        month: '2026-02',
        amount: 50,
      });
      // delete "dining" into "food", as the app does
      await budgetActions.setBudget({
        category: food,
        month: '2026-01',
        amount: 600,
      });
      await budgetActions.setBudget({
        category: food,
        month: '2026-02',
        amount: 350,
      });
      await db.deleteCategory({ id: 'dining' }, food);
    }
    const restoreDining = [
      { table: 'categories', id: 'dining' },
      {
        table: 'category_mapping',
        id: 'dining',
        set: { transferId: 'dining' },
      },
      { table: 'category_mapping', id: 'old', set: { transferId: 'dining' } },
    ] as const;

    it('restores a category with its mapping and the transfer cells together', async () => {
      await deleteDiningInto('food');
      expect(await mapping('old')).toBe('food');
      const res = await undelete({
        rows: [...restoreDining],
        cells: [{ category: 'food', month: '2026-01', amount: 100 }],
      });
      expect(res).toEqual({ check: false, restored: 1, cells: 1 });
      expect(await tombstone('categories', 'dining')).toBe(0);
      expect(await mapping('dining')).toBe('dining');
      expect(await mapping('old')).toBe('dining');
      expect(await cell('food')).toBe(100);
    });

    it('a failure while applying changes no row and no cell', async () => {
      await deleteDiningInto('food');
      const { setBudget: real } =
        await vi.importActual<typeof budgetActions>('./budget/actions');
      let calls = 0;
      vi.mocked(budgetActions.setBudget).mockImplementation(async arg => {
        if (++calls === 2) throw new Error('disk full');
        return real(arg);
      });
      await expect(
        undelete({
          rows: [...restoreDining],
          cells: [
            { category: 'food', month: '2026-01', amount: 100 },
            { category: 'food', month: '2026-02', amount: 50 },
          ],
        }),
      ).rejects.toThrow('disk full');
      vi.mocked(budgetActions.setBudget).mockImplementation(real);
      expect(calls).toBe(2);
      expect(await tombstone('categories', 'dining')).toBe(1);
      expect(await mapping('dining')).toBe('food');
      expect(await mapping('old')).toBe('food');
      expect(await cell('food')).toBe(600);
      expect(await cell('food', 202602)).toBe(350);
    });

    it('rejects a mapping to a category not restored and a cell of another category', async () => {
      await deleteDiningInto('food');
      await expect(
        undelete({
          rows: [
            { table: 'categories', id: 'dining' },
            {
              table: 'category_mapping',
              id: 'dining',
              set: { transferId: 'food' },
            },
          ],
        }),
      ).rejects.toThrow(/un-deleted in the call/);
      await expect(
        undelete({
          rows: [...restoreDining],
          cells: [{ category: 'dining', month: '2026-01', amount: 5 }],
        }),
      ).rejects.toThrow(/transfer cell/);
      await expect(
        undelete({
          rows: [...restoreDining],
          cells: [{ category: 'food', month: '2026-13', amount: 5 }],
        }),
      ).rejects.toThrow(/transfer cell/);
      expect(await tombstone('categories', 'dining')).toBe(1);
      expect(await mapping('dining')).toBe('food');
      expect(await cell('food')).toBe(600);
    });

    it("rejects re-pointing a live category's mapping, so no cycle can form", async () => {
      await deleteDiningInto('food');
      // food is live and maps to itself: dining -> food while food -> dining would swap their transactions
      await expect(
        undelete({
          rows: [
            { table: 'categories', id: 'dining' },
            {
              table: 'category_mapping',
              id: 'dining',
              set: { transferId: 'dining' },
            },
            {
              table: 'category_mapping',
              id: 'food',
              set: { transferId: 'dining' },
            },
          ],
        }),
      ).rejects.toThrow(/deleted category/);
      expect(await mapping('food')).toBe('food');
      expect(await tombstone('categories', 'dining')).toBe(1);
    });

    it('rejects a restored category that would not map to itself', async () => {
      await deleteDiningInto('food');
      await expect(
        undelete({ rows: [{ table: 'categories', id: 'dining' }] }),
      ).rejects.toThrow(/map to itself/);
      expect(await tombstone('categories', 'dining')).toBe(1);
    });
  });

  describe('transfers', () => {
    // as the app's delete leaves a pair: `out` unlinked and deleted, `in` deleted and still pointing at it
    async function deletedPair(inPayee: string | null = tpA1) {
      await db.insertTransaction({
        id: 'out',
        account: 'a1',
        date: '2026-01-05',
        amount: -100,
        payee: tpA2,
        transfer_id: 'in',
      });
      await db.insertTransaction({
        id: 'in',
        account: 'a2',
        date: '2026-01-05',
        amount: 100,
        payee: inPayee,
        transfer_id: 'out',
      });
      await db.updateTransaction({ id: 'out', transfer_id: null });
      await db.deleteTransaction({ id: 'out' });
      await db.deleteTransaction({ id: 'in' });
    }
    const relink = [
      { table: 'transactions', id: 'out', set: { transfer_id: 'in' } },
      { table: 'transactions', id: 'in' },
    ] as const;

    it('relinks a pair only when the two rows name each other', async () => {
      await deletedPair();
      await db.insertTransaction({
        id: 'live',
        account: 'a2',
        date: '2026-01-05',
        amount: 5,
      });
      await expect(
        undelete({
          rows: [
            { table: 'transactions', id: 'out', set: { transfer_id: 'live' } },
          ],
        }),
      ).rejects.toThrow(/names this one back/);
      await expect(
        undelete({
          rows: [
            { table: 'transactions', id: 'live', set: { transfer_id: 'out' } },
            { table: 'transactions', id: 'out' },
          ],
        }),
      ).rejects.toThrow(/not deleted/);
      expect(await tombstone('transactions', 'out')).toBe(1);

      await undelete({ rows: [...relink] });
      const out = await db.first<{ transferred_id: string }>(
        'SELECT transferred_id FROM transactions WHERE id = ?',
        ['out'],
      );
      expect(out?.transferred_id).toBe('in');
      expect(await tombstone('transactions', 'in')).toBe(0);
    });

    it('rejects two unrelated deleted rows whose payees are not the transfer payees', async () => {
      await deletedPair(null);
      await expect(undelete({ rows: [...relink] })).rejects.toThrow(
        /transfer payee/,
      );
      expect(await tombstone('transactions', 'out')).toBe(1);
      expect(await tombstone('transactions', 'in')).toBe(1);
    });

    describe('a live split child', () => {
      async function childCase() {
        await db.insertTransaction({
          id: 'parent',
          account: 'a2',
          date: '2026-01-05',
          amount: 300,
          is_parent: true,
        });
        await db.insertTransaction({
          id: 'child',
          account: 'a2',
          date: '2026-01-05',
          amount: 100,
          is_child: true,
          parent_id: 'parent',
        });
        await db.insertTransaction({
          id: 'out',
          account: 'a1',
          date: '2026-01-05',
          amount: -100,
          payee: tpA2,
        });
        await db.deleteTransaction({ id: 'out' });
      }
      const rows = (payee: string | undefined) => [
        {
          table: 'transactions' as const,
          id: 'out',
          set: { transfer_id: 'child' },
        },
        {
          table: 'transactions' as const,
          id: 'child',
          set: { transfer_id: 'out', ...(payee ? { payee } : {}) },
        },
      ];

      it('is relinked only to the restored row account transfer payee', async () => {
        await childCase();
        await expect(undelete({ rows: rows('someone-else') })).rejects.toThrow(
          /transfer payee/,
        );
        await expect(undelete({ rows: rows(undefined) })).rejects.toThrow(
          /transfer payee/,
        );
        expect(await tombstone('transactions', 'out')).toBe(1);
        await undelete({ rows: rows(tpA1) });
        const child = await db.first<{
          transferred_id: string;
          description: string;
        }>(
          'SELECT transferred_id, description FROM transactions WHERE id = ?',
          ['child'],
        );
        expect(child).toEqual({ transferred_id: 'out', description: tpA1 });
      });

      it('is not relinked while it is linked elsewhere', async () => {
        await childCase();
        await db.insertTransaction({
          id: 'z',
          account: 'a1',
          date: '2026-01-05',
          amount: -100,
          payee: tpA2,
          transfer_id: 'child',
        });
        await db.updateTransaction({
          id: 'child',
          transfer_id: 'z',
          payee: tpA1,
        });
        await expect(undelete({ rows: rows(tpA1) })).rejects.toThrow(
          /still linked or reconciled/,
        );
        expect(await tombstone('transactions', 'out')).toBe(1);
      });

      it('is not relinked while it is reconciled', async () => {
        await childCase();
        await db.updateTransaction({ id: 'child', reconciled: true });
        await expect(undelete({ rows: rows(tpA1) })).rejects.toThrow(
          /still linked or reconciled/,
        );
        expect(await tombstone('transactions', 'out')).toBe(1);
      });
    });
  });

  it('rejects any column outside the fixed set', async () => {
    await db.insertTransaction({
      id: 't1',
      account: 'a1',
      date: '2026-01-05',
      amount: -1,
    });
    await db.deleteTransaction({ id: 't1' });
    await expect(
      undelete({
        rows: [
          { table: 'transactions', id: 't1', set: { amount: 5 } as never },
        ],
      }),
    ).rejects.toThrow(/Only transfer_id/);
    expect(await tombstone('transactions', 't1')).toBe(1);
  });
});
