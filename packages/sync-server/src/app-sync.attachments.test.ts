import crypto from 'node:crypto';
import fs from 'node:fs';

import request from 'supertest';

import { getAccountDb } from './account-db';
import { handlers as app } from './app-sync';
import { config } from './load-config';
import {
  getPathForAttachment,
  getPathForAttachmentsDir,
  isValidFileId,
} from './util/paths';
import type { FileId } from './util/paths';

const MB = 1024 * 1024;
const PDF = Buffer.from('%PDF-1.7\nsynthetic test receipt\n');

function newId(): FileId {
  const id = crypto.randomBytes(16).toString('hex');
  if (!isValidFileId(id)) {
    throw new Error('Generated id is invalid');
  }
  return id;
}

function pdfOfSize(size: number) {
  const data = Buffer.alloc(size, 0x20);
  PDF.copy(data);
  return data;
}

function addBudget(owner = 'genericAdmin') {
  const fileId = newId();
  getAccountDb().mutate(
    'INSERT INTO files (id, deleted, owner) VALUES (?, FALSE, ?)',
    [fileId, owner],
  );
  onTestFinished(() => {
    fs.rmSync(getPathForAttachmentsDir(fileId), {
      recursive: true,
      force: true,
    });
  });
  return fileId;
}

function upload(
  fileId: string,
  attachmentId: string,
  body: Buffer,
  { encrypted = false, token = 'valid-token' } = {},
) {
  return request(app)
    .post('/upload-attachment')
    .set('x-actual-token', token)
    .set('x-actual-file-id', fileId)
    .set('x-actual-attachment-id', attachmentId)
    .set('x-actual-attachment-encrypted', String(encrypted))
    .set('Content-Type', 'application/actual-attachment')
    .send(body);
}

function download(fileId: string, attachmentId: string, token = 'valid-token') {
  return request(app)
    .get('/download-attachment')
    .set('x-actual-token', token)
    .set('x-actual-file-id', fileId)
    .set('x-actual-attachment-id', attachmentId)
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
}

function remove(fileId: string, attachmentId: string, token = 'valid-token') {
  return request(app)
    .post('/delete-attachment')
    .set('x-actual-token', token)
    .set('x-actual-file-id', fileId)
    .set('x-actual-attachment-id', attachmentId);
}

function stored(fileId: FileId, attachmentId: FileId) {
  return fs.existsSync(getPathForAttachment(fileId, attachmentId));
}

