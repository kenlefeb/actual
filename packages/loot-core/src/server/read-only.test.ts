// A read-only session writes nothing (api-read-only-mode spec). Each test
// plays one session against the mock sync server and counts what reached it.
// The normal-session controls run the same steps with the flag off.
import { Timestamp } from '@actual-app/crdt';

import * as asyncStorage from '#platform/server/asyncStorage';
import { aqlQuery } from '#server/aql';
import * as cloudStorage from '#server/cloud-storage';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { app as paychecksApp } from '#server/paychecks/app';
import * as prefs from '#server/prefs';
import { setReadOnly } from '#server/read-only';
import {
  createSchedule,
  app as schedulesApp,
  waitOnSchedulesService,
} from '#server/schedules/app';
import { applyMessages, fullSync, setSyncingMode } from '#server/sync';
import * as encoder from '#server/sync/encoder';
import { listen, unlisten } from '#server/sync/migrate';
import { isError } from '#server/sync/utils';
import * as mockSyncServer from '#server/tests/mockSyncServer';
import { loadRules } from '#server/transactions/transaction-rules';
import { q } from '#shared/query';

beforeEach(async () => {
  mockSyncServer.reset();
  setSyncingMode('enabled');
  await global.emptyDatabase()();
  await prefs.loadPrefs();
  await prefs.savePrefs({ groupId: 'group', cloudFileId: 'cloud-file' });
  await loadMappings();
  await loadRules();
  schedulesApp.startServices();
});

afterEach(async () => {
  await schedulesApp.stopServices();
  setReadOnly(false);
  unlisten();
  setSyncingMode('disabled');
  vi.restoreAllMocks();
});

const settle = () => new Promise(resolve => setTimeout(resolve, 20));
const pushed = () => mockSyncServer.getMessages().length;

// An auto-post schedule that is due today (2017-01-01 in tests)
async function dueSchedule() {
  const account = await db.insertAccount({
    name: 'Checking',
    offbudget: 0,
    closed: 0,
  });
  const id = await createSchedule({
    schedule: { posts_transaction: true },
    conditions: [
      { op: 'is', field: 'account', value: account },
      { op: 'is', field: 'amount', value: -10000 },
      { op: 'is', field: 'date', value: '2017-01-01' },
    ],
  });
  const row = await db.first<{ id: string }>(
    'SELECT id FROM schedules_next_date WHERE schedule_id = ?',
    [id],
  );
  await db.update('schedules_next_date', {
    id: row!.id,
    local_next_date: 20170101,
    local_next_date_ts: Date.now(),
    base_next_date: 20170101,
    base_next_date_ts: Date.now(),
  });
  return id;
}

async function postedFor(schedule: string) {
  const { data } = await aqlQuery(
    q('transactions').filter({ schedule }).select(['id']),
  );
  return data.length;
}

async function syncSucceeds(tables: string[] = []) {
  schedulesApp.events.emit('sync', { type: 'success', tables });
  await waitOnSchedulesService();
  await settle();
}

describe('schedule auto-posting', () => {
  it('A read-only session posts nothing', async () => {
    const id = await dueSchedule();
    const before = pushed();
    setReadOnly(true);

    await syncSucceeds();

    expect(await postedFor(id)).toBe(0);
    expect(prefs.getPrefs()?.lastScheduleRun).toBeUndefined();
    expect(pushed()).toBe(before);
  });

  it('A normal session still posts', async () => {
    const id = await dueSchedule();
    const before = pushed();

    await syncSucceeds();

    expect(await postedFor(id)).toBe(1);
    expect(prefs.getPrefs()?.lastScheduleRun).toBe('2017-01-01');
    expect(pushed()).toBeGreaterThan(before);
  });
});

