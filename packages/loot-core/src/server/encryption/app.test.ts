import * as nativeFs from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as asyncStorage from '#platform/server/asyncStorage';
import * as fs from '#platform/server/fs';
import { logger } from '#platform/server/log';
import { app as attachmentsApp } from '#server/attachments/app';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import * as encryption from '#server/encryption';
import { app } from '#server/encryption/app';
import * as prefs from '#server/prefs';
import { resetSync } from '#server/sync';
import type * as SyncModule from '#server/sync';
import { attachmentServer } from '#server/tests/mockAttachmentServer';

vi.mock('#platform/server/fetch', () => ({
  fetch: (url: string, init?: RequestInit) => attachmentServer.fetch(url, init),
}));

vi.mock('#server/sync', async importOriginal => ({
  ...(await importOriginal<typeof SyncModule>()),
  resetSync: vi.fn(async () => ({})),
}));

const PDF = new Uint8Array(Buffer.from('%PDF-1.7\nsynthetic receipt\n'));
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const OLD_KEY = 'old-key';

const addAttachment = attachmentsApp.handlers['transaction-attachment-add'];
const openAttachment = attachmentsApp.handlers['transaction-attachment-open'];

let documentDir: string;

function clearAttachmentCache() {
  nativeFs.rmSync(path.join(fs.getBudgetDir('test'), 'attachments'), {
    recursive: true,
    force: true,
  });
}

async function attachmentRows() {
  return db.all<db.DbTransactionAttachment>(
    'SELECT * FROM transaction_attachments ORDER BY name',
  );
}

async function attach(name: string, data: Uint8Array) {
  const result = await addAttachment({ transactionId: 'tx', name, data });
  if (!('attachment' in result)) {
    throw new Error(`not attached: ${result.error}`);
  }
  return result.attachment.id;
}

beforeEach(async () => {
  vi.mocked(resetSync).mockClear();
  attachmentServer.reset();
  await global.emptyDatabase()();
  await loadMappings();
  await prefs.loadPrefs();
  await prefs.savePrefs({ cloudFileId: 'cloud-file', groupId: 'group' });
  await asyncStorage.setItem('user-token', 'token');

  documentDir = nativeFs.mkdtempSync(path.join(os.tmpdir(), 'actual-key-'));
  fs._setDocumentDir(documentDir);
  nativeFs.mkdirSync(fs.getBudgetDir('test'));

  const key = await encryption.createKey({
    id: OLD_KEY,
    password: 'old password',
    salt: 'old salt',
  });
  await encryption.loadKey(key);
  await prefs.savePrefs({ encryptKeyId: OLD_KEY });

  await db.insertAccount({ id: 'acct', name: 'Checking' });
  await db.insertTransaction({
    id: 'tx',
    account: 'acct',
    date: '2026-11-05',
    amount: -2500,
  });
});

afterEach(() => {
  encryption.unloadAllKeys();
  nativeFs.rmSync(documentDir, { recursive: true, force: true });
});

