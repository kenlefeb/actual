import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { resolve } from 'node:path';

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAccountDb } from './account-db';
import { app as serverApp } from './app';
import { handlers as app } from './app-sync';
import {
  resetAttachmentMetrics,
  runAttachmentCleanup,
} from './attachment-cleanup';
import { config } from './load-config';
import {
  getPathForAttachment,
  getPathForAttachmentsDir,
  isValidFileId,
} from './util/paths';
import type { FileId } from './util/paths';

// fork: sc-2525, see openspec/changes/attachment-blob-cleanup

const DAY = 24 * 60 * 60 * 1000;
const PDF = Buffer.from('%PDF-1.7\nsynthetic test receipt\n');

function newId(): FileId {
  const id = crypto.randomBytes(16).toString('hex');
  if (!isValidFileId(id)) {
    throw new Error('Generated id is invalid');
  }
  return id;
}

function addBudget(owner = 'genericAdmin') {
  const fileId = newId();
  getAccountDb().mutate(
    'INSERT INTO files (id, deleted, owner) VALUES (?, FALSE, ?)',
    [fileId, owner],
  );
  return fileId;
}

function store(fileId: FileId, attachmentId: FileId, body = PDF) {
  fs.mkdirSync(getPathForAttachmentsDir(fileId), { recursive: true });
  fs.writeFileSync(getPathForAttachment(fileId, attachmentId), body);
}

function stored(fileId: FileId, attachmentId: FileId) {
  return fs.existsSync(getPathForAttachment(fileId, attachmentId));
}

function markRemoved(fileId: string, attachmentId: string, daysAgo: number) {
  getAccountDb().mutate(
    'INSERT OR REPLACE INTO attachment_removals (file_id, attachment_id, marked_at) VALUES (?, ?, ?)',
    [fileId, attachmentId, Date.now() - daysAgo * DAY],
  );
}

function markedAt(fileId: string, attachmentId: string): number | undefined {
  return getAccountDb().first(
    'SELECT marked_at FROM attachment_removals WHERE file_id = ? AND attachment_id = ?',
    [fileId, attachmentId],
  )?.marked_at;
}

function budgetMarkedAt(fileId: string): number | undefined {
  return getAccountDb().first(
    'SELECT marked_at FROM budget_removals WHERE file_id = ?',
    [fileId],
  )?.marked_at;
}

function report(body: object, token = 'valid-token') {
  return request(app)
    .post('/report-attachments')
    .set('x-actual-token', token)
    .send(body);
}

function records(fileId: string, after?: string, token = 'valid-token') {
  const req = request(app)
    .get('/attachment-records')
    .set('x-actual-token', token)
    .set('x-actual-file-id', fileId);
  return after === undefined ? req : req.query({ after });
}

function deleteBudget(fileId: string) {
  return request(app)
    .post('/delete-user-file')
    .set('x-actual-token', 'valid-token')
    .send({ fileId });
}

function uploadBudget(fileId: string, token = 'valid-token') {
  return request(app)
    .post('/upload-user-file')
    .set('Content-Type', 'application/encrypted-file')
    .set('x-actual-token', token)
    .set('x-actual-name', 'budget')
    .set('x-actual-file-id', fileId)
    .send(Buffer.from('budget content'));
}

const attachmentsRoot = () => resolve(config.get('userFiles'), 'attachments');

