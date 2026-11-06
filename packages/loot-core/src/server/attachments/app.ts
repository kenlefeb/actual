import { v4 as uuidv4 } from 'uuid';

import * as asyncStorage from '#platform/server/asyncStorage';
import { fetch } from '#platform/server/fetch';
import * as fs from '#platform/server/fs';
import { logger } from '#platform/server/log';
import { createApp } from '#server/app';
import * as db from '#server/db';
import * as encryption from '#server/encryption';
import { mutator, runMutator } from '#server/mutators';
import * as prefs from '#server/prefs';
import { getServer } from '#server/server-config';
import { undoable, withUndo } from '#server/undo';
import { detectAttachmentType } from '#shared/attachments';

// Documents attached to transactions (transaction-attachments spec). The
// document lives on the sync server, the metadata row in the budget. Nothing
// here assumes the document came from a file picker, so other intake paths
// (email, sc-2355) can store blobs the same way.

export type AttachmentAddError =
  | 'too-large'
  | 'unsupported-type'
  | 'heic'
  | 'quota'
  | 'needs-sync-server'
  | 'upload-failed';

export type AttachmentAddResult =
  | { attachment: db.DbTransactionAttachment }
  | { error: AttachmentAddError; limitMB?: number };

export type AttachmentOpenResult =
  | { name: string; mime: string; data: Uint8Array }
  | { error: 'not-found' | 'download-failed' | 'decrypt-failed' };

export type AttachmentsHandlers = {
  'transaction-attachment-add': typeof addAttachment;
  'transaction-attachment-open': typeof openAttachment;
  'transaction-attachment-remove': typeof removeAttachment;
};

export const app = createApp<AttachmentsHandlers>();
// Not a mutator: the upload can take a while, so only the row write below
// holds the mutation lock
app.method('transaction-attachment-add', addAttachment);
app.method('transaction-attachment-open', openAttachment);
app.method(
  'transaction-attachment-remove',
  mutator(undoable(removeAttachment)),
);

const MB = 1024 * 1024;
const DEFAULT_FILE_SIZE_LIMIT_MB = 10;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const SERVER_REFUSALS = new Set<AttachmentAddError>([
  'too-large',
  'unsupported-type',
  'heic',
  'quota',
]);

type Remote = {
  baseServer: string;
  syncServer: string;
  token: string;
  fileId: string;
};

async function getRemote(): Promise<Remote | null> {
  const server = getServer();
  const { cloudFileId } = prefs.getPrefs();
  if (!server || !cloudFileId) {
    return null;
  }
  return {
    baseServer: server.BASE_SERVER,
    syncServer: server.SYNC_SERVER,
    token: (await asyncStorage.getItem('user-token')) ?? '',
    fileId: cloudFileId,
  };
}

function attachmentRequest(
  remote: Remote,
  endpoint: string,
  id: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: Uint8Array;
  } = {},
) {
  return fetch(`${remote.syncServer}/${endpoint}`, {
    method: init.method ?? 'GET',
    headers: {
      'X-ACTUAL-TOKEN': remote.token,
      'X-ACTUAL-FILE-ID': remote.fileId,
      'X-ACTUAL-ATTACHMENT-ID': id,
      ...init.headers,
    },
    body: init.body as BodyInit | undefined,
  });
}

async function getFileSizeLimitMB(remote: Remote): Promise<number> {
  const res = await fetch(`${remote.baseServer}/info`);
  const info = (await res.json()) as {
    attachments?: { fileSizeLimitMB?: number };
  };
  return info.attachments?.fileSizeLimitMB ?? DEFAULT_FILE_SIZE_LIMIT_MB;
}

