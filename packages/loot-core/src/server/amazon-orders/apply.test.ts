import { reconcileTransactions } from '#server/accounts/sync';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { insertRule, loadRules } from '#server/transactions/transaction-rules';
import { undo } from '#server/undo';

import { app } from './app';
import { orderLink, orderMarker } from './marker';
import { matchAmazonCharges } from './match';
import type { AmazonCharge, AmazonItem } from './types';

let card: string;
let amazon: string;

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
  await loadRules();
  await db.insertCategoryGroup({ id: 'group', name: 'Spending' });
  await db.insertCategory({
    id: 'shopping',
    name: 'Shopping',
    cat_group: 'group',
  });
  await db.insertCategory({
    id: 'household',
    name: 'Household',
    cat_group: 'group',
  });
  card = await db.insertAccount({ name: 'Card' });
  amazon = await db.insertPayee({ name: 'AMZN Mktp US' });
});

function item(name: string, price: number, fields: Partial<AmazonItem> = {}) {
  return {
    name,
    quantity: 1,
    price,
    tax: 0,
    shipping: 0,
    discount: 0,
    ...fields,
  };
}

function charge(
  orderId: string,
  items: AmazonItem[],
  shipDate = '2026-11-04',
): AmazonCharge {
  const amount = items.reduce(
    (sum, i) => sum + i.price * i.quantity + i.tax + i.shipping - i.discount,
    0,
  );
  return {
    id: `${orderId}|${shipDate}`,
    orderId,
    shipDate,
    amount,
    items,
    giftCardOrPoints: false,
    totalDifference: 0,
  };
}

const lampAndBulbs = () =>
  charge('111-0000001', [
    item('Lamp', 2000, { tax: 160 }),
    item('Bulb pack', 500, { quantity: 2, tax: 80 }),
  ]);

async function txn(fields: Record<string, unknown> = {}) {
  return db.insertTransaction({
    account: card,
    amount: -3240,
    date: '2026-11-05',
    payee: amazon,
    ...fields,
  });
}

function apply(
  matches: Array<{ charge: AmazonCharge; transactionId: string }>,
) {
  return app.handlers['amazon-orders-apply']({ matches });
}

async function lines(parentId: string) {
  return db.all<db.DbViewTransactionInternal>(
    `SELECT * FROM v_transactions_internal_alive WHERE parent_id = ?
     ORDER BY sort_order DESC`,
    [parentId],
  );
}

async function row(id: string) {
  return db.first<db.DbViewTransactionInternal>(
    'SELECT * FROM v_transactions_internal WHERE id = ?',
    [id],
  );
}

async function bulbRule(category = 'household') {
  await insertRule({
    stage: null,
    conditionsOp: 'and',
    conditions: [{ op: 'contains', field: 'notes', value: 'Bulb' }],
    actions: [{ op: 'set', field: 'category', value: category }],
  });
}