beforeEach(() => {
  getAccountDb().mutate('DELETE FROM attachment_removals');
  getAccountDb().mutate('DELETE FROM budget_removals');
  fs.rmSync(attachmentsRoot(), { recursive: true, force: true });
  resetAttachmentMetrics();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('/report-attachments', () => {
  it('records a removed id whose document is stored, dated now', async () => {
    const fileId = addBudget();
    const id = newId();
    store(fileId, id);
    const before = Date.now();

    const res = await report({ fileId, removed: [id], live: [] });

    expect(res.statusCode).toBe(200);
    expect(markedAt(fileId, id)).toBeGreaterThanOrEqual(before);
  });

  it('records nothing for a removed id whose document is gone', async () => {
    const fileId = addBudget();
    const id = newId();

    const res = await report({ fileId, removed: [id], live: [] });

    expect(res.statusCode).toBe(200);
    expect(markedAt(fileId, id)).toBeUndefined();
  });

  it('keeps the date of an existing record on a repeated report', async () => {
    const fileId = addBudget();
    const id = newId();
    store(fileId, id);
    markRemoved(fileId, id, 10);
    const old = markedAt(fileId, id);

    await report({ fileId, removed: [id], live: [] });

    expect(markedAt(fileId, id)).toBe(old);
  });

  it('a live id clears its record', async () => {
    const fileId = addBudget();
    const id = newId();
    store(fileId, id);
    markRemoved(fileId, id, 10);

    const res = await report({ fileId, removed: [], live: [id] });

    expect(res.statusCode).toBe(200);
    expect(markedAt(fileId, id)).toBeUndefined();
  });

  describe('A report is checked', () => {
    it.each([
      ['removed is not an array', (id: string) => ({ removed: id, live: [] })],
      ['live is missing', (id: string) => ({ removed: [id] })],
      [
        'a number in the array',
        (id: string) => ({ removed: [id, 5], live: [] }),
      ],
      [
        'an id of 65 characters',
        (id: string) => ({ removed: [id, 'a'.repeat(65)], live: [] }),
      ],
      [
        'an id with a slash',
        (id: string) => ({ removed: [id, 'a/b'], live: [] }),
      ],
      ['an id of ..', (id: string) => ({ removed: [id, '..'], live: [] })],
      [
        '1,001 removed ids',
        (id: string) => ({
          removed: [id, ...Array.from({ length: 1000 }, () => newId())],
          live: [],
        }),
      ],
      [
        '1,001 live ids',
        (id: string) => ({
          removed: [id],
          live: Array.from({ length: 1001 }, () => newId()),
        }),
      ],
    ])('answers 400 and records nothing when %s', async (_name, make) => {
      const fileId = addBudget();
      const id = newId();
      store(fileId, id);

      const res = await report({ fileId, ...make(id) });

      expect(res.statusCode).toBe(400);
      expect(markedAt(fileId, id)).toBeUndefined();
    });

    it('accepts exactly 1,000 ids of 64 characters', async () => {
      const fileId = addBudget();
      const removed = Array.from({ length: 1000 }, () => 'a'.repeat(64));

      const res = await report({ fileId, removed, live: [] });

      expect(res.statusCode).toBe(200);
    });

    it('refuses a user without access and records nothing', async () => {
      const fileId = addBudget('otherUser');
      const id = newId();
      store(fileId, id);

      const res = await report(
        { fileId, removed: [id], live: [] },
        'valid-token-user',
      );

      expect(res.statusCode).toBe(403);
      expect(markedAt(fileId, id)).toBeUndefined();
    });

    it('refuses a deleted budget', async () => {
      const fileId = addBudget();
      const id = newId();
      store(fileId, id);
      getAccountDb().mutate('UPDATE files SET deleted = TRUE WHERE id = ?', [
        fileId,
      ]);

      const res = await report({ fileId, removed: [id], live: [] });

      expect(res.statusCode).toBe(400);
      expect(markedAt(fileId, id)).toBeUndefined();
    });
  });
});

describe('/attachment-records', () => {
  it("lists only that budget's recorded ids, without times", async () => {
    const a = addBudget();
    const b = addBudget();
    const idA = newId();
    const idB = newId();
    store(a, idA);
    store(b, idB);
    markRemoved(a, idA, 1);
    markRemoved(b, idB, 1);

    const res = await records(a);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      data: { ids: [idA], after: null },
    });
  });

  it('lists only ids whose document is still stored', async () => {
    const fileId = addBudget();
    const kept = newId();
    store(fileId, kept);
    markRemoved(fileId, kept, 1);
    markRemoved(fileId, newId(), 1);

    const res = await records(fileId);

    expect(res.body.data.ids).toEqual([kept]);
  });

  it('answers 403 and no ids to a user without access', async () => {
    const a = addBudget('otherUser');
    const id = newId();
    store(a, id);
    markRemoved(a, id, 1);

    const res = await records(a, undefined, 'valid-token-user');

    expect(res.statusCode).toBe(403);
    expect(JSON.stringify(res.body) + res.text).not.toContain(id);
  });

  it('answers 403 for another budget than the one the user can reach', async () => {
    const a = addBudget('otherUser');
    const b = addBudget('otherUser');
    getAccountDb().mutate(
      'INSERT INTO user_access (file_id, user_id) VALUES (?, ?)',
      [b, 'genericUser'],
    );
    const id = newId();
    store(a, id);
    markRemoved(a, id, 1);

    const res = await records(a, undefined, 'valid-token-user');

    expect(res.statusCode).toBe(403);
    expect(res.text).not.toContain(id);
  });

  it.each([
    [
      'a deleted budget',
      () => {
        const fileId = addBudget();
        getAccountDb().mutate('UPDATE files SET deleted = TRUE WHERE id = ?', [
          fileId,
        ]);
        return fileId;
      },
    ],
    ['an unknown budget', () => newId()],
    ['an invalid file id', () => '../x'],
  ])('refuses %s with 400 and no ids', async (_name, make) => {
    const res = await records(make());
    expect(res.statusCode).toBe(400);
    expect(res.body?.data).toBeUndefined();
  });

  it.each([
    ['65 characters', 'a'.repeat(65)],
    ['a slash', 'a/b'],
    ['empty', ''],
  ])('answers 400 to an after cursor of %s', async (_name, after) => {
    const fileId = addBudget();
    const res = await records(fileId, after);
    expect(res.statusCode).toBe(400);
  });

  it('pages 2,500 ids in three pages of at most 1,000', async () => {
    const fileId = addBudget();
    const ids = Array.from({ length: 2500 }, () => newId());
    fs.mkdirSync(getPathForAttachmentsDir(fileId), { recursive: true });
    const db = getAccountDb();
    db.transaction(() => {
      for (const id of ids) {
        fs.writeFileSync(getPathForAttachment(fileId, id), 'x');
        db.mutate(
          'INSERT INTO attachment_removals (file_id, attachment_id, marked_at) VALUES (?, ?, ?)',
          [fileId, id, Date.now()],
        );
      }
    });

    const seen: string[] = [];
    let after: string | undefined;
    let pages = 0;
    do {
      const res = await records(fileId, after);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.ids.length).toBeLessThanOrEqual(1000);
      seen.push(...res.body.data.ids);
      after = res.body.data.after ?? undefined;
      pages++;
    } while (after);

    expect(pages).toBe(3);
    expect(seen.sort()).toEqual([...ids].sort());
  });
});

