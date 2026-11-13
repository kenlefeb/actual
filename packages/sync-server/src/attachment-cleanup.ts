import { randomBytes } from 'node:crypto';
import { renameSync } from 'node:fs';
import fs from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import { getAccountDb } from './account-db';
import { config } from './load-config';
import {
  getPathForAttachment,
  getPathForAttachmentsDir,
  isValidFileId,
} from './util/paths';

// fork: sc-2525, see openspec/changes/attachment-blob-cleanup. Clients report
// removed documents; a document whose removal record is old enough is deleted.

const DAY = 24 * 60 * 60 * 1000;
const RUN_LIMIT = 500;
const METRICS_TTL = 60 * 1000;
const TOMBSTONE_PREFIX = '.deleting-';

type CleanupResult = 'ok' | 'partial' | 'error';
type Candidate = {
  file_id: string;
  attachment_id: string | null;
  marked_at: number;
};

let lastCleanup: {
  at: number;
  deleted: number;
  result: CleanupResult;
} | null = null;
let running = false;

// An id the server stores a document for: valid and at most 64 characters
export function isValidAttachmentId(id: unknown): id is string {
  return typeof id === 'string' && id.length <= 64 && isValidFileId(id);
}

export async function isStored(fileId: string, attachmentId: string) {
  if (!isValidFileId(fileId) || !isValidFileId(attachmentId)) {
    return false;
  }
  const stats = await fs
    .stat(getPathForAttachment(fileId, attachmentId))
    .catch(() => null);
  return stats?.isFile() ?? false;
}

// Download and upload restart the clock of a removed document
export function touchRemoval(fileId: string, attachmentId: string) {
  getAccountDb().mutate(
    'UPDATE attachment_removals SET marked_at = ? WHERE file_id = ? AND attachment_id = ?',
    [Date.now(), fileId, attachmentId],
  );
}

function isMissing(err: unknown) {
  return err instanceof Error && 'code' in err && err.code === 'ENOENT';
}

function attachmentsRoot() {
  return resolve(config.get('userFiles'), 'attachments');
}

function ageInDays(markedAt: number, now: number) {
  return Math.floor((now - markedAt) / DAY);
}

// Finishes removals whose recursive delete failed in an earlier run
async function sweepTombstones() {
  const root = attachmentsRoot();
  const names = await fs.readdir(root).catch(err => {
    if (isMissing(err)) {
      return [];
    }
    throw err;
  });
  let failed = 0;
  for (const name of names.filter(n => n.startsWith(TOMBSTONE_PREFIX))) {
    try {
      await fs.rm(resolve(root, name), { recursive: true, force: true });
    } catch (err) {
      failed++;
      console.log('Attachment cleanup could not remove a leftover folder', err);
    }
  }
  return failed;
}

// Deletes the record first, conditioned on its age, so a download that touched
// it a moment earlier wins. Returns whether a document or folder was deleted;
// throws on a real failure after putting the record back dated now.
async function deleteCandidate(row: Candidate, cutoff: number, now: number) {
  const db = getAccountDb();
  const { file_id: fileId, attachment_id: attachmentId } = row;

  if (attachmentId !== null) {
    if (!isValidFileId(fileId) || !isValidFileId(attachmentId)) {
      db.mutate(
        'DELETE FROM attachment_removals WHERE file_id = ? AND attachment_id = ?',
        [fileId, attachmentId],
      );
      throw new Error('Refused a removal record with an invalid id');
    }
    const { changes } = db.mutate(
      'DELETE FROM attachment_removals WHERE file_id = ? AND attachment_id = ? AND marked_at <= ?',
      [fileId, attachmentId, cutoff],
    );
    if (changes === 0) {
      return false;
    }
    try {
      await fs.unlink(getPathForAttachment(fileId, attachmentId));
    } catch (err) {
      if (isMissing(err)) {
        return false;
      }
      db.mutate(
        'INSERT OR REPLACE INTO attachment_removals (file_id, attachment_id, marked_at) VALUES (?, ?, ?)',
        [fileId, attachmentId, Date.now()],
      );
      throw err;
    }
    console.info(
      `Deleted removed attachment ${attachmentId} of budget ${fileId}, ${ageInDays(row.marked_at, now)} days after removal`,
    );
    return true;
  }

  // A deleted budget's whole folder: the one recursive delete, so it is confined
  const root = attachmentsRoot();
  const dir = isValidFileId(fileId) ? getPathForAttachmentsDir(fileId) : null;
  // Strictly inside: the attachments root itself doesn't start with root + sep
  if (dir === null || !dir.startsWith(root + sep)) {
    db.mutate('DELETE FROM budget_removals WHERE file_id = ?', [fileId]);
    throw new Error('Refused to remove a folder for an invalid budget id');
  }
  const { changes } = db.mutate(
    'DELETE FROM budget_removals WHERE file_id = ? AND marked_at <= ?',
    [fileId, cutoff],
  );
  if (changes === 0) {
    return false;
  }
  // Re-check and rename with no await between them: the server is one Node
  // process, so no upload can run in between. A missing row means the budget
  // is gone; only an existing, undeleted row counts as restored.
  const file = db.first('SELECT deleted FROM files WHERE id = ?', [fileId]);
  if (file && !file.deleted) {
    console.log(`Kept the documents of budget ${fileId}: it is not deleted`);
    return false;
  }
  const tombstone = resolve(
    root,
    `${TOMBSTONE_PREFIX}${fileId}-${randomBytes(4).toString('hex')}`,
  );
  try {
    renameSync(dir, tombstone);
  } catch (err) {
    if (isMissing(err)) {
      return false;
    }
    db.mutate(
      'INSERT OR REPLACE INTO budget_removals (file_id, marked_at) VALUES (?, ?)',
      [fileId, Date.now()],
    );
    throw err;
  }
  // A failed delete leaves the tombstone for the next run's sweep
  await fs.rm(tombstone, { recursive: true, force: true });
  console.info(
    `Deleted the documents of deleted budget ${fileId}, ${ageInDays(row.marked_at, now)} days after deletion`,
  );
  return true;
}

