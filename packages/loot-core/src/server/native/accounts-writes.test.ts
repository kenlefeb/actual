// Fork-only (sc-4931, openspec/changes/native-accounts-screen D3). The contract
// for the Accounts screen's four writes: categorize, delete, reopen and move.
// Each is validated whole, takes an undo token and is one undo step.
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import * as prefs from '#server/prefs';
import { app as schedulesApp } from '#server/schedules/app';
import { batchUpdateTransactions } from '#server/transactions';
import { loadRules } from '#server/transactions/transaction-rules';
import { clearUndo } from '#server/undo';

import { app } from './app';

const h = app.handlers;
const categorize = (over: Record<string, unknown> = {}) =>
  h['native/transactions-categorize']({
    account_id: 'checking',
    ids: ['t1'],
    category: 'groceries',
    undoToken: 'T',
    ...over,
  } as never);
const remove = (over: Record<string, unknown> = {}) =>
  h['native/transactions-delete']({
    account_id: 'checking',
    ids: ['t1'],
    undoToken: 'T',
    ...over,
  } as never);
const undo = (token = 'T') => h['native/undo']({ token });
const setPref = (id: string, value: string) =>
  db.update('preferences', { id, value });

async function addAccount(id: string, name: string, over = {}) {
  await db.insertAccount({ id, name, ...over });
  await db.insertPayee({ id: `to-${id}`, name, transfer_acct: id });
}

async function addTxn(id: string, over: Record<string, unknown> = {}) {
  await db.insertTransaction({
    id,
    account: 'checking',
    date: '2016-12-20',
    amount: -1000,
    cleared: false,
    ...over,
  });
}

const row = (id: string) =>
  db.first<{
    category: string | null;
    tombstone: number;
    reconciled: number;
  }>('SELECT category, tombstone, reconciled FROM transactions WHERE id = ?', [
    id,
  ]);
const account = (id: string) =>
  db.first<{ closed: number; sort_order: number }>(
    'SELECT closed, sort_order FROM accounts WHERE id = ?',
    [id],
  );

beforeEach(async () => {
  await global.emptyDatabase()();
  await prefs.loadPrefs();
  await loadMappings();
  await loadRules();
  schedulesApp.startServices();
  await addAccount('checking', 'Checking');
  await addAccount('savings', 'Savings');
  await addAccount('card', 'Card');
  await addAccount('house', 'House', { offbudget: 1 });
  await addAccount('old', 'Old', { closed: 1 });
  await db.insertCategoryGroup({ id: 'food-group', name: 'Food' });
  await db.insertCategory({
    id: 'groceries',
    name: 'Groceries',
    cat_group: 'food-group',
  });
  await db.insertCategory({
    id: 'dining',
    name: 'Dining',
    cat_group: 'food-group',
  });
  await db.insertCategory({
    id: 'secret',
    name: 'Secret',
    cat_group: 'food-group',
    hidden: 1,
  });
  await addTxn('t1');
  await addTxn('t2', { category: 'dining' });
  clearUndo();
});