describe('key-make with attachments', () => {
  it('New key keeps documents readable', async () => {
    const pdfId = await attach('a-receipt.pdf', PDF);
    // A server-added attachment, marked unencrypted
    attachmentServer.blobs.set('plain', PNG);
    await db.insert('transaction_attachments', {
      id: 'plain',
      transaction_id: 'tx',
      name: 'b-emailed.png',
      mime: 'image/png',
      size: PNG.length,
      sha256: '',
      encrypt_meta: null,
      created_at: '2026-11-05T00:00:00.000Z',
    });
    attachmentServer.uploads = [];

    const result = await app.handlers['key-make']({ password: 'new' });

    expect(result).toEqual({});
    expect(resetSync).toHaveBeenCalledOnce();
    const newKeyId = vi.mocked(resetSync).mock.calls[0][0].key.getId();
    expect(newKeyId).not.toBe(OLD_KEY);

    // Re-uploaded in place under the same id; the plain one untouched
    expect(attachmentServer.uploads).toEqual([{ id: pdfId, encrypted: true }]);
    const [pdfRow, plainRow] = await attachmentRows();
    expect(JSON.parse(pdfRow.encrypt_meta ?? '').keyId).toBe(newKeyId);
    expect(plainRow.encrypt_meta).toBe(null);

    // This device
    expect(await openAttachment({ id: pdfId })).toMatchObject({ data: PDF });

    // Another device, signed in with the new key only and no cached copy
    encryption.unloadKey(encryption.getKey(OLD_KEY));
    clearAttachmentCache();
    expect(await openAttachment({ id: pdfId })).toMatchObject({ data: PDF });
    expect(await openAttachment({ id: 'plain' })).toMatchObject({ data: PNG });
  });

  it('re-encrypts removed attachments too, so undo can restore them', async () => {
    const id = await attach('receipt.pdf', PDF);
    await db.delete_('transaction_attachments', id);

    await app.handlers['key-make']({ password: 'new' });

    const newKeyId = vi.mocked(resetSync).mock.calls[0][0].key.getId();
    const [row] = await attachmentRows();
    expect(JSON.parse(row.encrypt_meta ?? '').keyId).toBe(newKeyId);
  });

  it('skips an attachment whose document is gone from the server', async () => {
    const gone = await attach('a-receipt.pdf', PDF);
    const kept = await attach('b-receipt.pdf', PDF);
    attachmentServer.blobs.delete(gone);
    clearAttachmentCache();
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const result = await app.handlers['key-make']({ password: 'new' });

    expect(result).toEqual({});
    expect(resetSync).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(gone));
    const newKeyId = vi.mocked(resetSync).mock.calls[0][0].key.getId();
    const keptRow = (await attachmentRows()).find(row => row.id === kept);
    expect(JSON.parse(keptRow?.encrypt_meta ?? '').keyId).toBe(newKeyId);
    expect(await openAttachment({ id: kept })).toMatchObject({ data: PDF });
  });

  it('Re-encryption fails', async () => {
    const first = await attach('a-receipt.pdf', PDF);
    const second = await attach('b-receipt.pdf', PDF);
    attachmentServer.uploads = [];
    attachmentServer.refuseUploadNumber = 2;

    const result = await app.handlers['key-make']({ password: 'new' });

    expect(result).toEqual({
      error: { reason: 'attachment-reencrypt-failed' },
    });
    expect(resetSync).not.toHaveBeenCalled();
    expect(prefs.getPrefs().encryptKeyId).toBe(OLD_KEY);
    for (const row of await attachmentRows()) {
      expect(JSON.parse(row.encrypt_meta ?? '').keyId).toBe(OLD_KEY);
    }

    // Both open with the old key, from the server as well as the cache
    clearAttachmentCache();
    expect(await openAttachment({ id: first })).toMatchObject({ data: PDF });
    expect(await openAttachment({ id: second })).toMatchObject({ data: PDF });
  });

  it('rolls attachments back when the sync reset fails before the new key is saved', async () => {
    const first = await attach('a-receipt.pdf', PDF);
    const second = await attach('b-receipt.pdf', PDF);
    vi.mocked(resetSync).mockResolvedValueOnce({
      error: { reason: 'network-failure' },
    });

    const result = await app.handlers['key-make']({ password: 'new' });

    expect(result).toEqual({ error: { reason: 'network-failure' } });
    expect(prefs.getPrefs().encryptKeyId).toBe(OLD_KEY);
    for (const row of await attachmentRows()) {
      expect(JSON.parse(row.encrypt_meta ?? '').keyId).toBe(OLD_KEY);
    }
    // Readable with the old key alone, from the server
    const newKeyId = vi.mocked(resetSync).mock.calls[0][0].key.getId();
    encryption.unloadKey(encryption.getKey(newKeyId));
    clearAttachmentCache();
    expect(await openAttachment({ id: first })).toMatchObject({ data: PDF });
    expect(await openAttachment({ id: second })).toMatchObject({ data: PDF });
  });

  it('keeps attachments on the new key when the reset fails after saving it', async () => {
    const id = await attach('receipt.pdf', PDF);
    vi.mocked(resetSync).mockImplementationOnce(async keyState => {
      await prefs.savePrefs({ encryptKeyId: keyState?.key.getId() });
      return { error: { reason: 'upload-failure' } };
    });

    await app.handlers['key-make']({ password: 'new' });

    const newKeyId = vi.mocked(resetSync).mock.calls[0][0].key.getId();
    const [row] = await attachmentRows();
    expect(JSON.parse(row.encrypt_meta ?? '').keyId).toBe(newKeyId);
    encryption.unloadKey(encryption.getKey(OLD_KEY));
    clearAttachmentCache();
    expect(await openAttachment({ id })).toMatchObject({ data: PDF });
  });

  it('restores an upload the server stored but never acknowledged', async () => {
    const first = await attach('a-receipt.pdf', PDF);
    const second = await attach('b-receipt.pdf', PDF);
    attachmentServer.uploads = [];
    // The second re-upload is stored, then its response is lost
    attachmentServer.onStored = () => {
      if (attachmentServer.uploads.length === 2) {
        throw new TypeError('Connection reset');
      }
    };

    const result = await app.handlers['key-make']({ password: 'new' });

    expect(result).toEqual({
      error: { reason: 'attachment-reencrypt-failed' },
    });
    for (const row of await attachmentRows()) {
      expect(JSON.parse(row.encrypt_meta ?? '').keyId).toBe(OLD_KEY);
    }
    // The old meta decrypts what the server holds
    clearAttachmentCache();
    expect(await openAttachment({ id: first })).toMatchObject({ data: PDF });
    expect(await openAttachment({ id: second })).toMatchObject({ data: PDF });
  });

  it('reports a failed restore and never leaves meta that mismatches the server', async () => {
    const first = await attach('a-receipt.pdf', PDF);
    const second = await attach('b-receipt.pdf', PDF);
    attachmentServer.uploads = [];
    // The first re-upload works; the server then refuses everything,
    // including the restore of the first
    attachmentServer.refuseUploadsFrom = 2;

    const result = await app.handlers['key-make']({ password: 'new' });

    expect(result).toEqual({
      error: { reason: 'attachment-restore-failed' },
    });
    expect(resetSync).not.toHaveBeenCalled();
    expect(prefs.getPrefs().encryptKeyId).toBe(OLD_KEY);
    // Each row's meta decrypts what the server holds
    clearAttachmentCache();
    expect(await openAttachment({ id: first })).toMatchObject({ data: PDF });
    expect(await openAttachment({ id: second })).toMatchObject({ data: PDF });
  });
});
