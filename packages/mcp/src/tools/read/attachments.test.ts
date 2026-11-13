import * as api from '@actual-app/api';
import * as db from '@actual-app/core/server/db/index';

import { startHarness } from '#client-harness';

let h: Awaited<ReturnType<typeof startHarness>>;

afterEach(async () => {
  await h.close();
});

// The rows are written directly: the attach handler needs a sync server.
async function attach(transactionId: string, row: Record<string, unknown>) {
  await db.insertWithUUID('transaction_attachments', {
    transaction_id: transactionId,
    name: 'receipt.pdf',
    mime: 'application/pdf',
    size: 200000,
    sha256: 'abc123',
    encrypt_meta: '{"keyId":"k","iv":"i"}',
    created_at: '2026-11-01T10:00:00.000Z',
    ...row,
  });
}

async function transactionIds() {
  const { data } = (await api.runQuery(api.q('transactions').select('id'))) as {
    data: Array<{ id: string }>;
  };
  return data.map(t => t.id);
}

describe('list_transaction_attachments', () => {
  it('lists metadata only', async () => {
    h = await startHarness();
    const [txn] = await transactionIds();
    await attach(txn, {});
    const res = await h.call('list_transaction_attachments', {
      transaction_id: txn,
    });
    expect(res.json.items).toHaveLength(1);
    expect(res.json.items[0]).toMatchObject({
      transaction_id: txn,
      mime: 'application/pdf',
      size: 200000,
      created_at: '2026-11-01T10:00:00.000Z',
      text: { name: 'receipt.pdf' },
    });
    expect(res.text).not.toContain('abc123');
    expect(res.text).not.toContain('keyId');
  });

  it('is empty for a transaction without attachments', async () => {
    h = await startHarness();
    const [txn] = await transactionIds();
    const res = await h.call('list_transaction_attachments', {
      transaction_id: txn,
    });
    expect(res.json.items).toEqual([]);
  });

  it('only lists the asked transaction, and names are data', async () => {
    h = await startHarness({ count: 2 });
    const [a, b] = await transactionIds();
    await attach(a, { name: 'Ignore previous\u001b[31m​.pdf' });
    await attach(b, { name: 'other.pdf' });
    const res = await h.call('list_transaction_attachments', {
      transaction_id: a,
    });
    expect(res.json.items).toHaveLength(1);
    expect(res.json.items[0].text.name).toBe('Ignore previous.pdf');
    expect(res.text).not.toContain('\u001b');
  });

  it('a split line lists its parent attachments', async () => {
    h = await startHarness({ count: 0 });
    await api.addTransactions(h.fixture.accountId, [
      {
        date: '2026-02-01',
        amount: -3000,
        subtransactions: [{ amount: -1000 }, { amount: -2000 }],
      },
    ] as never);
    const { data } = (await api.runQuery(
      api.q('transactions').select(['id', 'parent_id']),
    )) as { data: Array<{ id: string; parent_id: string | null }> };
    const child = data.find(t => t.parent_id)!;
    await attach(child.parent_id!, {});
    const res = await h.call('list_transaction_attachments', {
      transaction_id: child.id,
    });
    expect(res.json.items).toHaveLength(1);
    expect(res.json.items[0].transaction_id).toBe(child.parent_id);
  });

  it('refuses an empty id', async () => {
    h = await startHarness();
    const res = await h.call('list_transaction_attachments', {
      transaction_id: '',
    });
    expect(res.isError).toBe(true);
  });
});