describe('native/transactions-categorize', () => {
  it('sets the category on every row, as one undo step', async () => {
    await categorize({ ids: ['t1', 't2'] });
    expect((await row('t1'))?.category).toBe('groceries');
    expect((await row('t2'))?.category).toBe('groceries');

    await undo();
    expect((await row('t1'))?.category).toBeNull();
    expect((await row('t2'))?.category).toBe('dining');
  });

  it('clears the category with null', async () => {
    await categorize({ ids: ['t2'], category: null });
    expect((await row('t2'))?.category).toBeNull();
  });

  it('needs its undo token', async () => {
    await expect(categorize({ undoToken: '' })).rejects.toThrow(/undo token/);
    await expect(categorize({ undoToken: undefined })).rejects.toThrow(
      /undo token/,
    );
    expect((await row('t1'))?.category).toBeNull();
  });

  it('fails the whole call when one id is another account, unknown or repeated badly', async () => {
    await addTxn('s1', { account: 'savings' });
    for (const ids of [['t1', 's1'], ['t1', 'nope'], [], 'x', [1]]) {
      await expect(categorize({ ids })).rejects.toThrow(/row/);
    }
    expect((await row('t1'))?.category).toBeNull();
    expect((await row('s1'))?.category).toBeNull();
  });

  it('refuses a closed, off-budget or unknown account', async () => {
    await addTxn('o1', { account: 'old' });
    await addTxn('h1', { account: 'house' });
    await expect(
      categorize({ account_id: 'old', ids: ['o1'] }),
    ).rejects.toThrow(/account/);
    await expect(
      categorize({ account_id: 'house', ids: ['h1'] }),
    ).rejects.toThrow(/off-budget/);
    await expect(
      categorize({ account_id: 'nope', ids: ['t1'] }),
    ).rejects.toThrow(/account/);
    expect((await row('o1'))?.category).toBeNull();
  });

  it('refuses split parents and children', async () => {
    await addTxn('p', { is_parent: 1 });
    await addTxn('c', { is_child: 1, parent_id: 'p' });
    await expect(categorize({ ids: ['p'] })).rejects.toThrow(/split/);
    await expect(categorize({ ids: ['c'] })).rejects.toThrow(/split/);
    await expect(categorize({ ids: ['t1', 'c'] })).rejects.toThrow(/split/);
    expect((await row('t1'))?.category).toBeNull();
  });

  it('refuses a transfer between two on-budget accounts but allows one to an off-budget account', async () => {
    await batchUpdateTransactions({
      added: [
        {
          id: 'x1',
          account: 'checking',
          payee: 'to-savings',
          amount: -500,
          date: '2016-12-20',
        },
        {
          id: 'x2',
          account: 'checking',
          payee: 'to-house',
          amount: -700,
          date: '2016-12-20',
        },
      ] as never,
    });
    await expect(categorize({ ids: ['x1'] })).rejects.toThrow(/transfer/);
    await categorize({ ids: ['x2'] });
    expect((await row('x2'))?.category).toBe('groceries');
  });

  it('refuses a hidden or unknown category', async () => {
    await expect(categorize({ category: 'secret' })).rejects.toThrow(
      /category/,
    );
    await expect(categorize({ category: 'nope' })).rejects.toThrow(/category/);
    await expect(categorize({ category: 5 })).rejects.toThrow(/category/);
    expect((await row('t1'))?.category).toBeNull();
  });

  it('refuses a reconciled row unless confirmedReconciled is exactly true', async () => {
    await addTxn('r1', { cleared: true, reconciled: true });
    for (const confirmedReconciled of [undefined, false, 'true', 1]) {
      await expect(
        categorize({ ids: ['t1', 'r1'], confirmedReconciled }),
      ).rejects.toThrow(/reconciled/);
    }
    expect((await row('t1'))?.category).toBeNull();
    await categorize({ ids: ['t1', 'r1'], confirmedReconciled: true });
    expect((await row('r1'))?.category).toBe('groceries');
  });

  it('caps the ids by accounts-write-max-ids (default 100, ceiling 500)', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 101; i++) {
      ids.push(`b${i}`);
      await addTxn(`b${i}`);
    }
    await expect(categorize({ ids })).rejects.toThrow(/at most 100/);
    await setPref('accounts-write-max-ids', '101');
    await categorize({ ids });
    expect((await row('b100'))?.category).toBe('groceries');
    // A ceiling breach falls back to the default
    await setPref('accounts-write-max-ids', '501');
    await expect(categorize({ ids })).rejects.toThrow(/at most 100/);
  });
});

