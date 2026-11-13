// @ts-strict-ignore
import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  create,
  fromBinary,
  SyncRequestSchema,
  SyncResponseSchema,
  toBinary,
} from '@actual-app/crdt';
import type { Request, Response } from 'express';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';

import { getAccountDb, isAdmin } from './account-db';
import { FileNotFound } from './app-sync/errors';
import {
  File,
  FilesService,
  FileUpdate,
} from './app-sync/services/files-service';
import {
  validateSyncedFile,
  validateUploadedFile,
} from './app-sync/validation';
import {
  isStored,
  isValidAttachmentId,
  touchRemoval,
} from './attachment-cleanup';
import { config } from './load-config';
import { SecretName, secretsService } from './services/secrets-service';
import * as UserService from './services/user-service';
import * as simpleSync from './sync-simple';
import { accessLogMiddleware, noteFileAccess } from './util/access-log';
import { atomicWriteFile } from './util/atomic-write';
import { detectAttachmentType } from './util/attachments';
import {
  errorMiddleware,
  requestLoggerMiddleware,
  validateSessionMiddleware,
} from './util/middlewares';
import {
  getPathForAttachment,
  getPathForAttachmentsDir,
  getPathForGroupFile,
  getPathForUserFile,
  isValidFileId,
  isValidGroupId,
} from './util/paths';
import type { GroupId } from './util/paths';

const app = express();
app.use(validateSessionMiddleware);
app.use(accessLogMiddleware); // fork-only access log (see util/access-log.ts)
app.use(errorMiddleware);
app.use(requestLoggerMiddleware);
app.use(
  express.raw({
    type: 'application/actual-sync',
    limit: `${config.get('upload.fileSizeSyncLimitMB')}mb`,
  }),
);
app.use(
  express.raw({
    type: 'application/encrypted-file',
    limit: `${config.get('upload.syncEncryptedFileSizeLimitMB')}mb`,
  }),
);
app.use(express.json({ limit: `${config.get('upload.fileSizeLimitMB')}mb` }));

export { app as handlers };

const OK_RESPONSE = { status: 'ok' };

function boolToInt(deleted: boolean) {
  return deleted ? 1 : 0;
}

function generateGroupId(): GroupId {
  const id = uuidv4();
  if (!isValidGroupId(id)) {
    throw new TypeError('UUID format no longer matches expected format');
  }
  return id;
}

function extractSingleHeader(
  req: Request,
  res: Response,
  key: string,
): string | null {
  const value = req.headers[key];
  if (!value) {
    return null;
  }
  if (typeof value !== 'string') {
    res.status(400).send('Duplicate headers encountered for key ' + key);
    return null;
  }
  return value;
}

const verifyFileExists = (
  fileId: unknown,
  filesService: FilesService,
  res: Response,
  errorObject: string | Record<string, unknown>,
) => {
  if (typeof fileId !== 'string' || !isValidFileId(fileId)) {
    res.status(400).send('invalid fileId');
    return;
  }

  try {
    return filesService.get(fileId);
  } catch (e) {
    if (e instanceof FileNotFound) {
      noteFileAccess(fileId); // fork-only access log
      //FIXME: error code should be 404. Need to make sure frontend is ok with it.
      //TODO: put this into a middleware that checks if FileNotFound is thrown and returns 404 and same error message
      // for every FileNotFound error
      res.status(400).send(errorObject);
      return;
    }
    throw e;
  }
};

function requireFileOwner(file: File, userId: string) {
  noteFileAccess(file.id); // fork-only access log
  const isOwner = file.owner === userId;
  const isServerAdmin = isAdmin(userId);
  if (isOwner || isServerAdmin) {
    return null;
  }
  return 'file-access-not-allowed';
}

function requireFileAccess(file: File, userId: string) {
  if (requireFileOwner(file, userId) === null) {
    return null;
  }
  if (UserService.countUserAccess(file.id, userId) > 0) {
    return null;
  }
  return 'file-access-not-allowed';
}