describe('Use keeps a document', () => {
  it('a download restarts the clock', async () => {
    const fileId = addBudget();
    const id = newId();
    store(fileId, id);
    markRemoved(fileId, id, 29);
    const before = Date.now();

    const res = await request(app)
      .get('/download-attachment')
      .set('x-actual-token', 'valid-token')
      .set('x-actual-file-id', fileId)
      .set('x-actual-attachment-id', id);

    expect(res.statusCode).toBe(200);
    expect(markedAt(fileId, id)).toBeGreaterThanOrEqual(before);
  });

  it('an upload restarts the clock', async () => {
    const fileId = addBudget();
    const id = newId();
    store(fileId, id);
    markRemoved(fileId, id, 29);
    const before = Date.now();

    const res = await request(app)
      .post('/upload-attachment')
      .set('x-actual-token', 'valid-token')
      .set('x-actual-file-id', fileId)
      .set('x-actual-attachment-id', id)
      .set('Content-Type', 'application/actual-attachment')
      .send(PDF);

    expect(res.statusCode).toBe(200);
    expect(markedAt(fileId, id)).toBeGreaterThanOrEqual(before);
  });
});

describe('The retention setting is checked', () => {
  afterEach(() => {
    delete process.env.ACTUAL_ATTACHMENTS_ORPHAN_RETENTION_DAYS;
    vi.resetModules();
  });

  async function loadConfig(value?: string) {
    if (value !== undefined) {
      process.env.ACTUAL_ATTACHMENTS_ORPHAN_RETENTION_DAYS = value;
    }
    vi.resetModules();
    const { config: fresh } = await import('./load-config');
    return fresh.get('attachments.orphanRetentionDays');
  }

  it('defaults to 30 days', async () => {
    expect(await loadConfig()).toBe(30);
  });

  it('accepts 0, the kill switch', async () => {
    expect(await loadConfig('0')).toBe(0);
  });

  it.each(['-1', '1.5', 'abc', ''])(
    'refuses to start with %j, naming the setting',
    async value => {
      await expect(loadConfig(value)).rejects.toThrow(
        /attachments\.orphanRetentionDays: must be a non-negative integer/,
      );
    },
  );
});

