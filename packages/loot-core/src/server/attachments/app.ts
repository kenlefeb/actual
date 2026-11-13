import { v4 as uuidv4 } from 'uuid';

import * as asyncStorage from '#platform/server/asyncStorage';
import { fetch } from '#platform/server/fetch';
import * as fs from '#platform/server/fs';
import { logger } from '#platform/server/log';
import { createApp } from '#server/app';
import * as cloudStorage from '#server/cloud-storage';
import * as db from '#server/db';
import * as encryption from '#server/encryption';
import { mutator, runMutator } from '#server/mutators';
import * as prefs from '#server/prefs';
import { getServer } from '#server/server-config';
import { batchMessages } from '#server/sync';
import { undoable, withUndo } from '#server/undo';
import { detectAttachmentType } from '#shared/attachments';
import type { ServerEvents } from '#types/server-events';

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

export type AttachmentCheckResult =
  | { ok: true }
  | { error: AttachmentAddError; limitMB?: number };

export type AttachmentBatchResult = {
  attachments: db.DbTransactionAttachment[];
  failed: Array<{ name: string; error: AttachmentAddError; limitMB?: number }>;
  error?: 'too-many-files';
};

// Most documents one batch may hold (the add form's cap)
const MAX_BATCH_FILES = 5;

export type AttachmentOpenResult =
  | { name: string; mime: string; data: Uint8Array }
  | {
      error:
        | 'not-found'
        | 'download-failed'
        | 'decrypt-failed'
        | 'unsupported-type';
    };

export type AttachmentsHandlers = {
  'transaction-attachment-add': typeof addAttachment;
  'transaction-attachment-check': typeof checkAttachment;
  'transaction-attachments-add-batch': typeof addAttachmentsBatch;
  'transaction-attachment-open': typeof openAttachment;
  'transaction-attachment-remove': typeof removeAttachment;
};

export const app = createApp<AttachmentsHandlers>();
// Not a mutator: the upload can take a while, so only the row write below
// holds the mutation lock
app.method('transaction-attachment-add', addAttachment);
app.method('transaction-attachment-check', checkAttachment);
app.method('transaction-attachments-add-batch', addAttachmentsBatch);
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
async function uploadAttachmentBlob(
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

// Downloads the stored form and caches it. `notFound` is set only when the
// sync server itself says the document isn't there, not for any 404 (a proxy,
// or a server without the endpoint).
async function download(remote: Remote | null, id: string) {
  if (!remote) {
    throw new Error('No sync server');
  }
  const res = await attachmentRequest(remote, 'download-attachment', id);
  if (!res.ok) {
    const notFound =
      res.status === 404 && (await res.text()) === 'attachment-not-found';
    throw Object.assign(
      new Error(`Attachment download failed: ${res.status}`),
      { notFound },
    );
  }
  const stored = new Uint8Array(await res.arrayBuffer());
  await writeCache(id, stored).catch(e =>
    logger.warn('Could not cache attachment', e),
  );
  return stored;
}

// The document's stored and plain forms: the cached copy, else the server's.
// A cached copy that no longer decrypts (another device changed the key) is
// dropped and the document downloaded once.
async function load(
  remote: Remote | null,
  id: string,
  encryptMeta: string | null,
) {
  const cached = await readCache(id);
  if (cached) {
    try {
      return { stored: cached, data: await unseal(cached, encryptMeta) };
    } catch (e) {
      logger.warn('Cached attachment does not decrypt; downloading', e);
    }
  }
  let stored: Uint8Array;
  try {
    stored = await download(remote, id);
  } catch (cause) {
    return { error: 'download-failed' as const, cause };
  }
  try {
    return { stored, data: await unseal(stored, encryptMeta) };
  } catch (cause) {
    return { error: 'decrypt-failed' as const, cause };
  }
}

// The checks every document passes before it is stored: sync server, type
// by bytes, then the server's size limit (which needs /info, so offline this
// reports 'upload-failed'). Shared by the check and both add handlers.
async function validateAttachment(
  remote: Remote | null,
  data: Uint8Array,
  getLimitMB: () => Promise<number> = () =>
    remote ? getFileSizeLimitMB(remote) : Promise.resolve(0),
): Promise<
  | { remote: Remote; mime: string }
  | { error: AttachmentAddError; limitMB?: number }
> {
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
    limitMB = await getLimitMB();
  } catch (e) {
    logger.warn('Could not read the attachment limit', e);
    return { error: 'upload-failed' };
  }
  if (data.length > limitMB * MB) {
    return { error: 'too-large', limitMB };
  }
  return { remote, mime };
}