app.post('/sync', async (req, res): Promise<void> => {
  let requestPb;
  try {
    requestPb = fromBinary(SyncRequestSchema, req.body);
  } catch (e) {
    console.log('Error parsing sync request', e);
    res.status(500);
    res.send({ status: 'error', reason: 'internal-error' });
    return;
  }

  const fileId = requestPb.fileId || null;
  const groupId = requestPb.groupId || null;
  const keyId = requestPb.keyId || null;
  const since = requestPb.since || null;
  const messages = requestPb.messages;

  if (!since) {
    res.status(422).send({
      details: 'since-required',
      reason: 'unprocessable-entity',
      status: 'error',
    });
    return;
  }

  const filesService = new FilesService(getAccountDb());

  const currentFile = verifyFileExists(
    fileId,
    filesService,
    res,
    'file-not-found',
  );

  if (!currentFile) {
    return;
  }

  const fileAccessError = requireFileAccess(currentFile, res.locals.user_id);
  if (fileAccessError) {
    res.status(403);
    res.send(fileAccessError);
    return;
  }

  const errorMessage = validateSyncedFile(groupId, keyId, currentFile);
  if (errorMessage) {
    res.status(400);
    res.send(errorMessage);
    return;
  }

  const { trie, newMessages } = simpleSync.sync(messages, since, groupId);

  const responsePb = create(SyncResponseSchema, {
    merkle: JSON.stringify(trie),
    messages: newMessages,
  });

  res.set('Content-Type', 'application/actual-sync');
  res.set('X-ACTUAL-SYNC-METHOD', 'simple');
  res.send(Buffer.from(toBinary(SyncResponseSchema, responsePb)));
});

app.post('/user-get-key', (req, res) => {
  if (!res.locals) return;

  const { fileId } = req.body || {};

  const filesService = new FilesService(getAccountDb());
  const file = verifyFileExists(fileId, filesService, res, 'file-not-found');

  if (!file) {
    return;
  }

  const fileAccessError = requireFileAccess(file, res.locals.user_id);
  if (fileAccessError) {
    res.status(403);
    res.send(fileAccessError);
    return;
  }

  res.send({
    status: 'ok',
    data: {
      id: file.encryptKeyId,
      salt: file.encryptSalt,
      test: file.encryptTest,
    },
  });
});

app.post('/user-create-key', (req, res) => {
  const { fileId, keyId, keySalt, testContent } = req.body || {};

  const filesService = new FilesService(getAccountDb());
  const file = verifyFileExists(fileId, filesService, res, 'file-not-found');

  if (!file) {
    return;
  }

  const fileAccessError = requireFileOwner(file, res.locals.user_id);
  if (fileAccessError) {
    res.status(403);
    res.send(fileAccessError);
    return;
  }

  filesService.update(
    file.id,
    new FileUpdate({
      encryptSalt: keySalt,
      encryptKeyId: keyId,
      encryptTest: testContent,
    }),
  );

  res.send(OK_RESPONSE);
});

app.post('/reset-user-file', async (req, res) => {
  const { fileId } = req.body || {};

  const filesService = new FilesService(getAccountDb());
  const file = verifyFileExists(
    fileId,
    filesService,
    res,
    'User or file not found',
  );

  if (!file) {
    return;
  }

  const fileAccessError = requireFileOwner(file, res.locals.user_id);
  if (fileAccessError) {
    res.status(403);
    res.send(fileAccessError);
    return;
  }

  const groupId = file.groupId;

  filesService.update(file.id, new FileUpdate({ groupId: null }));

  if (groupId) {
    try {
      await fs.unlink(getPathForGroupFile(groupId));
    } catch {
      console.log(`Unable to delete sync data for group "${groupId}"`);
    }
  }

  res.send(OK_RESPONSE);
});