describe('Cleanup', () => {
  it('keeps a 29-day record and deletes a 31-day one with its record', async () => {
    const fileId = addBudget();
    const young = newId();
    const old = newId();
    store(fileId, young);
    store(fileId, old);
    markRemoved(fileId, young, 29);
    markRemoved(fileId, old, 31);

    await runAttachmentCleanup();

    expect(stored(fileId, young)).toBe(true);
    expect(stored(fileId, old)).toBe(false);
    expect(markedAt(fileId, young)).toBeDefined();
    expect(markedAt(fileId, old)).toBeUndefined();
  });

  it('never deletes a document without a record', async () => {
    const fileId = addBudget();
    const id = newId();
    store(fileId, id);

    await runAttachmentCleanup(Date.now() + 1000 * DAY);

    expect(stored(fileId, id)).toBe(true);
  });

  it('deletes nothing when the setting is 0', async () => {
    const days = config.get('attachments.orphanRetentionDays');
    config.set('attachments.orphanRetentionDays', 0);
    onTestFinished(() => {
      config.set('attachments.orphanRetentionDays', days);
    });
    const fileId = addBudget();
    const id = newId();
    store(fileId, id);
    markRemoved(fileId, id, 365);

    await runAttachmentCleanup();

    expect(stored(fileId, id)).toBe(true);
    expect(markedAt(fileId, id)).toBeDefined();
  });

  it('deletes at most 500 per run, oldest record first', async () => {
    const fileId = addBudget();
    const ids = Array.from({ length: 501 }, () => newId());
    // ids[0] is the newest record
    ids.forEach((id, i) => {
      store(fileId, id);
      markRemoved(fileId, id, 40 + i);
    });

    await runAttachmentCleanup();

    expect(stored(fileId, ids[0])).toBe(true);
    expect(ids.slice(1).filter(id => stored(fileId, id))).toEqual([]);

    await runAttachmentCleanup();

    expect(stored(fileId, ids[0])).toBe(false);
  });

  it('500 old records whose files are gone do not starve a newer one', async () => {
    const fileId = addBudget();
    const db = getAccountDb();
    db.transaction(() => {
      for (let i = 0; i < 500; i++) {
        markRemoved(fileId, newId(), 60);
      }
    });
    const newer = newId();
    store(fileId, newer);
    markRemoved(fileId, newer, 31);

    await runAttachmentCleanup();
    await runAttachmentCleanup();

    expect(stored(fileId, newer)).toBe(false);
    expect(db.first('SELECT COUNT(*) AS n FROM attachment_removals').n).toBe(0);
  });

  it('logs a failing file, deletes the others, and moves its record behind newer ones', async () => {
    const fileId = addBudget();
    const failing = newId();
    const other = newId();
    // A non-empty folder where the blob should be can't be unlinked
    fs.mkdirSync(getPathForAttachment(fileId, failing), { recursive: true });
    fs.writeFileSync(`${getPathForAttachment(fileId, failing)}/x`, 'x');
    store(fileId, other);
    markRemoved(fileId, failing, 60);
    markRemoved(fileId, other, 40);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const before = Date.now();

    await runAttachmentCleanup();

    expect(stored(fileId, other)).toBe(false);
    expect(markedAt(fileId, failing)).toBeGreaterThanOrEqual(before);
    expect(log).toHaveBeenCalled();
    const metrics = await request(serverApp).get('/metrics');
    expect(metrics.body.attachments.lastCleanup).toMatchObject({
      deleted: 1,
      result: 'partial',
    });
  });

  it('keeps a document a download touched after cleanup chose it', async () => {
    const fileId = addBudget();
    const first = newId();
    const touched = newId();
    store(fileId, first);
    store(fileId, touched);
    markRemoved(fileId, first, 50);
    markRemoved(fileId, touched, 40);
    const unlink = fsPromises.unlink;
    vi.spyOn(fsPromises, 'unlink').mockImplementation(async path => {
      // The download lands while cleanup is deleting the record before it
      getAccountDb().mutate(
        'UPDATE attachment_removals SET marked_at = ? WHERE attachment_id = ?',
        [Date.now(), touched],
      );
      return unlink(path);
    });

    await runAttachmentCleanup();

    expect(stored(fileId, first)).toBe(false);
    expect(stored(fileId, touched)).toBe(true);
  });

  it('logs each deletion with budget id, attachment id and age', async () => {
    const fileId = addBudget();
    const id = newId();
    store(fileId, id);
    markRemoved(fileId, id, 31);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await runAttachmentCleanup();

    const lines = info.mock.calls.map(call => call.join(' '));
    expect(
      lines.filter(
        line => line.includes(fileId) && line.includes(id) && /31/.test(line),
      ),
    ).toHaveLength(1);
  });
});