describe('amazon-orders-apply', () => {
  test('Apply a two-item charge', async () => {
    const id = await txn();

    const result = await apply([{ charge: lampAndBulbs(), transactionId: id }]);

    expect(result).toEqual({ applied: [id], skipped: [] });
    expect((await row(id))?.is_parent).toBe(1);
    expect(
      (await lines(id)).map(l => [l.notes, l.amount, l.account, l.date]),
    ).toEqual([
      ['Lamp ×1', -2160, card, 20261105],
      ['Bulb pack ×2', -1080, card, 20261105],
    ]);
  });

  test('Rounding', async () => {
    const id = await txn({ amount: -1000 });
    const three = charge('111-0000009', [
      item('A', 333, { tax: 1 }),
      item('B', 333),
      item('C', 333),
    ]);

    await apply([{ charge: three, transactionId: id }]);

    const amounts = (await lines(id)).map(l => l.amount);
    expect(amounts).toHaveLength(3);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(-1000);
  });

  test('Existing note kept', async () => {
    const id = await txn({ notes: 'birthday', cleared: 0 });
    const before = await row(id);

    await apply([{ charge: lampAndBulbs(), transactionId: id }]);

    const after = await row(id);
    expect(after?.notes).toBe(`birthday\n${orderMarker('111-0000001')}`);
    expect(after?.notes).toContain(orderLink('111-0000001'));
    expect(after).toMatchObject({
      amount: before?.amount,
      date: before?.date,
      payee: before?.payee,
      cleared: before?.cleared,
      account: before?.account,
    });
  });

  test('Undo apply-all', async () => {
    const ids: string[] = [];
    const matches = [];
    for (let i = 0; i < 5; i++) {
      const id = await txn({ notes: `note ${i}` });
      ids.push(id);
      matches.push({
        charge: { ...lampAndBulbs(), orderId: `111-000010${i}` },
        transactionId: id,
      });
    }
    const before = await Promise.all(ids.map(row));

    await apply(matches);
    await undo();

    expect(await Promise.all(ids.map(row))).toEqual(before);
    for (const id of ids) {
      expect(await lines(id)).toEqual([]);
    }
  });

  test('Undo restores the split parent category', async () => {
    const id = await txn({ category: 'shopping' });

    await apply([{ charge: lampAndBulbs(), transactionId: id }]);
    expect((await row(id))?.category).toBeNull();
    await undo();

    expect((await row(id))?.category).toBe('shopping');
  });

  test('Rule sets the category from the note', async () => {
    await bulbRule();
    const id = await txn();

    await apply([{ charge: lampAndBulbs(), transactionId: id }]);

    expect((await lines(id))[1]).toMatchObject({
      notes: 'Bulb pack ×2',
      category: 'household',
    });
  });

  test('No rule matches a categorized charge', async () => {
    const id = await txn({ category: 'shopping' });

    await apply([{ charge: lampAndBulbs(), transactionId: id }]);

    expect((await lines(id)).map(l => l.category)).toEqual([
      'shopping',
      'shopping',
    ]);
    // The split parent's category is cleared, as for any split
    expect(
      await db.first('SELECT category FROM transactions WHERE id = ?', [id]),
    ).toEqual({ category: null });
  });

  test('a line no rule matches stays uncategorized when the parent was', async () => {
    const id = await txn();

    await apply([{ charge: lampAndBulbs(), transactionId: id }]);

    expect((await lines(id)).map(l => l.category)).toEqual([null, null]);
  });

  test('A rule overrides the former category', async () => {
    await bulbRule();
    const id = await txn({ category: 'shopping' });

    await apply([{ charge: lampAndBulbs(), transactionId: id }]);

    expect((await lines(id)).map(l => l.category)).toEqual([
      'shopping',
      'household',
    ]);
  });

  test('Single-item charge', async () => {
    const id = await txn({ amount: -1296 });
    const book = charge('111-0000001', [item('Book', 1200, { tax: 96 })]);

    await apply([{ charge: book, transactionId: id }]);

    const after = await row(id);
    expect(after?.is_parent).toBe(0);
    expect(after?.notes).toBe(`Book ×1\n${orderMarker('111-0000001')}`);
    expect(await lines(id)).toEqual([]);
  });

  test("Single-item charge takes a rule's category", async () => {
    await bulbRule();
    const id = await txn({ amount: -1000, category: 'shopping' });
    const bulbs = charge('111-0000001', [
      item('Bulb pack', 500, { quantity: 2 }),
    ]);

    await apply([{ charge: bulbs, transactionId: id }]);

    expect(await row(id)).toMatchObject({
      is_parent: 0,
      category: 'household',
    });
  });

  test('A free item', async () => {
    const id = await txn({ amount: -2000 });
    const kettle = charge('111-0000001', [
      item('Kettle', 2000),
      item('Sample', 0),
    ]);

    await apply([{ charge: kettle, transactionId: id }]);

    const after = await row(id);
    expect(after?.is_parent).toBe(0);
    expect(after?.notes).toContain('Kettle ×1');
    expect(after?.notes).toContain('Sample ×1');
    expect(await lines(id)).toEqual([]);
  });

  test('no zero line is written when two lines remain', async () => {
    const id = await txn();
    const withSample = charge('111-0000001', [
      ...lampAndBulbs().items,
      item('Sample', 0),
    ]);

    await apply([{ charge: withSample, transactionId: id }]);

    const written = await lines(id);
    expect(written.map(l => l.amount)).toEqual([-2160, -1080]);
    expect(written[0].notes).toBe('Lamp ×1, Sample ×1');
  });

  test('Rule that sets a new payee', async () => {
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ op: 'contains', field: 'notes', value: 'Gift' }],
      actions: [{ op: 'set', field: 'payee_name', value: 'Gifts' }],
    });
    const id = await txn();
    const gifts = charge('111-0000001', [
      item('Gift wrap', 1000),
      item('Lamp', 2240),
    ]);

    await apply([{ charge: gifts, transactionId: id }]);

    expect(
      await db.all('SELECT id FROM payees WHERE name = ?', ['Gifts']),
    ).toEqual([]);
    expect((await row(id))?.payee).toBe(amazon);
    expect((await lines(id)).map(l => l.payee)).toEqual([amazon, amazon]);
  });

  test('Itemize a reconciled charge', async () => {
    const id = await txn({ cleared: 1, reconciled: 1 });
    const reconciledBalance = () =>
      db.first<{ total: number }>(
        `SELECT SUM(amount) AS total FROM v_transactions_internal_alive
          WHERE account = ? AND reconciled = 1 AND is_parent = 0`,
        [card],
      );
    const before = await reconciledBalance();

    const [review] = await matchAmazonCharges([lampAndBulbs()]);
    expect(review.transaction?.reconciled).toBe(true);
    await apply([{ charge: lampAndBulbs(), transactionId: id }]);

    expect((await lines(id)).map(l => [l.cleared, l.reconciled])).toEqual([
      [1, 1],
      [1, 1],
    ]);
    expect(await reconciledBalance()).toEqual(before);
  });

  test('Import the same export twice', async () => {
    const split = await txn();
    const single = await txn({ amount: -1296, date: '2026-11-03' });
    const book = charge(
      '111-0000002',
      [item('Book', 1200, { tax: 96 })],
      '2026-11-02',
    );

    await apply([
      { charge: lampAndBulbs(), transactionId: split },
      { charge: book, transactionId: single },
    ]);
    const reviews = await matchAmazonCharges([lampAndBulbs(), book]);
    const again = await apply([
      { charge: lampAndBulbs(), transactionId: split },
      { charge: book, transactionId: single },
    ]);

    expect(reviews.map(r => r.status)).toEqual([
      'already-itemized',
      'already-itemized',
    ]);
    expect(again.applied).toEqual([]);
    expect(await lines(split)).toHaveLength(2);
  });

  test('skips, with a reason, what changed after the review', async () => {
    const changed = await txn({ amount: -3000 });
    const parent = await txn({ is_parent: 1 });
    const out = await txn();
    await db.updateTransaction({ id: out, transfer_id: await txn() });
    const annotated = await txn({ notes: orderMarker('111-0000099') });
    const deleted = await txn();
    await db.deleteTransaction({ id: deleted });
    const zero = await txn({ amount: 0 });

    const result = await apply([
      ...[changed, parent, out, annotated, deleted, 'no-such-id'].map(id => ({
        charge: lampAndBulbs(),
        transactionId: id,
      })),
      { charge: { ...lampAndBulbs(), amount: 0 }, transactionId: zero },
    ]);

    expect(result.applied).toEqual([]);
    expect(result.skipped.map(s => s.reason)).toEqual([
      'amount-changed',
      'split',
      'transfer',
      'already-itemized',
      'missing',
      'missing',
      'not-a-charge',
    ]);
  });

  test('Bank sync updates the date', async () => {
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ op: 'contains', field: 'imported_payee', value: 'AMZN' }],
      actions: [{ op: 'set', field: 'category', value: 'shopping' }],
    });
    const id = await txn({ imported_id: 'bank-1', cleared: 0 });
    await apply([{ charge: lampAndBulbs(), transactionId: id }]);
    const notes = (await row(id))?.notes;

    await reconcileTransactions(
      card,
      [
        {
          imported_id: 'bank-1',
          date: '2026-11-07',
          amount: -3240,
          payee_name: 'AMZN Mktp US',
          imported_payee: 'AMZN Mktp US',
          cleared: true,
        },
      ],
      { updateDates: true },
    );

    expect((await row(id))?.notes).toBe(notes);
    expect(
      (await lines(id)).map(l => [l.notes, l.amount, l.date, l.cleared]),
    ).toEqual([
      ['Lamp ×1', -2160, 20261107, 1],
      ['Bulb pack ×2', -1080, 20261107, 1],
    ]);
    // Existing upstream behavior: the rule's category lands on the parent
    expect(
      await db.first('SELECT category FROM transactions WHERE id = ?', [id]),
    ).toEqual({ category: 'shopping' });
  });

  test('Bank file imported again', async () => {
    const split = await txn();
    const single = await txn({ amount: -1296, date: '2026-11-03' });
    const book = charge(
      '111-0000002',
      [item('Book', 1200, { tax: 96 })],
      '2026-11-02',
    );
    await apply([
      { charge: lampAndBulbs(), transactionId: split },
      { charge: book, transactionId: single },
    ]);
    const before = await db.all<db.DbViewTransactionInternal>(
      'SELECT * FROM v_transactions_internal_alive ORDER BY id',
    );

    const result = await reconcileTransactions(card, [
      { date: '2026-11-05', amount: -3240, payee_name: 'AMZN Mktp US' },
      { date: '2026-11-03', amount: -1296, payee_name: 'AMZN Mktp US' },
    ]);

    expect(result.added).toEqual([]);
    const after = await db.all<db.DbViewTransactionInternal>(
      'SELECT * FROM v_transactions_internal_alive ORDER BY id',
    );
    expect(after.map(r => [r.id, r.notes, r.amount, r.parent_id])).toEqual(
      before.map(r => [r.id, r.notes, r.amount, r.parent_id]),
    );
  });
});
