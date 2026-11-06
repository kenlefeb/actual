import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { q } from '#shared/query';

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
});

describe('transaction_attachments table', () => {
  it('stores a row that AQL reads back, and hides removed rows', async () => {
    const row = {
      transaction_id: 'tx-1',
      mime: 'application/pdf',
      encrypt_meta: null,
      created_at: '2026-11-05T00:00:00.000Z',
    };
    await db.insert('transaction_attachments', {
      ...row,
      id: 'att-1',
      name: 'receipt.pdf',
      size: 200,
      sha256: 'abc',
    });
    await db.insert('transaction_attachments', {
      ...row,
      id: 'att-2',
      name: 'old.pdf',
      size: 10,
      sha256: 'def',
      tombstone: 1,
    });

    const { data } = await aqlQuery(
      q('transaction_attachments')
        .filter({ transaction_id: 'tx-1' })
        .select('*'),
    );
    expect(data).toEqual([
      {
        ...row,
        id: 'att-1',
        name: 'receipt.pdf',
        size: 200,
        sha256: 'abc',
        tombstone: false,
      },
    ]);
  });
});
