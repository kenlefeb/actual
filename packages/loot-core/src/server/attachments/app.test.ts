import * as nativeFs from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as asyncStorage from '#platform/server/asyncStorage';
import * as fs from '#platform/server/fs';
import { app } from '#server/attachments/app';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import * as encryption from '#server/encryption';
import * as prefs from '#server/prefs';
import { attachmentServer } from '#server/tests/mockAttachmentServer';
import { undo } from '#server/undo';

vi.mock('#platform/server/fetch', () => ({
  fetch: (url: string, init?: RequestInit) => attachmentServer.fetch(url, init),
}));

const PDF = new Uint8Array(Buffer.from('%PDF-1.7\nsynthetic receipt\n'));
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HEIC = new Uint8Array(
  Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic')]),
);
const MB = 1024 * 1024;

const add = app.handlers['transaction-attachment-add'];
const open = app.handlers['transaction-attachment-open'];
const remove = app.handlers['transaction-attachment-remove'];
const check = app.handlers['transaction-attachment-check'];
const addBatch = app.handlers['transaction-attachments-add-batch'];

function pdfOfSize(size: number) {
  const data = new Uint8Array(size);
  data.set(PDF);
  return data;
}

async function rows(transactionId: string) {
  return db.all<db.DbTransactionAttachment>(
    'SELECT * FROM transaction_attachments WHERE transaction_id = ? AND tombstone = 0 ORDER BY name',
    [transactionId],
  );
}

let transactionId: string;

beforeEach(async () => {
  attachmentServer.reset();
  await global.emptyDatabase()();
  await loadMappings();
  await prefs.loadPrefs();
  await prefs.savePrefs({ cloudFileId: 'cloud-file', groupId: 'group' });
  await asyncStorage.setItem('user-token', 'token');

  const documentDir = nativeFs.mkdtempSync(
    path.join(os.tmpdir(), 'actual-attachments-'),
  );
  fs._setDocumentDir(documentDir);
  nativeFs.mkdirSync(fs.getBudgetDir('test'));
  onTestFinished(() => {
    nativeFs.rmSync(documentDir, { recursive: true, force: true });
  });

  await db.insertAccount({ id: 'acct', name: 'Checking' });
  transactionId = await db.insertTransaction({
    account: 'acct',
    date: '2026-11-05',
    amount: -2500,
  });
});

afterEach(() => {
  encryption.unloadAllKeys();
});

async function useEncryptionKey(id = 'key-1') {
  const key = await encryption.createKey({
    id,
    password: 'test password',
    salt: 'test salt',
  });
  await encryption.loadKey(key);
  await prefs.savePrefs({ encryptKeyId: id });
}