// Validate only: encrypts and uploads nothing, writes no row
async function checkAttachment({
  data,
}: {
  data: Uint8Array;
}): Promise<AttachmentCheckResult> {
  const checked = await validateAttachment(await getRemote(), data);
  return 'error' in checked ? checked : { ok: true };
}

type StoredAttachment = {
  row: db.DbTransactionAttachment;
  stored: Uint8Array;
};

// Validates, encrypts and uploads one document. The row is not written yet.
async function uploadAttachment(
  remote: Remote | null,
  ownerId: string,
  name: string,
  data: Uint8Array,
  getLimitMB?: () => Promise<number>,
): Promise<StoredAttachment | { error: AttachmentAddError; limitMB?: number }> {
  const checked = await validateAttachment(remote, data, getLimitMB);
  if ('error' in checked) {
    return checked;
  }

  const { stored, encryptMeta } = await seal(
    data,
    prefs.getPrefs().encryptKeyId,
  );
  const id = uuidv4();
  const hash = await sha256(data);

  const refused = await uploadAttachmentBlob(
    checked.remote,
    id,
    stored,
    encryptMeta != null,
  );
  if (refused) {
    return refused;
  }

  return {
    stored,
    row: {
      id,
      transaction_id: ownerId,
      name,
      mime: checked.mime,
      size: data.length,
      sha256: hash,
      encrypt_meta: encryptMeta,
      created_at: new Date().toISOString(),
      tombstone: 0,
    },
  };
}

// A split's documents belong to its parent
async function getOwnerId(transactionId: string) {
  const transaction = await db.getTransaction(transactionId);
  return transaction?.parent_id ?? transactionId;
}

// Inserts the rows in one undo step. If that fails the uploads are removed
// and false is returned.
async function insertAttachmentRows(
  remote: Remote,
  uploaded: StoredAttachment[],
): Promise<boolean> {
  try {
    // batchMessages applies every row in one database transaction, so a
    // failing row leaves none of them behind
    await runMutator(() =>
      withUndo(() =>
        batchMessages(async () => {
          for (const { row } of uploaded) {
            await db.insert('transaction_attachments', row);
          }
        }),
      ),
    );
  } catch (e) {
    logger.warn('Could not record the attachment; removing its upload', e);
    await removeUploads(remote, uploaded);
    return false;
  }

  // One at a time: the first write creates the cache directory
  for (const { row, stored } of uploaded) {
    await writeCache(row.id, stored).catch(e =>
      logger.warn('Could not cache attachment', e),
    );
  }
  return true;
}

// If a delete fails too the blob is orphaned; server cleanup (sc-2525) removes it
async function removeUploads(remote: Remote, uploaded: StoredAttachment[]) {
  await Promise.all(
    uploaded.map(({ row }) =>
      attachmentRequest(remote, 'delete-attachment', row.id, {
        method: 'POST',
      }).catch(() => undefined),
    ),
  );
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
  const uploaded = await uploadAttachment(
    remote,
    await getOwnerId(transactionId),
    name,
    data,
  );
  if ('error' in uploaded) {
    return uploaded;
  }
  if (!remote || !(await insertAttachmentRows(remote, [uploaded]))) {
    return { error: 'upload-failed' };
  }
  return { attachment: uploaded.row };
}