app.post('/upload-user-file', async (req, res) => {
  if (typeof req.headers['x-actual-name'] !== 'string') {
    // FIXME: Not sure how this cannot be a string when the header is
    // set.
    res.status(400).send('single x-actual-name is required');
    return;
  }

  const name = decodeURIComponent(req.headers['x-actual-name']);
  const fileId = req.headers['x-actual-file-id'];

  if (!fileId || typeof fileId !== 'string') {
    res.status(400).send('fileId is required');
    return;
  }
  if (!isValidFileId(fileId)) {
    res.status(400).send('invalid fileId');
    return;
  }

  const groupIdHeader = req.headers['x-actual-group-id'];
  const encryptMeta = extractSingleHeader(req, res, 'x-actual-encrypt-meta');
  if (res.headersSent) return;
  const syncFormatVersion = extractSingleHeader(req, res, 'x-actual-format');
  if (res.headersSent) return;

  let groupId: GroupId | null = null;
  if (groupIdHeader !== undefined) {
    if (typeof groupIdHeader !== 'string' || !isValidGroupId(groupIdHeader)) {
      res.status(400).send('invalid groupId');
      return;
    }
    groupId = groupIdHeader;
  }

  const keyId =
    encryptMeta && typeof encryptMeta === 'string'
      ? JSON.parse(encryptMeta).keyId
      : null;

  const filesService = new FilesService(getAccountDb());
  let currentFile;

  try {
    currentFile = filesService.get(fileId);
  } catch (e) {
    if (e instanceof FileNotFound) {
      currentFile = null;
    } else {
      throw e;
    }
  }

  // fork: sc-2525. Only the owner of a deleted budget may upload under its id,
  // which keeps its documents; anyone else would adopt the old folder.
  const deletedFile = currentFile ? null : filesService.getRaw(fileId);
  if (deletedFile && deletedFile.owner !== res.locals.user_id) {
    res.status(403).send('file-access-not-allowed');
    return;
  }

  const fileAccessError = currentFile
    ? requireFileAccess(currentFile, res.locals.user_id)
    : null;
  if (fileAccessError) {
    res.status(403);
    res.send(fileAccessError);
    return;
  }

  const errorMessage = validateUploadedFile(groupId, keyId, currentFile);
  if (errorMessage) {
    res.status(400).send(errorMessage);
    return;
  }

  try {
    await atomicWriteFile(getPathForUserFile(fileId), req.body);
  } catch (err) {
    console.log('Error writing file', err);
    res.status(500).send({ status: 'error' });
    return;
  }

  if (!currentFile) {
    // it's new
    noteFileAccess(fileId); // fork-only access log
    const newGroupId = generateGroupId();
    groupId = newGroupId;
    const accountDb = getAccountDb();
    accountDb.transaction(() => {
      if (deletedFile) {
        accountDb.mutate('DELETE FROM files WHERE id = ?', [fileId]);
        accountDb.mutate('DELETE FROM budget_removals WHERE file_id = ?', [
          fileId,
        ]);
      }
      filesService.set(
        new File({
          id: fileId,
          groupId: newGroupId,
          syncVersion: syncFormatVersion,
          name,
          encryptMeta,
          owner:
            res.locals.user_id ||
            (() => {
              throw new Error('User ID is required for file creation');
            })(),
        }),
      );
    });

    res.send({ status: 'ok', groupId });
    return;
  }

  if (!groupId) {
    // sync state was reset, create new group
    const newGroupId = generateGroupId();
    groupId = newGroupId;
    filesService.update(fileId, new FileUpdate({ groupId: newGroupId }));
  }

  // Regardless, update some properties
  filesService.update(
    fileId,
    new FileUpdate({
      syncVersion: syncFormatVersion,
      encryptMeta,
      name,
    }),
  );

  res.send({ status: 'ok', groupId });
});