describe('transaction-attachment-add', () => {
  it('Attach a PDF', async () => {
    const result = await add({
      transactionId,
      name: 'receipt.pdf',
      data: pdfOfSize(200 * 1024),
    });

    expect(result).toMatchObject({
      attachment: {
        transaction_id: transactionId,
        name: 'receipt.pdf',
        mime: 'application/pdf',
        size: 200 * 1024,
        encrypt_meta: null,
      },
    });
    expect(await rows(transactionId)).toHaveLength(1);
    expect(attachmentServer.blobs.size).toBe(1);
  });

  it('Attach a second document', async () => {
    await add({ transactionId, name: 'a-receipt.pdf', data: PDF });
    await add({ transactionId, name: 'b-photo.jpg', data: JPEG });

    expect((await rows(transactionId)).map(row => row.mime)).toEqual([
      'application/pdf',
      'image/jpeg',
    ]);
  });

  it('Upload fails', async () => {
    attachmentServer.refusal = { status: 500, body: { status: 'error' } };

    const result = await add({ transactionId, name: 'r.pdf', data: PDF });

    expect(result).toEqual({ error: 'upload-failed' });
    expect(await rows(transactionId)).toEqual([]);
  });

  it('Upload fails when the server does not answer', async () => {
    attachmentServer.offline = true;

    const result = await add({ transactionId, name: 'r.pdf', data: PDF });

    expect(result).toEqual({ error: 'upload-failed' });
    expect(await rows(transactionId)).toEqual([]);
  });

  it('rolls back the upload once when the row write fails', async () => {
    attachmentServer.onStored = () => {
      db.execQuery('DROP TABLE transaction_attachments');
    };

    const result = await add({ transactionId, name: 'r.pdf', data: PDF });

    expect(result).toEqual({ error: 'upload-failed' });
    expect(attachmentServer.deletes).toHaveLength(1);
    expect(attachmentServer.blobs.size).toBe(0);
  });

  it('Oversize file', async () => {
    const result = await add({
      transactionId,
      name: 'big.pdf',
      data: pdfOfSize(11 * MB),
    });

    expect(result).toEqual({ error: 'too-large', limitMB: 10 });
    expect(attachmentServer.uploads).toEqual([]);
  });

  it('Limit set by the server', async () => {
    attachmentServer.fileSizeLimitMB = 5;
    const data = new Uint8Array(6 * MB);
    data.set(PNG);

    const result = await add({ transactionId, name: 'photo.png', data });

    expect(result).toEqual({ error: 'too-large', limitMB: 5 });
  });

  it('Wrong type', async () => {
    const docx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 6, 0]);

    const result = await add({
      transactionId,
      name: 'invoice.docx',
      data: docx,
    });

    expect(result).toEqual({ error: 'unsupported-type' });
    expect(attachmentServer.uploads).toEqual([]);
  });

  it('Renamed file', async () => {
    const text = new Uint8Array(Buffer.from('Thanks for shopping'));

    const result = await add({
      transactionId,
      name: 'receipt.pdf',
      data: text,
    });

    expect(result).toEqual({ error: 'unsupported-type' });
  });

  it('HEIC photo', async () => {
    const result = await add({ transactionId, name: 'IMG_1.heic', data: HEIC });

    expect(result).toEqual({ error: 'heic' });
  });

  it('reports a full budget', async () => {
    attachmentServer.refusal = {
      status: 413,
      body: { status: 'error', reason: 'quota' },
    };

    const result = await add({ transactionId, name: 'r.pdf', data: PDF });

    expect(result).toEqual({ error: 'quota' });
    expect(await rows(transactionId)).toEqual([]);
  });

  it('Local-only budget', async () => {
    await prefs.savePrefs({ cloudFileId: undefined, groupId: undefined });

    const result = await add({ transactionId, name: 'r.pdf', data: PDF });

    expect(result).toEqual({ error: 'needs-sync-server' });
    expect(attachmentServer.uploads).toEqual([]);
  });

  it('Attach from a split line', async () => {
    const parent = await db.insertTransaction({
      account: 'acct',
      date: '2026-11-05',
      amount: -3000,
      is_parent: true,
    });
    const child = await db.insertTransaction({
      account: 'acct',
      date: '2026-11-05',
      amount: -3000,
      is_child: true,
      parent_id: parent,
    });

    await add({ transactionId: child, name: 'r.pdf', data: PDF });

    expect(await rows(parent)).toHaveLength(1);
    expect(await rows(child)).toEqual([]);
  });
});

describe('encryption', () => {
  it('Encrypted budget', async () => {
    await useEncryptionKey();

    const result = await add({ transactionId, name: 'r.pdf', data: PDF });
    if (!('attachment' in result)) throw new Error('not attached');
    const stored = attachmentServer.blobs.get(result.attachment.id);

    expect(attachmentServer.uploads[0].encrypted).toBe(true);
    expect(JSON.parse(result.attachment.encrypt_meta ?? '')).toMatchObject({
      keyId: 'key-1',
    });
    expect(Buffer.from(stored ?? []).equals(Buffer.from(PDF))).toBe(false);
    expect(await open({ id: result.attachment.id })).toEqual({
      name: 'r.pdf',
      mime: 'application/pdf',
      data: PDF,
    });
  });

  it('Unencrypted budget', async () => {
    const result = await add({ transactionId, name: 'r.pdf', data: PDF });
    if (!('attachment' in result)) throw new Error('not attached');

    expect(result.attachment.encrypt_meta).toBe(null);
    expect(attachmentServer.uploads[0].encrypted).toBe(false);
    expect(await open({ id: result.attachment.id })).toMatchObject({
      data: PDF,
    });
  });

  it('Unencrypted attachment in an encrypted budget', async () => {
    await useEncryptionKey();
    // As the server adds it for email intake: a plain blob and a row
    // marked unencrypted
    attachmentServer.blobs.set('server-added', PDF);
    await db.insert('transaction_attachments', {
      id: 'server-added',
      transaction_id: transactionId,
      name: 'emailed.pdf',
      mime: 'application/pdf',
      size: PDF.length,
      sha256: '',
      encrypt_meta: null,
      created_at: '2026-11-05T00:00:00.000Z',
    });

    expect(await open({ id: 'server-added' })).toEqual({
      name: 'emailed.pdf',
      mime: 'application/pdf',
      data: PDF,
    });
  });
});