// Uploads each document in turn and records all the rows in one undo step. A
// document that fails is left out and reported; the others are still added.
async function addAttachmentsBatch({
  transactionId,
  files,
}: {
  transactionId: string;
  files: Array<{ name: string; data: Uint8Array }>;
}): Promise<AttachmentBatchResult> {
  const result: AttachmentBatchResult = { attachments: [], failed: [] };
  if (files.length > MAX_BATCH_FILES) {
    return { ...result, error: 'too-many-files' };
  }
  const remote = await getRemote();
  const uploaded: StoredAttachment[] = [];

  // One /info read per batch, and only if a file needs it
  let limit: Promise<number> | undefined;
  const getLimitMB = () =>
    (limit ??= remote ? getFileSizeLimitMB(remote) : Promise.resolve(0));

  try {
    const ownerId = await getOwnerId(transactionId);
    for (const { name, data } of files) {
      const one = await uploadAttachment(
        remote,
        ownerId,
        name,
        data,
        getLimitMB,
      );
      if ('error' in one) {
        result.failed.push({ name, ...one });
      } else {
        uploaded.push(one);
      }
    }
    if (!remote || uploaded.length === 0) {
      return result;
    }
    if (await insertAttachmentRows(remote, uploaded)) {
      result.attachments = uploaded.map(({ row }) => row);
      return result;
    }
  } catch (e) {
    logger.warn('Attachment batch failed; removing its uploads', e);
    if (remote) {
      await removeUploads(remote, uploaded);
    }
  }
  // Nothing was recorded: every file is reported, none stays on the server
  return {
    attachments: [],
    failed: files.map(({ name }) => ({
      name,
      error: 'upload-failed' as const,
    })),
  };
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

  const loaded = await load(await getRemote(), id, row.encrypt_meta);
  if (loaded.error) {
    logger.warn('Could not load attachment', loaded.cause);
    return { error: loaded.error };
  }
  const { data } = loaded;

  // The synced mime is untrusted: the opened blob gets the app's origin, so
  // only a type the bytes prove can be opened (never HTML)
  const mime = detectAttachmentType(data);
  if (mime === null || mime === 'heic') {
    return { error: 'unsupported-type' };
  }
  return { name: row.name, mime, data };
}

// The document stays on the server, so undo restores it
async function removeAttachment({ id }: { id: string }) {
  await db.delete_('transaction_attachments', id);
}

// Reporting removed documents (sc-2525). The server can't read a tombstone, so
// the device tells it which documents are removed, and which recorded ones are
// live again, so it can delete the orphaned ones after a retention period.
const REPORT_BATCH = 1000;

// Budgets that need a report: one is queued by an attachment change and by a
// failed report, and a budget's first sync of the session adds it too
const needsReport = new Set<string>();
const seenThisSession = new Set<string>();

// The ids the server holds removal records for, or null if it can't say
// (an older server answers 404)
async function fetchRecordedIds(remote: Remote): Promise<Set<string> | null> {
  const recorded = new Set<string>();
  let after: string | null = null;
  do {
    const res: Response = await fetch(
      `${remote.syncServer}/attachment-records${
        after == null ? '' : `?after=${encodeURIComponent(after)}`
      }`,
      {
        headers: {
          'X-ACTUAL-TOKEN': remote.token,
          'X-ACTUAL-FILE-ID': remote.fileId,
        },
      },
    );
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as {
      data?: { ids?: string[]; after?: string | null };
    };
    const page = body.data;
    if (!page || !Array.isArray(page.ids)) {
      return null;
    }
    for (const id of page.ids) {
      recorded.add(id);
    }
    // A cursor that doesn't move would page forever
    after = page.after && page.after !== after ? page.after : null;
  } while (after != null);
  return recorded;
}

async function postReport(remote: Remote, removed: string[], live: string[]) {
  for (
    let i = 0;
    i < Math.max(removed.length, live.length);
    i += REPORT_BATCH
  ) {
    const res = await fetch(`${remote.syncServer}/report-attachments`, {
      method: 'POST',
      headers: {
        'X-ACTUAL-TOKEN': remote.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileId: remote.fileId,
        removed: removed.slice(i, i + REPORT_BATCH),
        live: live.slice(i, i + REPORT_BATCH),
      }),
    });
    if (!res.ok) {
      return false;
    }
  }
  return true;
}

// Never throws; false means the report didn't go out
async function reportAttachments(remote: Remote): Promise<boolean> {
  try {
    const recorded = await fetchRecordedIds(remote);
    if (!recorded) {
      return false;
    }
    const rows = await db.all<{ id: string; tombstone: number }>(
      'SELECT id, tombstone FROM transaction_attachments',
    );
    const live = rows.filter(r => !r.tombstone && recorded.has(r.id));
    const removed = rows.filter(r => r.tombstone && !recorded.has(r.id));
    return await postReport(
      remote,
      removed.map(r => r.id),
      live.map(r => r.id),
    );
  } catch (e) {
    logger.warn('Could not report attachments', e);
    return false;
  }
}