app.get('/download-user-file', async (req, res) => {
  const fileId = req.headers['x-actual-file-id'];
  if (typeof fileId !== 'string') {
    // FIXME: Not sure how this cannot be a string when the header is
    // set.
    res.status(400).send('Single file ID is required');
    return;
  }
  if (!isValidFileId(fileId)) {
    res.status(400).send('invalid fileId');
    return;
  }

  const filesService = new FilesService(getAccountDb());
  const file = verifyFileExists(
    fileId,
    filesService,
    res,
    'User or file not found',
  );

  if (!file) {
    return;
  }

  const fileAccessError = requireFileAccess(file, res.locals.user_id);
  if (fileAccessError) {
    res.status(403);
    res.send(fileAccessError);
    return;
  }

  const path = getPathForUserFile(fileId);

  if (!path.startsWith(resolve(config.get('userFiles')))) {
    //Ensure the user doesn't try to access files outside of the user files directory
    res.status(403).send('Access denied');
    return;
  }

  res.setHeader('Content-Disposition', `attachment;filename=${fileId}`);
  res.sendFile(path, { dotfiles: 'allow' });
});

app.post('/update-user-filename', (req, res) => {
  const { fileId, name } = req.body || {};

  const filesService = new FilesService(getAccountDb());
  const file = verifyFileExists(fileId, filesService, res, 'file-not-found');

  if (!file) {
    return;
  }

  const fileAccessError = requireFileAccess(file, res.locals.user_id);
  if (fileAccessError) {
    res.status(403);
    res.send(fileAccessError);
    return;
  }

  filesService.update(file.id, new FileUpdate({ name }));
  res.send(OK_RESPONSE);
});

app.get('/list-user-files', (req, res) => {
  const fileService = new FilesService(getAccountDb());
  const rows = fileService.find({ userId: res.locals.user_id });
  res.send({
    status: 'ok',
    data: rows.map(row => ({
      deleted: boolToInt(row.deleted),
      fileId: row.id,
      groupId: row.groupId,
      name: row.name,
      encryptKeyId: row.encryptKeyId,
      owner: row.owner,
      usersWithAccess: fileService.findUsersWithAccess(row.id).map(access => ({
        ...access,
        owner: access.userId === row.owner,
      })),
    })),
  });
});

app.get('/get-user-file-info', (req, res) => {
  const fileId = req.headers['x-actual-file-id'];

  // TODO: Return 422 if fileId is not provided. Need to make sure frontend can handle it
  // if (!fileId) {
  //   return res.status(422).send({
  //     details: 'fileId-required',
  //     reason: 'unprocessable-entity',
  //     status: 'error',
  //   });
  // }

  const fileService = new FilesService(getAccountDb());

  const file = verifyFileExists(fileId, fileService, res, {
    status: 'error',
    reason: 'file-not-found',
  });

  if (!file) {
    return;
  }

  const fileAccessError = requireFileAccess(file, res.locals.user_id);
  if (fileAccessError) {
    res.status(403);
    res.send(fileAccessError);
    return;
  }

  res.send({
    status: 'ok',
    data: {
      deleted: boolToInt(file.deleted), //   FIXME: convert to boolean, make sure it works in the frontend
      fileId: file.id,
      groupId: file.groupId,
      name: file.name,
      encryptMeta: file.encryptMeta ? JSON.parse(file.encryptMeta) : null,
      usersWithAccess: fileService.findUsersWithAccess(file.id).map(access => ({
        ...access,
        owner: access.userId === file.owner,
      })),
    },
  });
});

