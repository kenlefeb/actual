import { existsSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { loadRules } from '#server/transactions/transaction-rules';

import { app } from './app';

const FIXTURE = join(__dirname, '__fixtures__', 'order-history.csv');

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
  await loadRules();
});

function setFlag(value: string) {
  db.runQuery('INSERT OR REPLACE INTO preferences (id, value) VALUES (?, ?)', [
    'flags.amazonOrderItemization',
    value,
  ]);
}

function tempFile(contents: string) {
  const filepath = join(mkdtempSync(join(tmpdir(), 'amazon-')), 'orders.csv');
  writeFileSync(filepath, contents);
  return filepath;
}

describe('amazon-orders-parse on the desktop app', () => {
  test("leaves the user's own file alone", async () => {
    const filepath = tempFile('Date,Amount\n2026-11-04,-1.00\n');

    const result = await app.handlers['amazon-orders-parse']({ filepath });

    expect(result).toHaveProperty('error.missing');
    expect(existsSync(filepath)).toBe(true);
  });

  test('Import stays on the device', async () => {
    const card = await db.insertAccount({ name: 'Card' });
    await db.insertTransaction({
      account: card,
      amount: -3240,
      date: '2026-11-06',
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const before = await db.all('SELECT * FROM messages_crdt');

    const result = await app.handlers['amazon-orders-parse']({
      filepath: FIXTURE,
    });

    expect(result).toHaveProperty('reviews');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await db.all('SELECT * FROM messages_crdt')).toEqual(before);
  });
});

describe('the feature flag', () => {
  test('Turned off after applying', async () => {
    const card = await db.insertAccount({ name: 'Card' });
    const id = await db.insertTransaction({
      account: card,
      amount: -3240,
      date: '2026-11-12',
    });
    const result = await app.handlers['amazon-orders-parse']({
      filepath: FIXTURE,
    });
    if (!('reviews' in result)) {
      throw new Error('expected a review');
    }
    const lamp = result.reviews.find(r => r.charge.orderId === '111-0000003');
    setFlag('true');
    await app.handlers['amazon-orders-apply']({
      matches: [{ charge: lamp!.charge, transactionId: id }],
    });
    const applied = await db.all(
      'SELECT id, notes, amount, parent_id FROM v_transactions_internal_alive',
    );

    setFlag('false');

    expect(applied).toHaveLength(3);
    expect(
      await db.all(
        'SELECT id, notes, amount, parent_id FROM v_transactions_internal_alive',
      ),
    ).toEqual(applied);
  });
});