export async function runAttachmentCleanup(now = Date.now()) {
  if (running) {
    return;
  }
  running = true;
  let deleted = 0;
  let failed = 0;
  try {
    const days = config.get('attachments.orphanRetentionDays');
    if (days > 0) {
      const cutoff = now - days * DAY;
      failed += await sweepTombstones();
      const rows: Candidate[] = getAccountDb().all(
        `SELECT file_id, attachment_id, marked_at FROM attachment_removals WHERE marked_at <= ?
         UNION ALL
         SELECT file_id, NULL, marked_at FROM budget_removals WHERE marked_at <= ?
         ORDER BY marked_at LIMIT ?`,
        [cutoff, cutoff, RUN_LIMIT],
      );
      for (const row of rows) {
        try {
          if (await deleteCandidate(row, cutoff, now)) {
            deleted++;
          }
        } catch (err) {
          failed++;
          console.log(
            `Attachment cleanup could not delete a document of budget ${row.file_id}`,
            err,
          );
        }
      }
    }
    lastCleanup = {
      at: now,
      deleted,
      result: failed > 0 ? 'partial' : 'ok',
    };
  } catch (err) {
    console.log('Attachment cleanup failed', err);
    lastCleanup = { at: now, deleted, result: 'error' };
  } finally {
    running = false;
  }
}

// First run a minute after start, then daily; the timers never keep the
// process alive and a run never throws
export function startAttachmentCleanup() {
  setTimeout(() => {
    void runAttachmentCleanup();
    setInterval(() => void runAttachmentCleanup(), DAY).unref();
  }, 60 * 1000).unref();
}

type DiskTotals = {
  bytes: number | null;
  removalBytes: number | null;
  removalCount: number | null;
};

let metricsCache: { at: number; totals: Promise<DiskTotals> } | null = null;

async function walk(): Promise<DiskTotals> {
  const root = attachmentsRoot();
  const sizes = new Map<string, number>();
  let bytes = 0;
  const budgets = await fs.readdir(root).catch(err => {
    if (isMissing(err)) {
      return [];
    }
    throw err;
  });
  for (const budget of budgets) {
    const dir = resolve(root, budget);
    const names = await fs.readdir(dir).catch(() => []);
    for (const name of names) {
      // A temp file can be renamed away between readdir and stat
      const stats = await fs.stat(resolve(dir, name)).catch(() => null);
      if (stats?.isFile()) {
        bytes += stats.size;
        sizes.set(`${budget}/${name}`, stats.size);
      }
    }
  }

  let removalBytes = 0;
  let removalCount = 0;
  for (const row of getAccountDb().all(
    'SELECT file_id, attachment_id FROM attachment_removals',
  )) {
    const size = sizes.get(`${row.file_id}/${row.attachment_id}.blob`);
    if (size !== undefined) {
      removalBytes += size;
      removalCount++;
    }
  }
  return { bytes, removalBytes, removalCount };
}

// One walk shared by concurrent requests and cached for a minute, failures
// included, so unauthenticated /metrics calls can't multiply disk work
export async function attachmentMetrics() {
  if (!metricsCache || Date.now() - metricsCache.at >= METRICS_TTL) {
    metricsCache = {
      at: Date.now(),
      totals: walk().catch(err => {
        console.log('Could not total stored attachments', err);
        return { bytes: null, removalBytes: null, removalCount: null };
      }),
    };
  }
  return { ...(await metricsCache.totals), lastCleanup };
}

export function resetAttachmentMetrics() {
  metricsCache = null;
}
