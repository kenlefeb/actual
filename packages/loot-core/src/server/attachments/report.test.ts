import * as asyncStorage from '#platform/server/asyncStorage';
import { onSyncEvent } from '#server/attachments/app';
import * as cloudStorage from '#server/cloud-storage';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import * as prefs from '#server/prefs';
import { attachmentServer } from '#server/tests/mockAttachmentServer';
import type { ServerEvents } from '#types/server-events';

vi.mock('#platform/server/fetch', () => ({
  fetch: (url: string, init?: RequestInit) => attachmentServer.fetch(url, init),
}));

let fileNumber = 0;

beforeEach(async () => {
  attachmentServer.reset();
  await global.emptyDatabase()();
  await loadMappings();
  await prefs.loadPrefs();
  // A fresh id per test: the app remembers which budgets it has reported
  await prefs.savePrefs({ cloudFileId: `file-${++fileNumber}` });
  await asyncStorage.setItem('user-token', 'token');
});

async function addRow(id: string, tombstone = 0) {
  await db.insert('transaction_attachments', {
    id,
    transaction_id: 'txn',
    name: `${id}.pdf`,
    mime: 'application/pdf',
    size: 1,
    sha256: 'x',
    encrypt_meta: null,
    created_at: '2026-11-05T00:00:00.000Z',
    tombstone,
  });
}

const applied: ServerEvents['sync-event'] = {
  type: 'applied',
  tables: ['transaction_attachments'],
};
const success: ServerEvents['sync-event'] = { type: 'success', tables: [] };

// A budget's first sync in the session reports; run it so the next sync is a
// plain one
async function firstSync() {
  await onSyncEvent(success);
  attachmentServer.reset();
}

function fileId() {
  return prefs.getPrefs().cloudFileId;
}