describe('native/transactions-delete', () => {
  it('deletes the rows as one undo step', async () => {
    await remove({ ids: ['t1', 't2'] });
    expect((await row('t1'))?.tombstone).toBe(1);
    expect((await row('t2'))?.tombstone).toBe(1);

    await undo();
    expect((await row('t1'))?.tombstone).toBe(0);
    expect((await row('t2'))?.tombstone).toBe(0);
  });

  it('needs its token and refuses another account, a closed account and a child, changing nothing', async () => {
    await addTxn('s1', { account: 'savings' });
    await addTxn('o1', { account: 'old' });
    await addTxn('p', { is_parent: 1 });
    await addTxn('c', { is_child: 1, parent_id: 'p' });
    await expect(remove({ undoToken: '' })).rejects.toThrow(/undo token/);
    await expect(remove({ ids: ['t1', 's1'] })).rejects.toThrow(/row/);
    await expect(remove({ account_id: 'old', ids: ['o1'] })).rejects.toThrow(
      /account/,
    );
    await expect(remove({ ids: ['c'] })).rejects.toThrow(/row/);
    for (const id of ['t1', 's1', 'o1', 'p', 'c']) {
      expect((await row(id))?.tombstone).toBe(0);
    }
  });

  it('takes a split parent`s children with it', async () => {
    await addTxn('p', { is_parent: 1 });
    await addTxn('c', { is_child: 1, parent_id: 'p' });
    await remove({ ids: ['p'] });
    expect((await row('p'))?.tombstone).toBe(1);
    expect((await row('c'))?.tombstone).toBe(1);
  });

  it('refuses a reconciled row unless confirmedReconciled is exactly true', async () => {
    await addTxn('r1', { cleared: true, reconciled: true });
    for (const confirmedReconciled of [undefined, false, 'true', 1]) {
      await expect(
        remove({ ids: ['t1', 'r1'], confirmedReconciled }),
      ).rejects.toThrow(/reconciled/);
    }
    expect((await row('t1'))?.tombstone).toBe(0);
    await remove({ ids: ['t1', 'r1'], confirmedReconciled: true });
    expect((await row('r1'))?.tombstone).toBe(1);
  });

  describe('a transfer', () => {
    async function transfer() {
      await batchUpdateTransactions({
        added: [
          {
            id: 'x1',
            account: 'checking',
            payee: 'to-savings',
            amount: -500,
            date: '2016-12-20',
          },
        ] as never,
      });
      const partner = (
        await db.first<{ transfer_id: string }>(
          'SELECT transferred_id AS transfer_id FROM transactions WHERE id = ?',
          ['x1'],
        )
      )?.transfer_id as string;
      expect(partner).toBeTruthy();
      return partner;
    }

    it('removes its partner row in the other account', async () => {
      const partner = await transfer();
      await remove({ ids: ['x1'] });
      expect((await row('x1'))?.tombstone).toBe(1);
      expect((await row(partner))?.tombstone).toBe(1);
    });

    it('refuses a reconciled partner without confirmation', async () => {
      const partner = await transfer();
      await db.updateTransaction({ id: partner, cleared: true, reconciled: 1 });
      await expect(remove({ ids: ['x1'] })).rejects.toThrow(/reconciled/);
      expect((await row('x1'))?.tombstone).toBe(0);
      expect((await row(partner))?.tombstone).toBe(0);
      await remove({ ids: ['x1'], confirmedReconciled: true });
      expect((await row(partner))?.tombstone).toBe(1);
    });

    it('counts children and partners toward the cap', async () => {
      await transfer();
      await addTxn('p', { is_parent: 1 });
      await addTxn('c', { is_child: 1, parent_id: 'p' });
      await setPref('accounts-write-max-ids', '3');
      // x1 + its partner + p + its child is four rows
      await expect(remove({ ids: ['x1', 'p'] })).rejects.toThrow(/at most 3/);
      expect((await row('x1'))?.tombstone).toBe(0);
      await remove({ ids: ['x1'] });
      expect((await row('x1'))?.tombstone).toBe(1);
    });
  });
});