describe('transaction-attachment-open', () => {
  it('Open a PDF returns the same bytes that were attached', async () => {
    const result = await add({ transactionId, name: 'r.pdf', data: PDF });
    if (!('attachment' in result)) throw new Error('not attached');

    expect(await open({ id: result.attachment.id })).toEqual({
      name: 'r.pdf',
      mime: 'application/pdf',
      data: PDF,
    });
  });

  it('Opened before, now offline', async () => {
    // Attached on another device, so this device has no cached copy yet
    await useEncryptionKey();
    const encrypted = await encryption.encrypt(Buffer.from(PDF), 'key-1');
    attachmentServer.blobs.set('other-device', new Uint8Array(encrypted.value));
    await db.insert('transaction_attachments', {
      id: 'other-device',
      transaction_id: transactionId,
      name: 'r.pdf',
      mime: 'application/pdf',
      size: PDF.length,
      sha256: '',
      encrypt_meta: JSON.stringify(encrypted.meta),
      created_at: '2026-11-05T00:00:00.000Z',
    });
    await open({ id: 'other-device' });

    attachmentServer.offline = true;

    expect(await open({ id: 'other-device' })).toMatchObject({ data: PDF });
  });

  it('Never opened, offline', async () => {
    attachmentServer.blobs.set('remote', PDF);
    await db.insert('transaction_attachments', {
      id: 'remote',
      transaction_id: transactionId,
      name: 'r.pdf',
      mime: 'application/pdf',
      size: PDF.length,
      sha256: '',
      encrypt_meta: null,
      created_at: '2026-11-05T00:00:00.000Z',
    });
    attachmentServer.offline = true;

    expect(await open({ id: 'remote' })).toEqual({ error: 'download-failed' });
  });

  async function insertSyncedRow(id: string, mime: string, data: Uint8Array) {
    attachmentServer.blobs.set(id, data);
    await db.insert('transaction_attachments', {
      id,
      transaction_id: transactionId,
      name: 'synced',
      mime,
      size: data.length,
      sha256: '',
      encrypt_meta: null,
      created_at: '2026-11-05T00:00:00.000Z',
    });
  }

  it('refuses a synced row whose bytes are HTML, whatever its mime says', async () => {
    const html = new Uint8Array(Buffer.from('<html><script>1</script>'));
    await insertSyncedRow('html-as-html', 'text/html', html);
    await insertSyncedRow('html-as-pdf', 'application/pdf', html);

    expect(await open({ id: 'html-as-html' })).toEqual({
      error: 'unsupported-type',
    });
    expect(await open({ id: 'html-as-pdf' })).toEqual({
      error: 'unsupported-type',
    });
  });

  it('opens with the type the bytes show, not the synced mime', async () => {
    await insertSyncedRow('png-as-html', 'text/html', PNG);

    expect(await open({ id: 'png-as-html' })).toMatchObject({
      mime: 'image/png',
      data: PNG,
    });
  });
});

describe('transaction-attachment-remove', () => {
  it('Remove', async () => {
    const result = await add({ transactionId, name: 'r.pdf', data: PDF });
    if (!('attachment' in result)) throw new Error('not attached');

    await remove({ id: result.attachment.id });

    expect(await rows(transactionId)).toEqual([]);
    expect(attachmentServer.blobs.has(result.attachment.id)).toBe(true);
    expect(attachmentServer.deletes).toEqual([]);
  });

  it('Undo a removal', async () => {
    const result = await add({ transactionId, name: 'r.pdf', data: PDF });
    if (!('attachment' in result)) throw new Error('not attached');

    await remove({ id: result.attachment.id });
    await undo();

    expect(await rows(transactionId)).toHaveLength(1);
    expect(await open({ id: result.attachment.id })).toMatchObject({
      data: PDF,
    });
  });
});