app.post('/delete-user-file', (req, res) => {
  const { fileId } = req.body || {};

  if (!fileId) {
    res.status(422).send({
      details: 'fileId-required',
      reason: 'unprocessable-entity',
      status: 'error',
    });
    return;
  }

  const accountDb = getAccountDb();
  const filesService = new FilesService(accountDb);
  const file = verifyFileExists(fileId, filesService, res, 'file-not-found');
  if (!file) {
    return;
  }

  const fileAccessError = requireFileOwner(file, res.locals.user_id);
  if (fileAccessError) {
    res.status(403);
    res.send(fileAccessError);
    return;
  }

  accountDb.transaction(() => {
    filesService.update(file.id, new FileUpdate({ deleted: true }));
    // fork: sc-2525. Cleanup removes the budget's documents after retention
    accountDb.mutate(
      'INSERT OR REPLACE INTO budget_removals (file_id, marked_at) VALUES (?, ?)',
      [file.id, Date.now()],
    );
    for (const name of Object.values(SecretName)) {
      secretsService.reset(name, file.id);
    }
  });

  res.send(OK_RESPONSE);
});

// Fork-only: documents attached to transactions (transaction-attachments spec).
// One blob per attachment under user-files/attachments/<fileId>/.
const MB = 1024 * 1024;
const attachmentLimitMB = config.get('attachments.fileSizeLimitMB');
// One byte over the limit so the handler, not the parser, refuses an
// oversize body and can name the limit
const attachmentParser = express.raw({
  type: 'application/actual-attachment',
  limit: attachmentLimitMB * MB + 1,
});

function attachmentTooLarge(res: Response) {
  res
    .status(413)
    .send({ status: 'error', reason: 'too-large', limitMB: attachmentLimitMB });
}

// Checks the budget exists, isn't deleted and the session can reach it; on
// failure it has already answered and returns null
function accessibleBudget(fileId: unknown, res: Response) {
  const file = verifyFileExists(
    fileId,
    new FilesService(getAccountDb()),
    res,
    'file-not-found',
  );
  if (!file) {
    return null;
  }
  const fileAccessError = requireFileAccess(file, res.locals.user_id);
  if (fileAccessError) {
    res.status(403).send(fileAccessError);
    return null;
  }
  return file;
}

// Checks the ids and the session's access to the budget; on failure it has
// already answered and returns null
function attachmentTarget(req: Request, res: Response) {
  const fileId = extractSingleHeader(req, res, 'x-actual-file-id');
  if (res.headersSent) return null;
  const attachmentId = extractSingleHeader(req, res, 'x-actual-attachment-id');
  if (res.headersSent) return null;
  if (!attachmentId || !isValidFileId(attachmentId)) {
    res.status(400).send('invalid attachmentId');
    return null;
  }

  const file = accessibleBudget(fileId, res);
  if (!file) {
    return null;
  }
  return {
    fileId: file.id,
    attachmentId,
    dir: getPathForAttachmentsDir(file.id),
    path: getPathForAttachment(file.id, attachmentId),
  };
}

async function storedSize(dir: string, except: string) {
  const names = await fs.readdir(dir).catch(() => []);
  let total = 0;
  for (const name of names) {
    const path = resolve(dir, name);
    if (path !== except) {
      // A temp file can be renamed away between readdir and stat
      total += (await fs.stat(path).catch(() => null))?.size ?? 0;
    }
  }
  return total;
}

app.post(
  '/upload-attachment',
  (req, res, next) =>
    attachmentParser(req, res, err => {
      if (err?.type === 'entity.too.large') {
        attachmentTooLarge(res);
        return;
      }
      next(err);
    }),
  async (req, res) => {
    const target = attachmentTarget(req, res);
    if (!target) {
      return;
    }
    const body: unknown = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).send('attachment body is required');
      return;
    }
    if (body.length > attachmentLimitMB * MB) {
      attachmentTooLarge(res);
      return;
    }
    // The server can't read an encrypted document, so it checks only its size
    if (req.headers['x-actual-attachment-encrypted'] !== 'true') {
      const type = detectAttachmentType(body);
      if (type === null || type === 'heic') {
        res.status(415).send({
          status: 'error',
          reason: type === 'heic' ? 'heic' : 'unsupported-type',
        });
        return;
      }
    }

    // shortcut: two concurrent uploads can both pass, overshooting by one file
    const used = await storedSize(target.dir, target.path);
    if (used + body.length > config.get('attachments.budgetQuotaMB') * MB) {
      res.status(413).send({ status: 'error', reason: 'quota' });
      return;
    }

    try {
      await fs.mkdir(target.dir, { recursive: true });
      await atomicWriteFile(target.path, body);
    } catch (err) {
      console.log('Error writing attachment', err);
      res.status(500).send({ status: 'error' });
      return;
    }
    touchRemoval(target.fileId, target.attachmentId);
    res.send(OK_RESPONSE);
  },
);

