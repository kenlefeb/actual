import * as db from '#server/db';
import type { ServerHandlers } from '#types/server-handlers';

import { installAPI } from './api';
import { setBudget } from './budget/actions';
import * as prefs from './prefs';

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

async function cell(category: string) {
  return (
    await db.first<{ amount: number }>(
      'SELECT amount FROM zero_budgets WHERE category = ? AND month = 202601',
      [category],
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

beforeEach(global.emptyDatabase());
beforeEach(async () => {
  await prefs.loadPrefs();
  await db.insertAccount({ id: 'a1', name: 'Checking' });
  await db.insertAccount({ id: 'a2', name: 'Savings' });
});

describe('api/undelete-rows', () => {
  it('brings a deleted transaction back with its id and values', async () => {
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

  it('rejects a live row, an unknown id, another budget and a table outside the list, changing nothing', async () => {
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
    const bad = [
      [{ table: 'transactions', id: 'live' }],
      [goneRow, { table: 'transactions', id: 'nope' }],
      [goneRow, { table: 'accounts', id: 'a1' }],
      [goneRow, goneRow],
    ] as const;
    for (const rows of bad) {
      await expect(undelete({ rows: [...rows] } as never)).rejects.toThrow();
    }
    await expect(
      handlers['api/undelete-rows']({
        budget_id: 'another-budget',
        rows: [goneRow],
      }),
    ).rejects.toThrow(/budget/);
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
    expect(tx).toMatchObject({ exists: true, deleted: true });
    expect(Object.keys(tx.columns).sort((a, b) => a.localeCompare(b))).toEqual([
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
    expect(Object.keys(cat.columns).sort((a, b) => a.localeCompare(b))).toEqual(
      ['cat_group', 'hidden', 'is_income', 'mapped_from', 'mapping', 'name'],
    );
    expect(
      Object.keys(group.columns).sort((a, b) => a.localeCompare(b)),
    ).toEqual(['category_ids', 'is_income', 'name']);
    expect(map.columns).toEqual({ transferId: 'c1' });
    expect(missing.exists).toBe(false);
    expect(await tombstone('transactions', 't1')).toBe(1);
  });

  it('restores a category with its mapping and the transfer cells together', async () => {
    await db.insertCategoryGroup({ id: 'g1', name: 'Bills' });
    await db.insertCategory({ id: 'dining', name: 'Dining', cat_group: 'g1' });
    await db.insertCategory({ id: 'food', name: 'Food', cat_group: 'g1' });
    await db.insertCategory({ id: 'old', name: 'Old', cat_group: 'g1' });
    await db.deleteCategory({ id: 'old' }, 'dining');
    await setBudget({ category: 'dining', month: '2026-01', amount: 500 });
    await setBudget({ category: 'food', month: '2026-01', amount: 100 });
    // delete "dining" into "food", as the app does
    await setBudget({ category: 'food', month: '2026-01', amount: 600 });
    await db.deleteCategory({ id: 'dining' }, 'food');
    expect(await mapping('old')).toBe('food');

    const res = await undelete({
      rows: [
        { table: 'categories', id: 'dining' },
        {
          table: 'category_mapping',
          id: 'dining',
          set: { transferId: 'dining' },
        },
        { table: 'category_mapping', id: 'old', set: { transferId: 'dining' } },
      ],
      cells: [{ category: 'food', month: '2026-01', amount: 100 }],
    });
    expect(res).toEqual({ check: false, restored: 1, cells: 1 });
    expect(await tombstone('categories', 'dining')).toBe(0);
    expect(await mapping('dining')).toBe('dining');
    expect(await mapping('old')).toBe('dining');
    expect(await cell('food')).toBe(100);
  });

  it('rejects a mapping to a category not restored, and a cell of another category, changing nothing', async () => {
    await db.insertCategoryGroup({ id: 'g1', name: 'Bills' });
    await db.insertCategory({ id: 'dining', name: 'Dining', cat_group: 'g1' });
    await db.insertCategory({ id: 'food', name: 'Food', cat_group: 'g1' });
    await db.deleteCategory({ id: 'dining' }, 'food');
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
    ).rejects.toThrow();
    await expect(
      undelete({
        rows: [{ table: 'categories', id: 'dining' }],
        cells: [{ category: 'dining', month: '2026-01', amount: 5 }],
      }),
    ).rejects.toThrow();
    await expect(
      undelete({
        rows: [{ table: 'categories', id: 'dining' }],
        cells: [{ category: 'food', month: '2026-13', amount: 5 }],
      }),
    ).rejects.toThrow();
    expect(await tombstone('categories', 'dining')).toBe(1);
    expect(await mapping('dining')).toBe('food');
    expect(await cell('food')).toBeUndefined();
  });

  it('relinks a transfer only when the two rows name each other', async () => {
    await db.insertTransaction({
      id: 'out',
      account: 'a1',
      date: '2026-01-05',
      amount: -100,
      transfer_id: 'in',
    });
    await db.insertTransaction({
      id: 'in',
      account: 'a2',
      date: '2026-01-05',
      amount: 100,
      transfer_id: 'out',
    });
    await db.insertTransaction({
      id: 'live',
      account: 'a2',
      date: '2026-01-05',
      amount: 5,
    });
    // as the app's delete leaves them: `out` unlinked and deleted, `in` deleted and still pointing at it
    await db.updateTransaction({ id: 'out', transfer_id: null });
    await db.deleteTransaction({ id: 'out' });
    await db.deleteTransaction({ id: 'in' });
    // a live row cannot be relinked
    await expect(
      undelete({
        rows: [
          { table: 'transactions', id: 'out', set: { transfer_id: 'live' } },
        ],
      }),
    ).rejects.toThrow();
    await expect(
      undelete({
        rows: [
          { table: 'transactions', id: 'live', set: { transfer_id: 'out' } },
          { table: 'transactions', id: 'out' },
        ],
      }),
    ).rejects.toThrow();
    expect(await tombstone('transactions', 'out')).toBe(1);

    await undelete({
      rows: [
        { table: 'transactions', id: 'out', set: { transfer_id: 'in' } },
        { table: 'transactions', id: 'in' },
      ],
    });
    const out = await db.first<{ transferred_id: string }>(
      'SELECT transferred_id FROM transactions WHERE id = ?',
      ['out'],
    );
    expect(out?.transferred_id).toBe('in');
    expect(await tombstone('transactions', 'in')).toBe(0);
  });

  it('relinks the live split child a delete unlinked, only to the restored row account transfer payee', async () => {
    const transferPayee = await db.insertPayee({
      name: '',
      transfer_acct: 'a1',
    });
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
    });
    await db.deleteTransaction({ id: 'out' });
    const rows = (payee: string) => [
      {
        table: 'transactions' as const,
        id: 'out',
        set: { transfer_id: 'child' },
      },
      {
        table: 'transactions' as const,
        id: 'child',
        set: { transfer_id: 'out', payee },
      },
    ];
    await expect(undelete({ rows: rows('someone-else') })).rejects.toThrow();
    expect(await tombstone('transactions', 'out')).toBe(1);
    await undelete({ rows: rows(transferPayee) });
    const child = await db.first<{
      transferred_id: string;
      description: string;
    }>('SELECT transferred_id, description FROM transactions WHERE id = ?', [
      'child',
    ]);
    expect(child).toEqual({
      transferred_id: 'out',
      description: transferPayee,
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
          {
            table: 'transactions',
            id: 't1',
            set: { amount: 5 } as never,
          },
        ],
      }),
    ).rejects.toThrow();
    expect(await tombstone('transactions', 't1')).toBe(1);
  });
});