describe('native/account-reopen', () => {
  const reopen = (id: unknown, undoToken: unknown = 'T') =>
    h['native/account-reopen']({ id, undoToken } as never);

  it('reopens a closed account as one undo step', async () => {
    await reopen('old');
    expect((await account('old'))?.closed).toBe(0);
    await undo();
    expect((await account('old'))?.closed).toBe(1);
  });

  it('refuses an open, unknown or non-string account and a missing token', async () => {
    await expect(reopen('checking')).rejects.toThrow(/closed/);
    await expect(reopen('nope')).rejects.toThrow(/closed/);
    await expect(reopen(5)).rejects.toThrow(/closed/);
    await expect(reopen('old', '')).rejects.toThrow(/undo token/);
    expect((await account('old'))?.closed).toBe(1);
  });
});

describe('native/account-move', () => {
  const move = (id: unknown, targetId: unknown, undoToken: unknown = 'T') =>
    h['native/account-move']({ id, targetId, undoToken } as never);
  const order = async (offbudget: number) =>
    (
      await db.all<{ id: string }>(
        'SELECT id FROM accounts WHERE tombstone = 0 AND closed = 0 AND offbudget = ? ORDER BY sort_order, name',
        [offbudget],
      )
    ).map(a => a.id);

  beforeEach(async () => {
    await addAccount('house2', 'House 2', { offbudget: 1 });
  });

  it('moves before a target in the same section, as one undo step', async () => {
    const before = await order(0);
    expect(before).toEqual(['checking', 'savings', 'card']);
    await move('savings', 'checking');
    expect(await order(0)).toEqual(['savings', 'checking', 'card']);
    await undo();
    expect(await order(0)).toEqual(before);
  });

  it('moves to the end of its section with a null target', async () => {
    await move('checking', null);
    expect(await order(0)).toEqual(['savings', 'card', 'checking']);
    expect(await order(1)).toEqual(['house', 'house2']);
  });

  it('refuses another section, a closed or unknown account and a missing token, changing nothing', async () => {
    const before = await order(0);
    await expect(move('savings', 'house')).rejects.toThrow(/section/);
    await expect(move('old', 'checking')).rejects.toThrow(/open/);
    await expect(move('savings', 'old')).rejects.toThrow(/open/);
    await expect(move('nope', null)).rejects.toThrow(/open/);
    await expect(move('savings', 'savings')).rejects.toThrow(/section/);
    await expect(move('savings', null, '')).rejects.toThrow(/undo token/);
    expect(await order(0)).toEqual(before);
  });
});

// Design D3a: native/undo refuses, changing nothing, when a row or account the
// write touched differs from the state the write left (a sync edit since).
describe('native/undo after an accounts write', () => {
  it('refuses when a touched row was edited since, and changes nothing', async () => {
    await categorize({ ids: ['t1', 't2'] });
    await db.updateTransaction({ id: 't2', category: 'dining' });
    await expect(undo()).rejects.toThrow(/changed since/);
    expect((await row('t1'))?.category).toBe('groceries');
    expect((await row('t2'))?.category).toBe('dining');
  });

  it('undoes when only an untouched row changed', async () => {
    await categorize({ ids: ['t1'] });
    await db.updateTransaction({ id: 't2', category: 'groceries' });
    await undo();
    expect((await row('t1'))?.category).toBeNull();
    expect((await row('t2'))?.category).toBe('groceries');
  });

  it('refuses a delete undo when the row, a child or the partner changed since', async () => {
    await addTxn('p', { is_parent: 1 });
    await addTxn('c', { is_child: 1, parent_id: 'p' });
    await remove({ ids: ['t1', 'p'] });
    await db.updateTransaction({ id: 'c', category: 'dining' });
    await expect(undo()).rejects.toThrow(/changed since/);
    expect((await row('t1'))?.tombstone).toBe(1);
    expect((await row('p'))?.tombstone).toBe(1);
  });

  it('refuses a reopen undo when the account changed since', async () => {
    await h['native/account-reopen']({ id: 'old', undoToken: 'T' } as never);
    await db.update('accounts', { id: 'old', sort_order: 77 });
    await expect(undo()).rejects.toThrow(/changed since/);
    expect((await account('old'))?.closed).toBe(0);
  });

  it('refuses a move undo when an account of the section moved since', async () => {
    await h['native/account-move']({
      id: 'savings',
      targetId: 'checking',
      undoToken: 'T',
    } as never);
    await db.update('accounts', { id: 'card', sort_order: 12345 });
    await expect(undo()).rejects.toThrow(/changed since/);
    expect((await account('card'))?.sort_order).toBe(12345);
  });
});