describe("A deleted budget's documents", () => {
  it('records the deletion and removes the folder after the retention period', async () => {
    const fileId = addBudget();
    const id = newId();
    store(fileId, id);
    const before = Date.now();

    expect((await deleteBudget(fileId)).statusCode).toBe(200);
    expect(budgetMarkedAt(fileId)).toBeGreaterThanOrEqual(before);

    await runAttachmentCleanup(Date.now() + 29 * DAY);
    expect(fs.existsSync(getPathForAttachmentsDir(fileId))).toBe(true);

    await runAttachmentCleanup(Date.now() + 31 * DAY);
    expect(fs.existsSync(getPathForAttachmentsDir(fileId))).toBe(false);
    expect(budgetMarkedAt(fileId)).toBeUndefined();
  });

  it('keeps the folder of a budget restored before the job runs', async () => {
    const fileId = addBudget();
    store(fileId, newId());
    getAccountDb().mutate(
      'INSERT INTO budget_removals (file_id, marked_at) VALUES (?, ?)',
      [fileId, Date.now() - 31 * DAY],
    );

    await runAttachmentCleanup();

    expect(fs.existsSync(getPathForAttachmentsDir(fileId))).toBe(true);
  });

  it.each(['', '..', '../attachments'])(
    'removes nothing for a record with file id %j, and logs the refusal',
    async badId => {
      const fileId = addBudget();
      store(fileId, newId());
      getAccountDb().mutate(
        'INSERT INTO budget_removals (file_id, marked_at) VALUES (?, ?)',
        [badId, Date.now() - 31 * DAY],
      );
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      await runAttachmentCleanup();

      expect(fs.existsSync(attachmentsRoot())).toBe(true);
      expect(fs.existsSync(getPathForAttachmentsDir(fileId))).toBe(true);
      expect(log).toHaveBeenCalled();
    },
  );

  it('an upload by the owner under the id clears the record and keeps the documents', async () => {
    const fileId = addBudget();
    const id = newId();
    store(fileId, id);
    await deleteBudget(fileId);

    const res = await uploadBudget(fileId);

    expect(res.statusCode).toBe(200);
    expect(budgetMarkedAt(fileId)).toBeUndefined();
    await runAttachmentCleanup(Date.now() + 31 * DAY);
    expect(stored(fileId, id)).toBe(true);
  });

  it('an owner upload of a deleted shared budget succeeds and drops the old shares', async () => {
    const fileId = addBudget();
    getAccountDb().mutate(
      'INSERT INTO user_access (file_id, user_id) VALUES (?, ?)',
      [fileId, 'genericUser'],
    );
    const id = newId();
    store(fileId, id);
    await deleteBudget(fileId);

    const res = await uploadBudget(fileId);

    expect(res.statusCode).toBe(200);
    expect(budgetMarkedAt(fileId)).toBeUndefined();
    expect(stored(fileId, id)).toBe(true);
    expect(
      getAccountDb().first(
        'SELECT COUNT(*) AS n FROM user_access WHERE file_id = ?',
        [fileId],
      ).n,
    ).toBe(0);
  });

  it('an upload by another user under the id leaves the record', async () => {
    const fileId = addBudget();
    store(fileId, newId());
    await deleteBudget(fileId);

    const res = await uploadBudget(fileId, 'valid-token-user');

    expect(res.statusCode).toBe(403);
    expect(budgetMarkedAt(fileId)).toBeDefined();
    await runAttachmentCleanup(Date.now() + 31 * DAY);
    expect(fs.existsSync(getPathForAttachmentsDir(fileId))).toBe(false);
  });

  it('a sync reset keeps documents and removal records', async () => {
    const fileId = addBudget();
    const id = newId();
    store(fileId, id);
    markRemoved(fileId, id, 5);

    const res = await request(app)
      .post('/reset-user-file')
      .set('x-actual-token', 'valid-token')
      .send({ fileId });

    expect(res.statusCode).toBe(200);
    expect(stored(fileId, id)).toBe(true);
    expect(markedAt(fileId, id)).toBeDefined();
    expect(budgetMarkedAt(fileId)).toBeUndefined();
  });
});