describe('attachments', () => {
  it('upload then download returns the same bytes', async () => {
    const fileId = addBudget();
    const id = newId();

    expect((await upload(fileId, id, PDF)).statusCode).toBe(200);
    const res = await download(fileId, id);

    expect(res.statusCode).toBe(200);
    expect(Buffer.compare(res.body, PDF)).toBe(0);
  });

  it('download of a missing document is 404', async () => {
    const fileId = addBudget();
    expect((await download(fileId, newId())).statusCode).toBe(404);
  });

  describe('Server checks too', () => {
    it('refuses an 11 MB file and stores nothing', async () => {
      const fileId = addBudget();
      const id = newId();

      const res = await upload(fileId, id, pdfOfSize(11 * MB));

      expect(res.statusCode).toBe(413);
      expect(res.body).toMatchObject({ reason: 'too-large', limitMB: 10 });
      expect(stored(fileId, id)).toBe(false);
    });

    it('refuses unencrypted content that is not PDF, JPEG, PNG or WebP', async () => {
      const fileId = addBudget();
      const id = newId();

      const res = await upload(fileId, id, Buffer.from('not a receipt'));

      expect(res.statusCode).toBe(415);
      expect(res.body).toMatchObject({ reason: 'unsupported-type' });
      expect(stored(fileId, id)).toBe(false);
    });

    it('names a HEIC upload', async () => {
      const fileId = addBudget();
      const heic = Buffer.concat([
        Buffer.from([0, 0, 0, 0x18]),
        Buffer.from('ftypheic', 'latin1'),
      ]);

      const res = await upload(fileId, newId(), heic);

      expect(res.statusCode).toBe(415);
      expect(res.body).toMatchObject({ reason: 'heic' });
    });

    it('stores an encrypted upload of non-PDF bytes under the limit', async () => {
      const fileId = addBudget();
      const id = newId();
      const ciphertext = crypto.randomBytes(1000);

      const res = await upload(fileId, id, ciphertext, { encrypted: true });

      expect(res.statusCode).toBe(200);
      expect(stored(fileId, id)).toBe(true);
    });

    it('accepts an encrypted upload exactly at the limit and refuses one byte more', async () => {
      const fileId = addBudget();
      const atLimit = newId();
      const overLimit = newId();

      const ok = await upload(fileId, atLimit, Buffer.alloc(10 * MB, 1), {
        encrypted: true,
      });
      const tooBig = await upload(
        fileId,
        overLimit,
        Buffer.alloc(10 * MB + 1, 1),
        { encrypted: true },
      );

      expect(ok.statusCode).toBe(200);
      expect(tooBig.statusCode).toBe(413);
      expect(stored(fileId, overLimit)).toBe(false);
    });
  });

  describe('Quota reached', () => {
    // Scaled down from 1 GB so the test doesn't write a gigabyte: the budget
    // holds its quota minus 1 MB and the new document is 2 MB.
    it('refuses an upload past the budget quota', async () => {
      const quota = config.get('attachments.budgetQuotaMB');
      config.set('attachments.budgetQuotaMB', 3);
      onTestFinished(() => {
        config.set('attachments.budgetQuotaMB', quota);
      });
      const fileId = addBudget();
      const id = newId();
      expect(
        (await upload(fileId, newId(), pdfOfSize(2 * MB))).statusCode,
      ).toBe(200);

      const res = await upload(fileId, id, pdfOfSize(2 * MB));

      expect(res.statusCode).toBe(413);
      expect(res.body).toMatchObject({ reason: 'quota' });
      expect(stored(fileId, id)).toBe(false);
    });

    it('still answers when a file vanishes while the folder is read', async () => {
      const fileId = addBudget();
      const dir = getPathForAttachmentsDir(fileId);
      fs.mkdirSync(dir, { recursive: true });
      // Listed by readdir, gone by stat, like a temp file renamed away
      fs.symlinkSync(`${dir}/missing-target`, `${dir}/vanished.blob`);

      const res = await upload(fileId, newId(), PDF);

      expect(res.statusCode).toBe(200);
    });

    it('counts an overwritten document only once', async () => {
      const quota = config.get('attachments.budgetQuotaMB');
      config.set('attachments.budgetQuotaMB', 3);
      onTestFinished(() => {
        config.set('attachments.budgetQuotaMB', quota);
      });
      const fileId = addBudget();
      const id = newId();
      await upload(fileId, id, pdfOfSize(2 * MB));

      const res = await upload(fileId, id, pdfOfSize(2 * MB));

      expect(res.statusCode).toBe(200);
    });
  });

  it('an upload with an existing attachment id overwrites the document', async () => {
    const fileId = addBudget();
    const id = newId();
    await upload(fileId, id, PDF);
    const replacement = Buffer.from('%PDF-1.7\nreplacement\n');

    expect((await upload(fileId, id, replacement)).statusCode).toBe(200);
    const res = await download(fileId, id);

    expect(Buffer.compare(res.body, replacement)).toBe(0);
  });

  it('delete removes the document', async () => {
    const fileId = addBudget();
    const id = newId();
    await upload(fileId, id, PDF);

    expect((await remove(fileId, id)).statusCode).toBe(200);
    expect(stored(fileId, id)).toBe(false);
  });

  describe('No access', () => {
    it('refuses a user without access to the budget', async () => {
      const fileId = addBudget('otherUser');
      const id = newId();
      await upload(fileId, id, PDF);

      const down = await download(fileId, id, 'valid-token-user');
      const up = await upload(fileId, newId(), PDF, {
        token: 'valid-token-user',
      });
      const del = await remove(fileId, id, 'valid-token-user');

      expect(down.statusCode).toBe(403);
      expect(down.body.toString()).not.toContain('synthetic test receipt');
      expect(up.statusCode).toBe(403);
      expect(del.statusCode).toBe(403);
      expect(stored(fileId, id)).toBe(true);
    });

    it('lets a user with shared access download', async () => {
      const fileId = addBudget('otherUser');
      getAccountDb().mutate(
        'INSERT INTO user_access (file_id, user_id) VALUES (?, ?)',
        [fileId, 'genericUser'],
      );
      const id = newId();
      await upload(fileId, id, PDF);

      const res = await download(fileId, id, 'valid-token-user');

      expect(res.statusCode).toBe(200);
    });

    it('refuses an unknown budget', async () => {
      const res = await upload(newId(), newId(), PDF);
      expect(res.statusCode).toBe(400);
    });
  });

  describe('Not signed in', () => {
    it.each([
      ['upload', () => request(app).post('/upload-attachment')],
      ['download', () => request(app).get('/download-attachment')],
      ['delete', () => request(app).post('/delete-attachment')],
    ])('refuses %s without a session', async (_name, send) => {
      const res = await send();
      expect(res.statusCode).toBe(401);
    });
  });

  describe('Path in the id', () => {
    it.each([
      ['upload', (fileId: string) => upload(fileId, '../file-x', PDF)],
      ['download', (fileId: string) => download(fileId, '../file-x')],
      ['delete', (fileId: string) => remove(fileId, '../file-x')],
    ])('rejects %s of ../file-x as an invalid id', async (_name, send) => {
      const fileId = addBudget();
      const res = await send(fileId);
      expect(res.statusCode).toBe(400);
      // download's raw parser leaves the text in body
      expect(String(res.text ?? res.body)).toContain('invalid attachmentId');
    });
  });
});