async function reportIfNeeded({ force }: { force: boolean }) {
  const remote = await getRemote();
  if (!remote) {
    return;
  }
  const { fileId } = remote;
  if (!force && seenThisSession.has(fileId) && !needsReport.has(fileId)) {
    return;
  }
  seenThisSession.add(fileId);
  needsReport.delete(fileId);
  if (!(await reportAttachments(remote))) {
    // Sent again after the next sync
    needsReport.add(fileId);
  }
}

// Exported for tests; the app wires it to sync events below
export async function onSyncEvent(event: ServerEvents['sync-event']) {
  try {
    if (
      event.type === 'applied' &&
      event.tables.includes('transaction_attachments')
    ) {
      const { cloudFileId } = prefs.getPrefs() ?? {};
      if (cloudFileId) {
        needsReport.add(cloudFileId);
      }
    } else if (event.type === 'success' && prefs.getPrefs()) {
      await reportIfNeeded({ force: false });
    }
  } catch (e) {
    logger.warn('Could not report attachments', e);
  }
}

app.events.on('sync', event => {
  void onSyncEvent(event);
});

cloudStorage.onUpload(async () => {
  try {
    await reportIfNeeded({ force: true });
  } catch (e) {
    logger.warn('Could not report attachments', e);
  }
});

async function sha256(data: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(data));
  return Buffer.from(digest).toString('hex');
}

// Re-encrypts every encrypted attachment, removed ones included (undo can
// restore them), under `newKeyId` while the old key is still loaded. On any
// failure it puts back the documents it already moved and throws, so the
// caller can keep the old key: `attachment-reencrypt-failed` when everything
// was put back, `attachment-restore-failed` when some document couldn't be.
// On success it returns `restore`, which the caller runs if the key change
// fails later; it resolves false when some document couldn't be put back.
export async function reencryptAttachments(
  newKeyId: string,
): Promise<{ restore: () => Promise<boolean> }> {
  const rows = await db.all<db.DbTransactionAttachment>(
    'SELECT * FROM transaction_attachments WHERE encrypt_meta IS NOT NULL',
  );
  const remote = rows.length > 0 ? await getRemote() : null;
  if (rows.length > 0 && !remote) {
    throw new Error('attachment-reencrypt-failed');
  }

  const moved: Array<{ row: db.DbTransactionAttachment; old: Uint8Array }> = [];
  const setMeta = (id: string, encrypt_meta: string | null) =>
    runMutator(() =>
      db.update('transaction_attachments', { id, encrypt_meta }),
    );

  // Puts the old ciphertext back first and only then the old meta, so a row
  // never names the old key over bytes the server may still hold under the
  // new one. A row whose restore upload fails keeps the meta it has. That
  // matches the server unless the forward upload was stored but never
  // acknowledged, which can't be told apart while the server is unreachable;
  // the failure is reported either way.
  async function restore() {
    let allRestored = true;
    for (const { row, old } of moved) {
      if (remote && (await uploadAttachmentBlob(remote, row.id, old, true))) {
        allRestored = false;
        logger.warn(`Could not restore attachment ${row.id}`);
        continue;
      }
      await setMeta(row.id, row.encrypt_meta);
      await writeCache(row.id, old).catch(() => undefined);
    }
    return allRestored;
  }

  try {
    for (const row of rows) {
      const loaded = await load(remote, row.id, row.encrypt_meta);
      if (loaded.error) {
        // The sync server says the document is gone: nothing to re-encrypt
        if ((loaded.cause as { notFound?: boolean }).notFound) {
          logger.warn(`Skipped attachment ${row.id}: document not found`);
          continue;
        }
        throw loaded.cause;
      }
      const old = loaded.stored;
      const { stored, encryptMeta } = await seal(loaded.data, newKeyId);
      // Before the upload: one stored but never acknowledged is restored too
      moved.push({ row, old });
      const refused = remote
        ? await uploadAttachmentBlob(remote, row.id, stored, true)
        : { error: 'upload-failed' };
      if (refused) {
        throw new Error(`Re-upload refused: ${refused.error}`);
      }
      await setMeta(row.id, encryptMeta);
      await writeCache(row.id, stored);
    }
  } catch (e) {
    logger.warn('Attachment re-encryption failed; restoring', e);
    throw new Error(
      (await restore())
        ? 'attachment-reencrypt-failed'
        : 'attachment-restore-failed',
    );
  }
  return { restore };
}
