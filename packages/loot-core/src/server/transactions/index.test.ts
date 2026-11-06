import { beforeEach, describe, expect, it } from 'vitest';

import { app as accountsApp } from '#server/accounts/app';
import * as db from '#server/db';
import { undo } from '#server/undo';

import { app as transactionsApp } from './app';
import { removeTransfer } from './transfer';

import { batchUpdateTransactions } from './index';

describe('Delete and undo', () => {
  async function attach(id: string, transaction_id: string) {
    await db.insert('transaction_attachments', {
      id,
      transaction_id,
      name: `${id}.pdf`,
      mime: 'application/pdf',
      size: 1,
      sha256: '',
      encrypt_meta: null,
      created_at: '2026-11-05T00:00:00.000Z',
    });
  }

  async function liveAttachments() {
    const rows = await db.all<{ id: string }>(
      'SELECT id FROM transaction_attachments WHERE tombstone = 0 ORDER BY id',
    );
    return rows.map(row => row.id);
  }

  const deleteTransaction = (id: string) =>
    transactionsApp.handlers['transactions-batch-update']({
      deleted: [{ id }],
    });

  beforeEach(async () => {
    await db.insertAccount({ id: 'one', name: 'one' });
  });

  it("removes a deleted transaction's attachments, and one undo restores both", async () => {
    await db.insertTransaction({
      id: 't1',
      account: 'one',
      amount: -100,
      date: '2024-01-01',
    });
    await attach('a1', 't1');
    await attach('a2', 't1');

    await deleteTransaction('t1');
    expect(await liveAttachments()).toEqual([]);

    await undo();
    expect(await db.getTransaction('t1')).toBeTruthy();
    expect(await liveAttachments()).toEqual(['a1', 'a2']);
  });

  it('removes the attachments of a deleted split parent', async () => {
    await db.insertTransaction({
      id: 'parent',
      account: 'one',
      amount: -100,
      date: '2024-01-01',
      is_parent: true,
    });
    await db.insertTransaction({
      id: 'child',
      account: 'one',
      amount: -100,
      date: '2024-01-01',
      is_child: true,
      parent_id: 'parent',
    });
    await attach('a1', 'parent');

    await deleteTransaction('parent');
    expect(await liveAttachments()).toEqual([]);

    await undo();
    expect(await liveAttachments()).toEqual(['a1']);
  });

  it('removes attachments when closing an account deletes its transactions', async () => {
    await db.insertPayee({ name: '', transfer_acct: 'one' });
    await db.insertTransaction({
      id: 't1',
      account: 'one',
      amount: -100,
      date: '2024-01-01',
    });
    await attach('a1', 't1');

    await accountsApp.handlers['account-close']({ id: 'one', forced: true });

    expect(await liveAttachments()).toEqual([]);
  });

  it('removes attachments of the other side when a transfer is removed', async () => {
    await db.insertAccount({ id: 'two', name: 'two' });
    await db.insertTransaction({
      id: 'out',
      account: 'one',
      amount: -100,
      date: '2024-01-01',
      transfer_id: 'in',
    });
    await db.insertTransaction({
      id: 'in',
      account: 'two',
      amount: 100,
      date: '2024-01-01',
      transfer_id: 'out',
    });
    await attach('a-in', 'in');

    await removeTransfer({ id: 'out', transfer_id: 'in' });

    expect(await liveAttachments()).toEqual([]);
  });
});

beforeEach(global.emptyDatabase());

describe('batchUpdateTransactions', () => {
  it('returns the added, updated and deleted transactions separately', async () => {
    await db.insertAccount({ id: 'one', name: 'one' });
    await db.insertTransaction({
      id: 'to-update',
      account: 'one',
      amount: 100,
      date: '2024-01-01',
    });
    await db.insertTransaction({
      id: 'to-delete',
      account: 'one',
      amount: 200,
      date: '2024-01-02',
    });

    const result = await batchUpdateTransactions({
      added: [{ id: 'added', account: 'one', amount: 300, date: '2024-01-03' }],
      updated: [{ id: 'to-update', amount: 150 }],
      deleted: [{ id: 'to-delete' }],
      // With transfers enabled the returned updates only carry
      // transfer changes; this test is about the partitioning
      runTransfers: false,
    });

    expect(result.added.map(transaction => transaction.id)).toEqual(['added']);
    expect(result.updated.map(transaction => transaction?.id)).toEqual([
      'to-update',
    ]);
    expect(result.deleted.map(transaction => transaction.id)).toEqual([
      'to-delete',
    ]);
    expect(result.errors).toEqual([]);

    const remaining = await db.all<{ id: string; amount: number }>(
      'SELECT id, amount FROM v_transactions_internal WHERE tombstone = 0 ORDER BY id',
    );
    expect(remaining).toEqual([
      { id: 'added', amount: 300 },
      { id: 'to-update', amount: 150 },
    ]);
  });

  it('does not add any transactions when only editing a field', async () => {
    await db.insertAccount({ id: 'one', name: 'one' });
    await db.insertTransaction({
      id: 't1',
      account: 'one',
      amount: 100,
      date: '2024-01-01',
    });

    const result = await batchUpdateTransactions({
      updated: [{ id: 't1', notes: 'hello' }],
      runTransfers: false,
    });

    expect(result.added).toEqual([]);
    expect(result.deleted).toEqual([]);
    expect(result.updated.map(transaction => transaction?.id)).toEqual(['t1']);
    const updated = await db.first<{ notes: string }>(
      'SELECT notes FROM transactions WHERE id = ?',
      ['t1'],
    );
    expect(updated?.notes).toBe('hello');
  });
});