// Stores `body` under `id`, overwriting any document already there
export async function uploadAttachmentBlob(
  remote: Remote,
  id: string,
  body: Uint8Array,
  encrypted: boolean,
): Promise<{ error: AttachmentAddError; limitMB?: number } | null> {
  let res: Response;
  try {
    res = await attachmentRequest(remote, 'upload-attachment', id, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/actual-attachment',
        'X-ACTUAL-ATTACHMENT-ENCRYPTED': String(encrypted),
      },
      body,
    });
  } catch (e) {
    logger.warn('Attachment upload failed', e);
    return { error: 'upload-failed' };
  }
  if (res.ok) {
    return null;
  }
  const refusal = (await res.json().catch(() => null)) as {
    reason?: AttachmentAddError;
    limitMB?: number;
  } | null;
  const reason = refusal?.reason;
  if (reason && SERVER_REFUSALS.has(reason)) {
    return reason === 'too-large'
      ? { error: reason, limitMB: refusal?.limitMB }
      : { error: reason };
  }
  return { error: 'upload-failed' };
}

function cachePath(id: string) {
  if (!SAFE_ID.test(id)) {
    throw new Error('Invalid attachment id');
  }
  return fs.join(
    fs.getBudgetDir(prefs.getPrefs().id),
    'attachments',
    `${id}.blob`,
  );
}

async function readCache(id: string): Promise<Uint8Array | null> {
  const path = cachePath(id);
  if (!(await fs.exists(path))) {
    return null;
  }
  return new Uint8Array(await fs.readFile(path, 'binary'));
}

// Holds what the server holds (ciphertext for encrypted documents)
async function writeCache(id: string, stored: Uint8Array) {
  const dir = fs.join(fs.getBudgetDir(prefs.getPrefs().id), 'attachments');
  if (!(await fs.exists(dir))) {
    await fs.mkdir(dir);
  }
  // A copy that owns its buffer: the web fs stores `view.buffer` whole
  await fs.writeFile(cachePath(id), new Uint8Array(stored));
}

// The stored form: ciphertext and its meta when the budget has a key
async function seal(data: Uint8Array, keyId: string | null | undefined) {
  if (!keyId) {
    return { stored: data, encryptMeta: null };
  }
  const encrypted = await encryption.encrypt(Buffer.from(data), keyId);
  return {
    stored: new Uint8Array(encrypted.value),
    encryptMeta: JSON.stringify(encrypted.meta),
  };
}

async function unseal(stored: Uint8Array, encryptMeta: string | null) {
  if (encryptMeta == null) {
    return stored;
  }
  return new Uint8Array(
    await encryption.decrypt(Buffer.from(stored), JSON.parse(encryptMeta)),
  );
}

// The cached copy, else the server's (cached for next time). Throws when
// neither is available.
async function getStored(remote: Remote | null, id: string) {
  const cached = await readCache(id);
  if (cached) {
    return cached;
  }
  if (!remote) {
    throw new Error('No sync server');
  }
  const res = await attachmentRequest(remote, 'download-attachment', id);
  if (!res.ok) {
    throw new Error(`Attachment download failed: ${res.status}`);
  }
  const stored = new Uint8Array(await res.arrayBuffer());
  await writeCache(id, stored).catch(e =>
    logger.warn('Could not cache attachment', e),
  );
  return stored;
}