describe('/metrics attachments block', () => {
  it('shows stored bytes, removal bytes and count, and the last cleanup', async () => {
    const fileId = addBudget();
    const live = newId();
    const removed = newId();
    const old = [newId(), newId(), newId()];
    store(fileId, live, Buffer.alloc(100));
    store(fileId, removed, Buffer.alloc(40));
    markRemoved(fileId, removed, 1);
    // A record whose document is gone is not counted
    markRemoved(fileId, newId(), 1);
    for (const id of old) {
      store(fileId, id);
      markRemoved(fileId, id, 31);
    }
    await runAttachmentCleanup();
    resetAttachmentMetrics();

    const res = await request(serverApp).get('/metrics');

    expect(res.statusCode).toBe(200);
    expect(res.body.attachments).toEqual({
      bytes: 140,
      removalBytes: 40,
      removalCount: 1,
      lastCleanup: {
        at: expect.any(Number),
        deleted: 3,
        result: 'ok',
      },
    });
    expect(JSON.stringify(res.body)).not.toContain(fileId);
  });

  it('shows only "error" after a run that failed with a path in its message', async () => {
    vi.spyOn(getAccountDb(), 'all').mockImplementation(() => {
      throw new Error(`disk failed at ${attachmentsRoot()}/secret`);
    });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runAttachmentCleanup();
    vi.restoreAllMocks();

    const res = await request(serverApp).get('/metrics');
    expect(res.body.attachments.lastCleanup.result).toBe('error');
    expect(JSON.stringify(res.body)).not.toContain('secret');
    expect(JSON.stringify(res.body)).not.toContain('disk failed');
  });

  it('50 concurrent requests share one walk', async () => {
    const fileId = addBudget();
    store(fileId, newId());
    const readdir = vi.spyOn(fsPromises, 'readdir');

    const results = await Promise.all(
      Array.from({ length: 50 }, () => request(serverApp).get('/metrics')),
    );

    expect(
      results.every(res => res.body.attachments.bytes === PDF.length),
    ).toBe(true);
    // The root and the one budget folder: one walk
    expect(readdir).toHaveBeenCalledTimes(2);
  });
});