describe('reporting removed attachments', () => {
  it('reports after a sync that followed an attachment change', async () => {
    await firstSync();
    await addRow('gone', 1);

    await onSyncEvent(applied);
    await onSyncEvent(success);

    expect(attachmentServer.reports).toEqual([
      { fileId: fileId(), removed: ['gone'], live: [] },
    ]);
  });

  it('reports nothing after a plain sync', async () => {
    await firstSync();
    await addRow('gone', 1);

    await onSyncEvent({ type: 'applied', tables: ['transactions'] });
    await onSyncEvent(success);

    expect(attachmentServer.recordsRequests).toEqual([]);
    expect(attachmentServer.reports).toEqual([]);
  });

  it('reports after the first sync of a budget in the session, once', async () => {
    await addRow('gone', 1);

    await onSyncEvent(success);
    await onSyncEvent(success);

    expect(attachmentServer.reports).toHaveLength(1);
  });

  it('reports after a budget upload', async () => {
    await firstSync();
    await addRow('gone', 1);

    await cloudStorage.notifyUploaded();

    expect(attachmentServer.reports).toHaveLength(1);
  });

  it('sends as live only the live ids that are recorded', async () => {
    await firstSync();
    await addRow('back');
    await addRow('fine');
    attachmentServer.records.add('back');
    attachmentServer.records.add('stale');

    await onSyncEvent(applied);
    await onSyncEvent(success);

    expect(attachmentServer.reports).toEqual([
      { fileId: fileId(), removed: [], live: ['back'] },
    ]);
  });

  it('sends as removed only the removed ids not yet recorded', async () => {
    await firstSync();
    await addRow('new', 1);
    await addRow('known', 1);
    attachmentServer.records.add('known');

    await onSyncEvent(applied);
    await onSyncEvent(success);

    expect(attachmentServer.reports.map(r => r.removed)).toEqual([['new']]);
  });

  it('names the budget in the header and pages through the records', async () => {
    await firstSync();
    for (let i = 0; i < 2500; i++) {
      attachmentServer.records.add(`r${String(i).padStart(5, '0')}`);
    }
    await addRow('r00007');

    await onSyncEvent(applied);
    await onSyncEvent(success);

    expect(attachmentServer.recordsRequests).toEqual([
      { after: null, fileId: fileId() },
      { after: 'r00999', fileId: fileId() },
      { after: 'r01999', fileId: fileId() },
    ]);
    expect(attachmentServer.reports[0].live).toEqual(['r00007']);
  });

  it('batches each list in 1000 ids', async () => {
    await firstSync();
    for (let i = 0; i < 2100; i++) {
      await addRow(`removed-${i}`, 1);
    }

    await onSyncEvent(applied);
    await onSyncEvent(success);

    expect(attachmentServer.reports.map(r => r.removed.length)).toEqual([
      1000, 1000, 100,
    ]);
  });

  it('sends nothing for a budget without a sync server', async () => {
    await prefs.savePrefs({ cloudFileId: undefined });
    await addRow('gone', 1);

    await onSyncEvent(applied);
    await onSyncEvent(success);

    expect(attachmentServer.recordsRequests).toEqual([]);
    expect(attachmentServer.reports).toEqual([]);
  });

  it('sends nothing when there is nothing to report', async () => {
    await onSyncEvent(success);

    expect(attachmentServer.reports).toEqual([]);
  });

  it.each([404, 500])(
    'drops the report without an error when the records answer %i, and sends it after a later sync',
    async status => {
      await addRow('gone', 1);
      attachmentServer.recordsStatus = status;

      await expect(onSyncEvent(success)).resolves.toBeUndefined();
      expect(attachmentServer.reports).toEqual([]);

      attachmentServer.recordsStatus = null;
      await onSyncEvent(success);
      expect(attachmentServer.reports).toHaveLength(1);
    },
  );

  it('drops a failed report and sends it after the next sync', async () => {
    await addRow('gone', 1);
    attachmentServer.reportStatus = 500;

    await expect(onSyncEvent(success)).resolves.toBeUndefined();

    attachmentServer.reportStatus = null;
    await onSyncEvent(success);
    expect(attachmentServer.reports).toHaveLength(1);
  });

  it('survives a server that does not answer', async () => {
    await addRow('gone', 1);
    attachmentServer.offline = true;

    await expect(onSyncEvent(success)).resolves.toBeUndefined();
  });
  it('sends nothing when the budget changed while it waited for the records', async () => {
    await addRow('gone', 1);
    attachmentServer.onRecords = () =>
      prefs.savePrefs({ cloudFileId: 'another-budget' });

    await onSyncEvent(success);

    expect(attachmentServer.reports).toEqual([]);
  });

  it.each([
    ['a repeated cursor', () => ({ ids: [], after: 'a' })],
    [
      'a cursor that goes back',
      (n: number) => ({ ids: [], after: n % 2 ? 'a' : 'b' }),
    ],
    ['a numeric cursor', () => ({ ids: [], after: 5 })],
    ['an empty cursor', () => ({ ids: [], after: '' })],
  ])('sends nothing and stops paging for %s', async (_name, recordsPage) => {
    await addRow('gone', 1);
    attachmentServer.recordsPage = recordsPage;

    await onSyncEvent(success);

    expect(attachmentServer.reports).toEqual([]);
    expect(attachmentServer.recordsRequests.length).toBeLessThanOrEqual(3);
  });

  it('stops after 100 pages and sends nothing', async () => {
    await addRow('gone', 1);
    attachmentServer.recordsPage = n => ({ ids: [], after: `c${n}` });

    await onSyncEvent(success);

    expect(attachmentServer.recordsRequests).toHaveLength(100);
    expect(attachmentServer.reports).toEqual([]);
  });

  it('a failing upload listener never rejects', async () => {
    cloudStorage.onUpload(() => {
      throw new Error('boom');
    });

    await expect(cloudStorage.notifyUploaded()).resolves.toBeUndefined();
  });
});