async function addAttachment({
  transactionId,
  name,
  data,
}: {
  transactionId: string;
  name: string;
  data: Uint8Array;
}): Promise<AttachmentAddResult> {
  const remote = await getRemote();
  if (!remote) {
    return { error: 'needs-sync-server' };
  }

  const mime = detectAttachmentType(data);
  if (mime === 'heic') {
    return { error: 'heic' };
  }
  if (mime === null) {
    return { error: 'unsupported-type' };
  }

  let limitMB: number;
  try {
    limitMB = await getFileSizeLimitMB(remote);
  } catch (e) {
    logger.warn('Could not read the attachment limit', e);
    return { error: 'upload-failed' };
  }
  if (data.length > limitMB * MB) {
    return { error: 'too-large', limitMB };
  }

  // A split's documents belong to its parent
  const transaction = await db.getTransaction(transactionId);
  const ownerId = transaction?.parent_id ?? transactionId;

  const { stored, encryptMeta } = await seal(
    data,
    prefs.getPrefs().encryptKeyId,
  );
  const id = uuidv4();

  const refused = await uploadAttachmentBlob(
    remote,
    id,
    stored,
    encryptMeta != null,
  );
  if (refused) {
    return refused;
  }

  const row: db.DbTransactionAttachment = {
    id,
    transaction_id: ownerId,
    name,
    mime,
    size: data.length,
    sha256: await sha256(data),
    encrypt_meta: encryptMeta,
    created_at: new Date().toISOString(),
    tombstone: 0,
  };
  try {
    await runMutator(() =>
      withUndo(() => db.insert('transaction_attachments', row)),
    );
  } catch (e) {
    logger.warn('Could not record the attachment; removing its upload', e);
    // If this fails too the blob is orphaned; server cleanup (sc-2525) removes it
    await attachmentRequest(remote, 'delete-attachment', id, {
      method: 'POST',
    }).catch(() => undefined);
    return { error: 'upload-failed' };
  }

  await writeCache(id, stored).catch(e =>
    logger.warn('Could not cache attachment', e),
  );
  return { attachment: row };
}

async function openAttachment({
  id,
}: {
  id: string;
}): Promise<AttachmentOpenResult> {
  const row = await db.first<db.DbTransactionAttachment>(
    'SELECT * FROM transaction_attachments WHERE id = ?',
    [id],
  );
  if (!row) {
    return { error: 'not-found' };
  }

  let stored: Uint8Array;
  try {
    stored = await getStored(await getRemote(), id);
  } catch (e) {
    logger.warn('Could not load attachment', e);
    return { error: 'download-failed' };
  }

  try {
    return {
      name: row.name,
      mime: row.mime,
      data: await unseal(stored, row.encrypt_meta),
    };
  } catch (e) {
    logger.warn('Could not decrypt attachment', e);
    return { error: 'decrypt-failed' };
  }
}

// The document stays on the server, so undo restores it
async function removeAttachment({ id }: { id: string }) {
  await db.delete_('transaction_attachments', id);
}

async function sha256(data: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(data));
  return Buffer.from(digest).toString('hex');
}

// Re-encrypts every encrypted attachment, removed ones included (undo can
// restore them), under `newKeyId` while the old key is still loaded. On any
// failure it puts back the documents it already moved and throws, so the
// caller can keep the old key.
export async function reencryptAttachments(newKeyId: string) {
  const rows = await db.all<db.DbTransactionAttachment>(
    'SELECT * FROM transaction_attachments WHERE encrypt_meta IS NOT NULL',
  );
  if (rows.length === 0) {
    return;
  }
  const remote = await getRemote();
  if (!remote) {
    throw new Error('attachment-reencrypt-failed');
  }

  const moved: Array<{ row: db.DbTransactionAttachment; old: Uint8Array }> = [];
  const setMeta = (id: string, encrypt_meta: string | null) =>
    runMutator(() =>
      db.update('transaction_attachments', { id, encrypt_meta }),
    );

  try {
    for (const row of rows) {
      const old = await getStored(remote, row.id);
      const { stored, encryptMeta } = await seal(
        await unseal(old, row.encrypt_meta),
        newKeyId,
      );
      const refused = await uploadAttachmentBlob(remote, row.id, stored, true);
      if (refused) {
        throw new Error(`Re-upload refused: ${refused.error}`);
      }
      moved.push({ row, old });
      await setMeta(row.id, encryptMeta);
      await writeCache(row.id, stored);
    }
  } catch (e) {
    logger.warn('Attachment re-encryption failed; restoring', e);
    // The old ciphertext still decrypts with the old meta, so putting both
    // back is the same as re-encrypting under the old key
    for (const { row, old } of moved) {
      await uploadAttachmentBlob(remote, row.id, old, true);
      await setMeta(row.id, row.encrypt_meta);
      await writeCache(row.id, old).catch(() => undefined);
    }
    throw new Error('attachment-reencrypt-failed');
  }
}