app.get('/download-attachment', (req, res) => {
  const target = attachmentTarget(req, res);
  if (!target) {
    return;
  }
  touchRemoval(target.fileId, target.attachmentId);
  res.sendFile(target.path, { dotfiles: 'allow' }, err => {
    if (err && !res.headersSent) {
      // Clients skip a document on this answer, so only a missing file says it
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        res.status(404).send('attachment-not-found');
      } else {
        console.log('Error reading attachment', err);
        res.status(500).send({ status: 'error' });
      }
    }
  });
});

// Only for rolling back an upload whose metadata row couldn't be written;
// removing an attachment in the app keeps its document.
app.post('/delete-attachment', async (req, res) => {
  const target = attachmentTarget(req, res);
  if (!target) {
    return;
  }
  await fs.rm(target.path, { force: true });
  res.send(OK_RESPONSE);
});

// fork: sc-2525. Clients report which documents are removed and which are live
// again; cleanup deletes a document once its removal record is old enough.
const REPORT_LIMIT = 1000;

function isIdList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= REPORT_LIMIT &&
    value.every(isValidAttachmentId)
  );
}

app.post('/report-attachments', async (req, res) => {
  const { fileId, removed, live } = req.body || {};
  if (!isIdList(removed) || !isIdList(live)) {
    res.status(400).send('invalid report');
    return;
  }
  const file = accessibleBudget(fileId, res);
  if (!file) {
    return;
  }

  // An id whose document cleanup already deleted gets no new record
  const storedRemoved = (
    await Promise.all(
      removed.map(async id => ((await isStored(file.id, id)) ? id : null)),
    )
  ).filter(id => id !== null);

  const accountDb = getAccountDb();
  const now = Date.now();
  accountDb.transaction(() => {
    for (const id of storedRemoved) {
      accountDb.mutate(
        'INSERT OR IGNORE INTO attachment_removals (file_id, attachment_id, marked_at) VALUES (?, ?, ?)',
        [file.id, id, now],
      );
    }
    for (const id of live) {
      accountDb.mutate(
        'DELETE FROM attachment_removals WHERE file_id = ? AND attachment_id = ?',
        [file.id, id],
      );
    }
  });
  res.send(OK_RESPONSE);
});

// The budget's recorded ids, in id order so paging never skips or repeats one
app.get('/attachment-records', async (req, res) => {
  const fileId = extractSingleHeader(req, res, 'x-actual-file-id');
  if (res.headersSent) return;
  const { after } = req.query;
  if (after !== undefined && !isValidAttachmentId(after)) {
    res.status(400).send('invalid after');
    return;
  }
  const file = accessibleBudget(fileId, res);
  if (!file) {
    return;
  }

  const rows: { attachment_id: string }[] = getAccountDb().all(
    'SELECT attachment_id FROM attachment_removals WHERE file_id = ? AND attachment_id > ? ORDER BY attachment_id LIMIT ?',
    [file.id, after ?? '', REPORT_LIMIT],
  );
  const ids = (
    await Promise.all(
      rows.map(async row =>
        (await isStored(file.id, row.attachment_id)) ? row.attachment_id : null,
      ),
    )
  ).filter(id => id !== null);
  res.send({
    status: 'ok',
    data: {
      ids,
      after:
        rows.length === REPORT_LIMIT
          ? rows[rows.length - 1].attachment_id
          : null,
    },
  });
});
