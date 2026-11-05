import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';

import { orderMarker } from './marker';
import { matchAmazonCharges } from './match';
import type { AmazonCharge } from './types';

let card: string;
let card2: string;
let checking: string;

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
  card = await db.insertAccount({ name: 'Card' });
  card2 = await db.insertAccount({ name: 'Other card' });
  checking = await db.insertAccount({ name: 'Checking' });
});

function charge(
  orderId: string,
  shipDate: string,
  amount: number,
  { giftCardOrPoints = false } = {},
): AmazonCharge {
  return {
    id: `${orderId}|${shipDate}`,
    orderId,
    shipDate,
    amount,
    items: [
      {
        name: 'Thing',
        quantity: 1,
        price: amount,
        tax: 0,
        shipping: 0,
        discount: 0,
      },
    ],
    giftCardOrPoints,
    totalDifference: 0,
  };
}

async function payee(name: string) {
  return db.insertPayee({ name });
}

async function txn(fields: Record<string, unknown>): Promise<string> {
  return db.insertTransaction({ account: card, ...fields });
}

describe('matchAmazonCharges', () => {
  test('Charge posts two days after shipping', async () => {
    const id = await txn({
      amount: -3240,
      date: '2026-11-06',
      payee: await payee('AMZN Mktp US'),
    });

    const [review] = await matchAmazonCharges([
      charge('111-0000001', '2026-11-04', 3240),
    ]);

    expect(review.status).toBe('matched');
    expect(review.transaction).toMatchObject({
      id,
      account: card,
      accountName: 'Card',
      date: '2026-11-06',
      amount: -3240,
      payeeName: 'AMZN Mktp US',
    });
  });

  test('the window runs from one day before to five days after shipping', async () => {
    const before = await txn({ amount: -100, date: '2026-11-03' });
    const after = await txn({ amount: -200, date: '2026-11-09' });

    const reviews = await matchAmazonCharges([
      charge('111-0000001', '2026-11-04', 100),
      charge('111-0000002', '2026-11-04', 200),
    ]);

    expect(reviews.map(r => r.transaction?.id)).toEqual([before, after]);
  });

  test('Outside the date window', async () => {
    await txn({ amount: -3240, date: '2026-11-10' });
    await txn({ amount: -3240, date: '2026-11-02' });

    const [review] = await matchAmazonCharges([
      charge('111-0000001', '2026-11-04', 3240),
    ]);

    expect(review.status).toBe('unmatched');
    expect(review.transaction).toBeNull();
  });

  test('Already split by hand', async () => {
    const parent = await txn({
      amount: -3240,
      date: '2026-11-05',
      is_parent: true,
    });
    await txn({
      amount: -1000,
      date: '2026-11-05',
      is_child: true,
      parent_id: parent,
    });
    await txn({
      amount: -2240,
      date: '2026-11-05',
      is_child: true,
      parent_id: parent,
    });

    const [review] = await matchAmazonCharges([
      charge('111-0000001', '2026-11-04', 3240),
    ]);

    expect(review.status).toBe('already-split');
    expect(review.transaction).toBeNull();
    expect(review.candidates).toEqual([]);
  });

  test('Two equal candidates', async () => {
    const amazon = await payee('Amazon.com');
    const a = await txn({ amount: -2500, date: '2026-11-04', payee: amazon });
    const b = await txn({
      account: card2,
      amount: -2500,
      date: '2026-11-04',
      payee: amazon,
    });

    const [review] = await matchAmazonCharges([
      charge('111-0000003', '2026-11-03', 2500),
    ]);

    expect(review.status).toBe('ambiguous');
    expect(review.transaction).toBeNull();
    expect(review.candidates.map(c => c.id).sort()).toEqual([a, b].sort());
  });

  test('Payee is a hint, not a filter', async () => {
    const id = await txn({
      amount: -4000,
      date: '2026-11-06',
      payee: await payee('CARD PURCHASE 1234'),
    });

    const [review] = await matchAmazonCharges([
      charge('111-0000004', '2026-11-05', 4000),
    ]);

    expect(review.status).toBe('matched');
    expect(review.transaction?.id).toBe(id);
  });

  test('an Amazon-looking payee outranks a nearer date, then the nearest date wins', async () => {
    await txn({
      amount: -4000,
      date: '2026-11-05',
      payee: await payee('CARD PURCHASE'),
    });
    const amazon = await payee('Amazon.com');
    const near = await txn({
      amount: -4000,
      date: '2026-11-06',
      imported_payee: 'AMZN MKTP',
    });
    await txn({ amount: -4000, date: '2026-11-08', payee: amazon });

    const [review] = await matchAmazonCharges([
      charge('111-0000004', '2026-11-05', 4000),
    ]);

    expect(review.status).toBe('matched');
    expect(review.transaction?.id).toBe(near);
  });

  test('Two same-day orders of the same amount', async () => {
    const id = await txn({
      amount: -1500,
      date: '2026-11-03',
      payee: await payee('Amazon'),
    });

    const reviews = await matchAmazonCharges([
      charge('111-0000005', '2026-11-02', 1500),
      charge('111-0000006', '2026-11-02', 1500),
    ]);

    for (const review of reviews) {
      expect(review.status).toBe('ambiguous');
      expect(review.candidates.map(c => c.id)).toEqual([id]);
    }
  });

  test('two charges of the same amount each get their own transaction', async () => {
    const amazon = await payee('Amazon');
    const first = await txn({
      amount: -1500,
      date: '2026-11-03',
      payee: amazon,
    });
    const second = await txn({
      amount: -1500,
      date: '2026-11-08',
      payee: amazon,
    });

    const reviews = await matchAmazonCharges([
      charge('111-0000005', '2026-11-02', 1500),
      charge('111-0000006', '2026-11-07', 1500),
    ]);

    expect(reviews.map(r => r.transaction?.id)).toEqual([first, second]);
  });

  test('Only candidate taken by a nearer charge', async () => {
    const id = await txn({
      amount: -1500,
      date: '2026-11-03',
      payee: await payee('Amazon'),
    });

    const [later, nearer] = await matchAmazonCharges([
      charge('111-0000005', '2026-11-01', 1500),
      charge('111-0000006', '2026-11-02', 1500),
    ]);

    expect(nearer.status).toBe('matched');
    expect(nearer.transaction?.id).toBe(id);
    expect(later.status).toBe('ambiguous');
    expect(later.candidates.map(c => c.id)).toEqual([id]);
  });

  test('a charge whose best candidate is another transaction is no rival', async () => {
    const amazon = await payee('Amazon');
    const shared = await txn({
      amount: -1500,
      date: '2026-11-03',
      payee: amazon,
    });
    const own = await txn({
      amount: -1500,
      date: '2026-11-02',
      payee: amazon,
    });

    const reviews = await matchAmazonCharges([
      charge('111-0000005', '2026-11-04', 1500),
      charge('111-0000006', '2026-11-02', 1500),
    ]);

    expect(reviews.map(r => r.transaction?.id)).toEqual([shared, own]);
  });

  test('a charge of $0 or less is not matched, with a reason', async () => {
    await txn({ amount: 0, date: '2026-11-03' });
    await txn({ amount: 500, date: '2026-11-03' });

    const reviews = await matchAmazonCharges([
      charge('111-0000010', '2026-11-02', 0),
      charge('111-0000011', '2026-11-02', -500),
    ]);

    for (const review of reviews) {
      expect(review.status).toBe('unmatched');
      expect(review.reason).toBe('not-a-charge');
    }
  });

  test("Paid with a card that isn't in the budget", async () => {
    const [review] = await matchAmazonCharges([
      charge('111-0000007', '2026-11-01', 6000),
    ]);

    expect(review.status).toBe('unmatched');
    expect(review.charge.orderId).toBe('111-0000007');
  });

  test('an off-budget account is never searched', async () => {
    const offBudget = await db.insertAccount({ name: 'Loan', offbudget: 1 });
    await txn({ account: offBudget, amount: -6000, date: '2026-11-02' });

    const [review] = await matchAmazonCharges([
      charge('111-0000007', '2026-11-01', 6000),
    ]);

    expect(review.status).toBe('unmatched');
  });

  test('Transfer is never a candidate', async () => {
    const out = await txn({
      account: checking,
      amount: -2500,
      date: '2026-11-04',
    });
    const into = await txn({
      amount: 2500,
      date: '2026-11-04',
      transfer_id: out,
    });
    await db.updateTransaction({ id: out, transfer_id: into });

    const [review] = await matchAmazonCharges([
      charge('111-0000008', '2026-11-03', 2500),
    ]);

    expect(review.status).toBe('unmatched');
  });

  test('a deleted transaction is never a candidate', async () => {
    const id = await txn({ amount: -2500, date: '2026-11-04' });
    await db.deleteTransaction({ id });

    const [review] = await matchAmazonCharges([
      charge('111-0000008', '2026-11-03', 2500),
    ]);

    expect(review.status).toBe('unmatched');
  });

  test('Annotated for another order', async () => {
    await txn({
      amount: -1296,
      date: '2026-11-03',
      notes: `Book ×1\n${orderMarker('111-000000A')}`,
    });

    const [review] = await matchAmazonCharges([
      charge('111-000000B', '2026-11-03', 1296),
    ]);

    expect(review.status).toBe('unmatched');
  });

  test('a hand-applied #amazon tag without an order link stays a candidate', async () => {
    const id = await txn({
      amount: -1296,
      date: '2026-11-03',
      notes: 'books #amazon',
    });

    const [review] = await matchAmazonCharges([
      charge('111-000000B', '2026-11-03', 1296),
    ]);

    expect(review.status).toBe('matched');
    expect(review.transaction?.id).toBe(id);
  });

  test('a charge annotated for its own order shows "Already itemized"', async () => {
    await txn({
      amount: -1296,
      date: '2026-11-03',
      notes: `Book ×1\n${orderMarker('111-000000A')}`,
    });

    const [review] = await matchAmazonCharges([
      charge('111-000000A', '2026-11-02', 1296),
    ]);

    expect(review.status).toBe('already-itemized');
  });

  test('Order paid partly by a gift card is never matched', async () => {
    await txn({ amount: -1296, date: '2026-11-03' });

    const [review] = await matchAmazonCharges([
      charge('111-0000002', '2026-11-02', 1296, { giftCardOrPoints: true }),
    ]);

    expect(review.status).toBe('gift-card-or-points');
    expect(review.transaction).toBeNull();
  });

  test('a reconciled transaction stays a candidate and is marked reconciled', async () => {
    const id = await txn({
      amount: -3240,
      date: '2026-11-05',
      cleared: 1,
      reconciled: 1,
    });

    const [review] = await matchAmazonCharges([
      charge('111-0000001', '2026-11-04', 3240),
    ]);

    expect(review.status).toBe('matched');
    expect(review.transaction).toMatchObject({ id, reconciled: true });
  });
});