// The full set a write touches: split children and every transfer partner,
// including the partners of a split's children. The reconciled check and the
// cap apply to all of it, and the count reported is the true one.
describe('the full set of rows a write touches', () => {
  // A split `p` in Checking whose children c1 and c2 each transfer to Savings
  async function splitWithTransfers() {
    await batchUpdateTransactions({
      added: [
        {
          id: 'p',
          account: 'checking',
          date: '2016-12-20',
          amount: -900,
          is_parent: true,
        },
        {
          id: 'c1',
          account: 'checking',
          date: '2016-12-20',
          amount: -400,
          is_child: true,
          parent_id: 'p',
          payee: 'to-savings',
        },
        {
          id: 'c2',
          account: 'checking',
          date: '2016-12-20',
          amount: -500,
          is_child: true,
          parent_id: 'p',
          payee: 'to-savings',
        },
      ] as never,
    });
    const partner = async (id: string) =>
      (
        await db.first<{ transferred_id: string }>(
          'SELECT transferred_id FROM transactions WHERE id = ?',
          [id],
        )
      )?.transferred_id as string;
    return { partner1: await partner('c1'), partner2: await partner('c2') };
  }

  it('refuses deleting a split whose child`s partner is reconciled, and the cap counts that partner', async () => {
    const { partner1 } = await splitWithTransfers();
    await db.updateTransaction({ id: partner1, cleared: true, reconciled: 1 });
    await setPref('accounts-write-max-ids', '3');
    // p, c1, c2 and two partners are five rows
    await expect(remove({ ids: ['p'] })).rejects.toThrow(/at most 3/);
    await setPref('accounts-write-max-ids', '5');
    await expect(remove({ ids: ['p'] })).rejects.toThrow(/reconciled/);
    for (const id of ['p', 'c1', 'c2', partner1]) {
      expect((await row(id))?.tombstone).toBe(0);
    }
  });

  it('deletes the whole set with confirmation and reports the true count', async () => {
    const { partner1, partner2 } = await splitWithTransfers();
    await db.updateTransaction({ id: partner1, cleared: true, reconciled: 1 });
    await setPref('accounts-write-max-ids', '5');
    expect(await remove({ ids: ['p'], confirmedReconciled: true })).toEqual({
      deleted: 5,
    });
    for (const id of ['p', 'c1', 'c2', partner1, partner2]) {
      expect((await row(id))?.tombstone).toBe(1);
    }
  });

  it('does not count a partner that is a split child, which is unlinked and kept', async () => {
    await addTxn('pp', { account: 'savings', is_parent: 1 });
    await addTxn('pc', { account: 'savings', is_child: 1, parent_id: 'pp' });
    await batchUpdateTransactions({
      added: [
        {
          id: 'x1',
          account: 'checking',
          payee: 'to-savings',
          amount: -500,
          date: '2016-12-20',
        },
      ] as never,
    });
    // Link x1 to the savings child, as a transfer into a split child is
    await db.updateTransaction({ id: 'x1', transfer_id: 'pc' });
    await db.updateTransaction({ id: 'pc', transfer_id: 'x1' });
    expect(await remove({ ids: ['x1'] })).toEqual({ deleted: 1 });
    expect((await row('pc'))?.tombstone).toBe(0);
  });

  it('refuses unlinking a partner inside a reconciled split without confirmation', async () => {
    await addTxn('pp', { account: 'savings', is_parent: 1 });
    await addTxn('pc', { account: 'savings', is_child: 1, parent_id: 'pp' });
    await batchUpdateTransactions({
      added: [
        {
          id: 'x1',
          account: 'checking',
          payee: 'to-savings',
          amount: -500,
          date: '2016-12-20',
        },
      ] as never,
    });
    await db.updateTransaction({ id: 'x1', transfer_id: 'pc' });
    await db.updateTransaction({ id: 'pc', transfer_id: 'x1' });
    // Only the parent carries the reconciled flag
    await db.updateTransaction({ id: 'pp', cleared: true, reconciled: 1 });
    await expect(remove({ ids: ['x1'] })).rejects.toThrow(/reconciled/);
    expect((await row('x1'))?.tombstone).toBe(0);
    expect(await remove({ ids: ['x1'], confirmedReconciled: true })).toEqual({
      deleted: 1,
    });
  });

  it('refuses categorizing a transfer whose partner is reconciled without confirmation, and counts the partner', async () => {
    await batchUpdateTransactions({
      added: [
        {
          id: 'x2',
          account: 'checking',
          payee: 'to-house',
          amount: -700,
          date: '2016-12-20',
        },
      ] as never,
    });
    const partner = (
      await db.first<{ transferred_id: string }>(
        'SELECT transferred_id FROM transactions WHERE id = ?',
        ['x2'],
      )
    )?.transferred_id as string;
    await db.updateTransaction({ id: partner, cleared: true, reconciled: 1 });
    await expect(categorize({ ids: ['x2'] })).rejects.toThrow(/reconciled/);
    await setPref('accounts-write-max-ids', '1');
    await expect(
      categorize({ ids: ['x2'], confirmedReconciled: true }),
    ).rejects.toThrow(/at most 1/);
    await setPref('accounts-write-max-ids', '2');
    await categorize({ ids: ['x2'], confirmedReconciled: true });
    expect((await row('x2'))?.category).toBe('groceries');
  });

  it('restores both rows of a transfer when a delete is undone', async () => {
    await batchUpdateTransactions({
      added: [
        {
          id: 'x1',
          account: 'checking',
          payee: 'to-savings',
          amount: -500,
          date: '2016-12-20',
        },
      ] as never,
    });
    const partner = (
      await db.first<{ transferred_id: string }>(
        'SELECT transferred_id FROM transactions WHERE id = ?',
        ['x1'],
      )
    )?.transferred_id as string;
    await remove({ ids: ['x1'] });
    await undo();
    expect((await row('x1'))?.tombstone).toBe(0);
    expect((await row(partner))?.tombstone).toBe(0);
  });

  it('treats repeated ids as one row', async () => {
    expect(await categorize({ ids: ['t1', 't1', 't1'] })).toEqual({
      updated: 1,
    });
    expect(await remove({ ids: ['t2', 't2'] })).toEqual({ deleted: 1 });
  });
});
// Review of the undo check: the whole set a write touched, and every column a
// later change could alter
describe('native/undo refuses after a later change to anything the write touched', () => {
  async function transferRow() {
    await batchUpdateTransactions({
      added: [
        {
          id: 'x2',
          account: 'checking',
          payee: 'to-house',
          amount: -700,
          date: '2016-12-20',
          notes: 'orig',
        },
      ] as never,
    });
    return (
      await db.first<{ transferred_id: string }>(
        'SELECT transferred_id FROM transactions WHERE id = ?',
        ['x2'],
      )
    )?.transferred_id as string;
  }
  const partnerState = (id: string) =>
    db.first<{ notes: string; amount: number }>(
      'SELECT notes, amount FROM transactions WHERE id = ?',
      [id],
    );

  it('refuses a categorize undo after the transfer partner`s notes and amount were edited', async () => {
    const partner = await transferRow();
    await categorize({ ids: ['x2'] });
    await db.updateTransaction({
      id: partner,
      notes: 'edited elsewhere',
      amount: 999,
    });
    await expect(undo()).rejects.toThrow(/changed since/);
    expect(await partnerState(partner)).toEqual({
      notes: 'edited elsewhere',
      amount: 999,
    });
  });

  it('refuses a delete undo after the transfer partner was edited', async () => {
    const partner = await transferRow();
    await remove({ ids: ['x2'] });
    await db.updateTransaction({ id: partner, notes: 'edited elsewhere' });
    await expect(undo()).rejects.toThrow(/changed since/);
    expect((await row(partner))?.tombstone).toBe(1);
  });

  it('refuses a delete undo after a split child`s transfer partner was edited', async () => {
    await batchUpdateTransactions({
      added: [
        {
          id: 'p',
          account: 'checking',
          date: '2016-12-20',
          amount: -400,
          is_parent: true,
        },
        {
          id: 'c1',
          account: 'checking',
          date: '2016-12-20',
          amount: -400,
          is_child: true,
          parent_id: 'p',
          payee: 'to-savings',
        },
      ] as never,
    });
    const partner = (
      await db.first<{ transferred_id: string }>(
        'SELECT transferred_id FROM transactions WHERE id = ?',
        ['c1'],
      )
    )?.transferred_id as string;
    await remove({ ids: ['p'] });
    await db.updateTransaction({ id: partner, notes: 'edited elsewhere' });
    await expect(undo()).rejects.toThrow(/changed since/);
    expect((await row(partner))?.tombstone).toBe(1);
  });

  it('refuses when a touched row was reconciled since', async () => {
    await categorize({ ids: ['t1'] });
    await db.updateTransaction({ id: 't1', cleared: true, reconciled: 1 });
    await expect(undo()).rejects.toThrow(/changed since/);
    expect((await row('t1'))?.category).toBe('groceries');
  });

  it('refuses when a touched row was linked to a schedule since', async () => {
    await categorize({ ids: ['t1'] });
    await db.update('transactions', { id: 't1', schedule: 'sched1' });
    await expect(undo()).rejects.toThrow(/changed since/);
    expect((await row('t1'))?.category).toBe('groceries');
  });

  it('refuses a reopen undo after the account was closed again or deleted', async () => {
    await h['native/account-reopen']({ id: 'old', undoToken: 'T' } as never);
    await db.update('accounts', { id: 'old', closed: 1 });
    await expect(undo()).rejects.toThrow(/changed since/);
  });

  it('refuses a reopen undo after the account was deleted', async () => {
    await h['native/account-reopen']({ id: 'old', undoToken: 'T' } as never);
    await db.update('accounts', { id: 'old', tombstone: 1 });
    await expect(undo()).rejects.toThrow(/changed since/);
  });

  it('refuses a move undo after a closed account of the section changed', async () => {
    await h['native/account-move']({
      id: 'savings',
      targetId: 'checking',
      undoToken: 'T',
    } as never);
    // `old` is closed and on budget: the move reorders it with the section
    await db.update('accounts', { id: 'old', sort_order: 4242 });
    await expect(undo()).rejects.toThrow(/changed since/);
    expect((await account('old'))?.sort_order).toBe(4242);
  });

  it('undoes a categorize, delete, reopen and move when nothing changed since', async () => {
    await categorize({ ids: ['t1'] });
    await undo();
    expect((await row('t1'))?.category).toBeNull();
    await remove({ ids: ['t1'] });
    await undo();
    expect((await row('t1'))?.tombstone).toBe(0);
    await h['native/account-reopen']({ id: 'old', undoToken: 'T' } as never);
    await undo();
    expect((await account('old'))?.closed).toBe(1);
    await h['native/account-move']({
      id: 'savings',
      targetId: 'checking',
      undoToken: 'T',
    } as never);
    await undo();
  });
});