describe('paycheck reconcile', () => {
  // A paycheck whose deposit schedule was deleted, as an edit from another
  // device leaves it; the reconcile restores it
  async function paycheckWithDeletedSchedule() {
    for (const id of ['clearing', 'checking']) {
      await db.insertAccount({ id, name: id, offbudget: 0 });
      await db.insertPayee({
        id: `transfer-${id}`,
        name: '',
        transfer_acct: id,
      });
    }
    await db.insertPayee({ id: 'acme', name: 'Acme' });
    await db.update('preferences', { id: 'flags.paychecks', value: 'true' });
    await paychecksApp.handlers['paycheck-create']({
      name: 'Acme',
      definition: {
        payee: 'acme',
        clearingAccount: 'clearing',
        date: { start: '2016-12-01', frequency: 'monthly' },
        weekendSolveMode: 'before',
        grossAmount: 300000,
        incomeCategory: '',
        deductions: [],
        deposits: [
          { id: 'checking', account: 'checking', kind: 'remainder', value: 0 },
        ],
      },
    });
    const [paycheck] = await paychecksApp.handlers['paychecks-get']();
    const schedule = paycheck.definition.deposits[0].schedule!;
    await db.update('schedules', { id: schedule, tombstone: 1 });
    return schedule;
  }
  const tombstone = async (id: string) =>
    (
      await db.first<{ tombstone: number }>(
        'SELECT tombstone FROM schedules WHERE id = ?',
        [id],
      )
    )?.tombstone;

  it('A read-only session does not reconcile paycheck edits', async () => {
    const schedule = await paycheckWithDeletedSchedule();
    const before = pushed();
    setReadOnly(true);

    await syncSucceeds(['schedules']);

    expect(await tombstone(schedule)).toBe(1);
    expect(pushed()).toBe(before);
  });

  it('A normal session still reconciles', async () => {
    await paycheckWithDeletedSchedule();
    const before = pushed();

    await syncSucceeds(['schedules']);

    expect(pushed()).toBeGreaterThan(before);
  });
});

describe('budget file upload', () => {
  // possiblyUpload reaches upload(), whose first step reads the user token
  function recordUploads() {
    const read = vi.spyOn(asyncStorage, 'getItem');
    return () => read.mock.calls.filter(([key]) => key === 'user-token').length;
  }
  const overdue = () => prefs.savePrefs({ lastUploaded: '2016-01-01' });

  it('A read-only session uploads no budget file', async () => {
    await overdue();
    const uploads = recordUploads();
    setReadOnly(true);

    await cloudStorage.possiblyUpload();

    expect(uploads()).toBe(0);
    expect(prefs.getPrefs()?.lastUploaded).toBe('2016-01-01');
  });

  it('A normal session still uploads', async () => {
    await overdue();
    const uploads = recordUploads();

    await cloudStorage.possiblyUpload();

    expect(uploads()).toBe(1);
  });
});

describe('parent-id repair', () => {
  // A child transaction that arrives without its parent id
  const child = () =>
    applyMessages([
      {
        dataset: 'transactions',
        row: 'trans1/child1',
        column: 'amount',
        value: 4500,
        timestamp: Timestamp.send()!,
      },
      {
        dataset: 'transactions',
        row: 'trans1/child1',
        column: 'isChild',
        value: 1,
        timestamp: Timestamp.send()!,
      },
    ]);
  const parentOf = async () =>
    (
      await db.first<{ parent_id: string | null }>(
        "SELECT parent_id FROM transactions WHERE id = 'trans1/child1'",
      )
    )?.parent_id ?? null;

  it('A read-only session sends no repair messages', async () => {
    setReadOnly(true);
    listen();
    const before = pushed();

    await child();
    await settle();

    expect(await parentOf()).toBe(null);
    expect(pushed()).toBe(before);
  });

  it('A normal session still repairs', async () => {
    listen();

    await child();
    await settle();

    expect(await parentOf()).toBe('trans1');
  });
});

describe('pulling', () => {
  it('A read-only session still pulls', async () => {
    await prefs.savePrefs({ lastSyncedTimestamp: Timestamp.zero.toString() });
    await (
      mockSyncServer.handlers as Record<
        string,
        (data: Uint8Array) => Promise<Uint8Array>
      >
    )['/sync/sync'](
      await encoder.encode(
        'group',
        'client',
        Timestamp.parse('1970-01-01T01:17:37.000Z-0000-0000testinguuid2')!,
        [
          {
            dataset: 'transactions',
            row: 'foo',
            column: 'amount',
            value: 'N:3200',
            timestamp: Timestamp.parse(
              '1970-01-02T05:17:36.789Z-0000-0000testinguuid2',
            )!,
          },
        ],
      ),
    );
    setReadOnly(true);

    const result = await fullSync();

    if (isError(result)) throw result.error;
    expect(result?.messages.length).toBe(1);
    const row = await db.first<{ amount: number }>(
      "SELECT amount FROM transactions WHERE id = 'foo'",
    );
    expect(row?.amount).toBe(3200);
  });
});