describe('transaction-attachment-check', () => {
  async function expectNothingStored() {
    expect(attachmentServer.uploads).toEqual([]);
    expect(attachmentServer.blobs.size).toBe(0);
    expect(await rows(transactionId)).toEqual([]);
  }

  it('passes a PDF without uploading it or writing a row', async () => {
    expect(await check({ data: pdfOfSize(200 * 1024) })).toEqual({ ok: true });
    await expectNothingStored();
  });

  it('Wrong type', async () => {
    const docx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 6, 0]);
    expect(await check({ data: docx })).toEqual({ error: 'unsupported-type' });
    await expectNothingStored();
  });

  it('Renamed file', async () => {
    const text = new Uint8Array(Buffer.from('Thanks for shopping'));
    expect(await check({ data: text })).toEqual({ error: 'unsupported-type' });
  });

  it('Oversize file', async () => {
    expect(await check({ data: pdfOfSize(11 * MB) })).toEqual({
      error: 'too-large',
      limitMB: 10,
    });
    await expectNothingStored();
  });

  it('Limit set by the server', async () => {
    attachmentServer.fileSizeLimitMB = 5;
    const data = new Uint8Array(6 * MB);
    data.set(PNG);
    expect(await check({ data })).toEqual({ error: 'too-large', limitMB: 5 });
  });

  it('HEIC photo', async () => {
    expect(await check({ data: HEIC })).toEqual({ error: 'heic' });
  });

  it('Local-only budget while adding', async () => {
    await prefs.savePrefs({ cloudFileId: undefined, groupId: undefined });
    expect(await check({ data: PDF })).toEqual({ error: 'needs-sync-server' });
  });

  it('Offline pick', async () => {
    attachmentServer.offline = true;
    expect(await check({ data: PDF })).toEqual({ error: 'upload-failed' });
  });
});

describe('transaction-attachments-add-batch', () => {
  const files = [
    { name: 'a-receipt.pdf', data: PDF },
    { name: 'b-photo.jpg', data: JPEG },
  ];

  it('Undo after adding with two documents', async () => {
    const result = await addBatch({ transactionId, files });

    expect(result.attachments).toHaveLength(2);
    expect(result.failed).toEqual([]);
    expect(await rows(transactionId)).toHaveLength(2);

    await undo();

    expect(await rows(transactionId)).toEqual([]);
  });

  it('One document fails', async () => {
    attachmentServer.refuseUploadNumber = 1;

    const result = await addBatch({ transactionId, files });

    expect(result.failed).toEqual([
      { name: 'a-receipt.pdf', error: 'upload-failed' },
    ]);
    expect((await rows(transactionId)).map(row => row.name)).toEqual([
      'b-photo.jpg',
    ]);
  });

  it('attaches to the parent when given a split line', async () => {
    const parent = await db.insertTransaction({
      account: 'acct',
      date: '2026-11-05',
      amount: -3000,
      is_parent: true,
    });
    const child = await db.insertTransaction({
      account: 'acct',
      date: '2026-11-05',
      amount: -3000,
      is_child: true,
      parent_id: parent,
    });

    await addBatch({ transactionId: child, files });

    expect(await rows(parent)).toHaveLength(2);
    expect(await rows(child)).toEqual([]);
  });

  it('inserts nothing for an empty batch', async () => {
    expect(await addBatch({ transactionId, files: [] })).toEqual({
      attachments: [],
      failed: [],
    });
    expect(attachmentServer.uploads).toEqual([]);
  });

  it('removes the uploads and reports every file when the row write fails', async () => {
    attachmentServer.onStored = () => {
      db.execQuery('DROP TABLE IF EXISTS transaction_attachments');
    };

    const result = await addBatch({ transactionId, files });

    expect(result.attachments).toEqual([]);
    expect(result.failed.map(f => f.name)).toEqual([
      'a-receipt.pdf',
      'b-photo.jpg',
    ]);
    expect(attachmentServer.blobs.size).toBe(0);
  });
});
