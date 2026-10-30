// Edits on two devices (paychecks spec, "Edits on two devices" and
// "Clean-up after edits on two devices"). Each test plays two devices in one
// process: it snapshots the database, runs one device's edit, keeps that
// device's sync messages, restores the snapshot for the other device, and
// applies the kept messages through the normal sync path.
import { Timestamp } from '@actual-app/crdt';

import * as sqlite from '#platform/server/sqlite';
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { getNormalizedSchedules } from '#server/forecast/forecast-schedules';
import { runMutator } from '#server/mutators';
import * as prefs from '#server/prefs';
import {
  app as schedulesApp,
  waitOnSchedulesService,
} from '#server/schedules/app';
import { applyMessages, setSyncingMode } from '#server/sync';
import { deserializeValue } from '#server/sync/serialization';
import * as mockSyncServer from '#server/tests/mockSyncServer';
import { loadRules } from '#server/transactions/transaction-rules';
import { undo } from '#server/undo';
import { setBusinessCalendars } from '#shared/business-calendar-lookup';
import { businessCalendarPresets } from '#shared/business-calendar-presets';
import { currentDay } from '#shared/months';
import { q } from '#shared/query';
import { setScheduleDates } from '#shared/schedule-date-lookup';
import type { PaycheckDefinition, PaycheckEntity } from '#types/models';

import {
  app,
  backfillPaycheckSchedules,
  isPaychecksOn,
  reconcilePaycheckSchedules,
} from './app';

const handlers = app.handlers;
const NET_PAY = 300000;

const federal = {
  id: 'federal',
  name: 'U.S. Federal Holidays',
  ...businessCalendarPresets[0].calendar,
};

type Deposit = PaycheckDefinition['deposits'][number];

const savings: Deposit = {
  id: 'savings',
  account: 'savings',
  kind: 'fixed',
  value: 50000,
};
const checking: Deposit = {
  id: 'checking',
  account: 'checking',
  kind: 'remainder',
  value: 0,
};
const travel: Deposit = {
  id: 'travel',
  account: 'travel',
  kind: 'fixed',
  value: 10000,
};
const emergency = (fields: Partial<Deposit> = {}): Deposit => ({
  id: 'emergency',
  account: 'emergency',
  kind: 'fixed',
  value: 20000,
  ...fields,
});

// The 15th of each month, moved before non-business days
const MID_MONTH: PaycheckDefinition['date'] = {
  start: '2026-11-01',
  frequency: 'monthly',
  patterns: [{ type: 'day', value: 15 }],
};

const definition = (
  deposits: Deposit[],
  date = MID_MONTH,
): PaycheckDefinition => ({
  payee: 'acme',
  clearingAccount: 'clearing',
  date,
  weekendSolveMode: 'before',
  grossAmount: NET_PAY,
  incomeCategory: '',
  deductions: [],
  deposits,
});

async function addAccount(id: string) {
  await db.insertAccount({ id, name: id, offbudget: 0 });
  await db.insertPayee({ id: `transfer-${id}`, name: '', transfer_acct: id });
}

const acme = async (): Promise<PaycheckEntity | undefined> =>
  (await handlers['paychecks-get']())[0];

async function createAcme(
  deposits: Deposit[] = [savings, checking],
  date = MID_MONTH,
) {
  await handlers['paycheck-create']({
    name: 'Acme',
    definition: definition(deposits, date),
  });
}

async function saveAcme(deposits: Deposit[]) {
  const paycheck = await acme();
  if (!paycheck) throw new Error('Missing paycheck');
  const scheduleOf = new Map(
    paycheck.definition.deposits.map(d => [d.id, d.schedule]),
  );
  await handlers['paycheck-update']({
    id: paycheck.id,
    name: 'Acme',
    definition: {
      ...paycheck.definition,
      // Deposits already listed keep their schedules, as the editor sends them
      deposits: deposits.map(d => ({ ...d, schedule: scheduleOf.get(d.id) })),
    },
  });
}

type ScheduleRow = {
  id: string;
  name: string;
  _account: string;
  _amount: number;
  tombstone: boolean;
};

async function activeSchedules(): Promise<ScheduleRow[]> {
  const { data } = await aqlQuery(
    q('schedules')
      .filter({ completed: false })
      .select(['id', 'name', '_account', '_amount', 'tombstone']),
  );
  return data;
}

// Reads a schedule whether or not it's deleted
async function scheduleById(id: string) {
  const row = await db.first<{ id: string; tombstone: number }>(
    'SELECT id, tombstone FROM schedules WHERE id = ?',
    [id],
  );
  return row && { id: row.id, tombstone: row.tombstone === 1 };
}

async function listedIds() {
  const paycheck = await acme();
  return new Set(
    paycheck
      ? [
          paycheck.definition.paySchedule,
          ...paycheck.definition.deposits.map(d => d.schedule),
        ]
      : [],
  );
}

async function strays() {
  const listed = await listedIds();
  return (await activeSchedules()).filter(
    s => s.name.startsWith('Acme') && !listed.has(s.id),
  );
}

async function depositTotal() {
  return (await activeSchedules())
    .filter(s => s.name.startsWith('Acme →'))
    .reduce((sum, s) => sum + s._amount, 0);
}

// Sets a deposit schedule's next date to today (2017-01-01 in tests)
async function dueToday(depositId: string) {
  const schedule = (await acme())!.definition.deposits.find(
    d => d.id === depositId,
  )!.schedule!;
  const row = await db.first<{ id: string }>(
    'SELECT id FROM schedules_next_date WHERE schedule_id = ?',
    [schedule],
  );
  const ts = Date.now();
  await db.update('schedules_next_date', {
    id: row!.id,
    local_next_date: 20170101,
    local_next_date_ts: ts,
    base_next_date: 20170101,
    base_next_date_ts: ts,
  });
}

// --- Two devices -----------------------------------------------------------

type Message = {
  timestamp: string;
  dataset: string;
  row: string;
  column: string;
  value: string;
};

const snapshot = () =>
  (db.getDatabase() as unknown as { serialize(): Buffer }).serialize();

async function restore(buffer: Buffer) {
  db.setDatabase(sqlite.openDatabase(buffer) as never);
  await loadMappings();
  await loadRules();
}

async function latestTimestamp() {
  return (
    (
      await db.first<{ t: string | null }>(
        'SELECT max(timestamp) as t FROM messages_crdt',
      )
    )?.t ?? ''
  );
}

function messagesSince(timestamp: string) {
  return db.all<Message>(
    'SELECT timestamp, dataset, row, column, value FROM messages_crdt WHERE timestamp > ? ORDER BY timestamp',
    [timestamp],
  );
}

// Messages from the other device, applied as a pulled sync applies them
async function receive(messages: Message[]) {
  await applyMessages(
    messages.map(m => ({
      ...m,
      timestamp: Timestamp.parse(m.timestamp)!,
      value: deserializeValue(m.value),
    })) as never,
  );
}

/**
 * Device B edits offline and device A edits locally, from the same state;
 * then B's messages reach A. A's writes are later, so A's definition wins.
 */
async function editOnTwoDevices(
  onB: () => Promise<void>,
  onA: () => Promise<void>,
) {
  const before = snapshot();
  const since = await latestTimestamp();
  await onB();
  const fromB = await messagesSince(since);
  const bState = snapshot();
  await restore(before);
  await onA();
  await receive(fromB);
  return { fromB, bState, since };
}

// The end of a full sync: the server emits `sync` and runs what it queued
async function syncFinished(
  type: 'success' | 'applied' = 'success',
  tables = ['paychecks', 'paycheck_schedules', 'schedules', 'rules'],
) {
  schedulesApp.events.emit('sync', { type, tables, syncDisabled: false });
  await runMutator(async () => undefined);
}

// What `preferences/save` writes (importing that app loads all of main.ts)
async function setPaychecksFlag(value: 'true' | 'false') {
  await db.update('preferences', { id: 'flags.paychecks', value });
}

// Tests that need an earlier today set it in a beforeAll, since the CRDT
// clock can't move back once the setup below has written at this date
let today = new Date(2026, 10, 1);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(today);
  mockSyncServer.reset();
  // Records sync messages without syncing them, as a device does offline
  setSyncingMode('offline');
  await global.emptyDatabase()();
  await prefs.loadPrefs();
  await loadMappings();
  await loadRules();
  schedulesApp.startServices();
  setBusinessCalendars([federal]);
  for (const id of ['clearing', 'checking', 'savings', 'travel', 'emergency']) {
    await addAccount(id);
  }
  await db.insertPayee({ id: 'acme', name: 'Acme' });
  await db.update('preferences', {
    id: 'flags.businessCalendars',
    value: 'true',
  });
});

afterEach(async () => {
  setSyncingMode('disabled');
  await schedulesApp.stopServices();
  setBusinessCalendars([]);
  setScheduleDates([]);
  vi.useRealTimers();
});

describe('Edits on two devices', () => {
  it('Both devices add a deposit', async () => {
    await createAcme();
    await editOnTwoDevices(
      () => saveAcme([savings, checking, emergency()]),
      () => saveAcme([savings, checking, travel]),
    );
    await syncFinished();

    expect((await acme())?.definition.deposits.map(d => d.account)).toEqual([
      'savings',
      'checking',
      'travel',
    ]);
    expect(await strays()).toEqual([]);
    expect(await depositTotal()).toBe(NET_PAY);
  });

  it('Saving the paycheck again cleans up before any sync', async () => {
    await createAcme();
    await editOnTwoDevices(
      () => saveAcme([savings, checking, emergency()]),
      () => saveAcme([savings, checking, travel]),
    );
    expect(await strays()).toHaveLength(1);
    // Device A saves again without a sync: the original repro's last step
    await saveAcme((await acme())!.definition.deposits);

    expect(await strays()).toEqual([]);
    expect(await depositTotal()).toBe(NET_PAY);
  });

  it('Forecasts count each deposit once', async () => {
    await createAcme();
    await editOnTwoDevices(
      () => saveAcme([savings, checking, emergency()]),
      () => saveAcme([savings, checking, travel]),
    );
    await syncFinished();

    const forecast = (await getNormalizedSchedules()).filter(s =>
      s.name?.startsWith('Acme →'),
    );
    expect(forecast.filter(s => s._account === 'emergency')).toEqual([]);
    expect(forecast.map(s => s._account).sort()).toEqual([
      'checking',
      'savings',
      'travel',
    ]);
  });

  it('A later sync on the same day', async () => {
    await createAcme();
    await prefs.savePrefs({ lastScheduleRun: currentDay() });
    await editOnTwoDevices(
      () => saveAcme([savings, checking, emergency()]),
      () => saveAcme([savings, checking, travel]),
    );
    await syncFinished();

    expect(await strays()).toEqual([]);
  });

  it('closing the budget waits for a clean-up a sync started', async () => {
    await createAcme();
    await editOnTwoDevices(
      () => saveAcme([savings, checking, emergency()]),
      () => saveAcme([savings, checking, travel]),
    );
    expect(await strays()).toHaveLength(1);
    schedulesApp.events.emit('sync', {
      type: 'success',
      tables: ['paychecks'],
      syncDisabled: false,
    });
    // What closeBudget waits on before closing the database
    await waitOnSchedulesService();

    expect(await strays()).toEqual([]);
  });

  it('Saved again while the other device cleaned up', async () => {
    await createAcme();
    const { bState, since } = await editOnTwoDevices(
      () => saveAcme([savings, checking, emergency()]),
      () => saveAcme([savings, checking, travel]),
    );
    const emergencyId = (await strays()).find(
      s => s._account === 'emergency',
    )?.id;
    expect(emergencyId).toBeDefined();
    // Device A cleans up the stray
    await syncFinished();
    const fromA = await messagesSince(since);

    // Device B, before receiving that, saves Acme again with Emergency listed
    await restore(bState);
    await saveAcme([savings, checking, emergency()]);

    // B receives A's edit and clean-up
    await receive(fromA);
    await syncFinished();
    expect(await scheduleById(emergencyId!)).toMatchObject({
      tombstone: false,
    });
    expect(await strays()).toEqual([]);
    expect(await depositTotal()).toBe(NET_PAY);
  });

  it('Deleted on one device, edited on the other', async () => {
    await createAcme();
    await editOnTwoDevices(
      () => saveAcme([savings, checking, emergency()]),
      async () => {
        const paycheck = await acme();
        await handlers['paycheck-delete']({ id: paycheck!.id });
      },
    );
    await syncFinished();

    expect(await acme()).toBeUndefined();
    expect(
      (await activeSchedules()).filter(s => s.name.startsWith('Acme')),
    ).toEqual([]);
  });
});

describe('Edits on two devices, with schedules due', () => {
  // The schedules service's "today", and the next dates it computes, are
  // pinned to 2017-01-01 in tests. Pay on the 1st, moved before weekends:
  // Sunday, January 1, 2017 moves to Friday, December 30, which is overdue.
  beforeAll(() => {
    today = new Date(2016, 11, 29);
  });
  afterAll(() => {
    today = new Date(2026, 10, 1);
  });

  it('Nothing posts before the clean-up', async () => {
    const autoSavings = { ...savings, postAutomatically: true };
    await createAcme([autoSavings, checking], {
      start: '2016-12-01',
      frequency: 'monthly',
      patterns: [{ type: 'day', value: 1 }],
    });
    await editOnTwoDevices(
      async () => {
        await saveAcme([
          autoSavings,
          checking,
          emergency({ postAutomatically: true }),
        ]);
        // A new schedule's first date is after today, so let the Emergency
        // deposit's date arrive on device B, as it would after a few days
        await dueToday('emergency');
      },
      () => saveAcme([autoSavings, checking, travel]),
    );
    // Keep the pay schedule out of the service's run: posting it would move
    // its deposits, the stray too, to the next pay date before they're reached
    await db.update('accounts', { id: 'clearing', closed: 1 });
    await prefs.savePrefs({ lastScheduleRun: '2016-12-01' });
    await syncFinished();

    const posted = await db.all<{ acct: string }>(
      'SELECT acct FROM transactions WHERE tombstone = 0 AND isParent = 0',
    );
    // The schedules service ran: the listed Savings deposit posted
    expect(posted.map(t => t.acct)).toContain('savings');
    expect(posted.map(t => t.acct)).not.toContain('emergency');
    expect(await strays()).toEqual([]);
  });
});

describe('Clean-up after edits on two devices', () => {
  it('A deposit that already posted', async () => {
    vi.setSystemTime(new Date(2026, 10, 13));
    await createAcme();
    await editOnTwoDevices(
      async () => {
        await saveAcme([
          savings,
          checking,
          emergency({ postAutomatically: true }),
        ]);
        const paycheck = await acme();
        const schedule = paycheck!.definition.deposits.find(
          d => d.id === 'emergency',
        )!.schedule!;
        await schedulesApp.handlers['schedule/post-transaction']({
          id: schedule,
        });
      },
      () => saveAcme([savings, checking, travel]),
    );
    await prefs.savePrefs({ lastScheduleRun: currentDay() });
    await syncFinished();

    expect(await strays()).toEqual([]);
    const emergencyTransfers = await db.all<{ amount: number }>(
      "SELECT amount FROM transactions WHERE acct = 'emergency' AND tombstone = 0",
    );
    expect(emergencyTransfers.map(t => t.amount)).toEqual([20000]);
  });

  it("A user's own schedule relative to the pay date", async () => {
    await createAcme();
    const pay = (await acme())!.definition.paySchedule!;
    const gym = await schedulesApp.handlers['schedule/create']({
      schedule: { name: 'Gym' },
      conditions: [
        { op: 'is', field: 'account', value: 'checking' },
        { op: 'is', field: 'amount', value: -3000 },
        {
          op: 'isapprox',
          field: 'date',
          value: {
            relativeTo: {
              scheduleId: pay,
              offset: 1,
              unit: 'business-days',
              direction: 'after',
            },
          },
        },
      ],
    });
    await editOnTwoDevices(
      () => saveAcme([savings, checking, emergency()]),
      () => saveAcme([savings, checking, travel]),
    );
    await syncFinished();

    expect(await scheduleById(gym)).toMatchObject({ tombstone: false });
  });
});

describe('Deleted while paychecks were off', () => {
  async function deleteCheckingWhileOff() {
    await createAcme();
    await setPaychecksFlag('false');
    const id = (await acme())!.definition.deposits.find(
      d => d.id === 'checking',
    )!.schedule!;
    await schedulesApp.handlers['schedule/delete']({ id });
    // A sync while the feature is off doesn't bring it back
    await syncFinished();
    expect(await scheduleById(id)).toMatchObject({ tombstone: true });
    return id;
  }

  it('is restored when the feature is turned on on this device', async () => {
    const id = await deleteCheckingWhileOff();
    await setPaychecksFlag('true');
    // A local preference write emits `applied` with the preferences table
    await syncFinished('applied', ['preferences']);
    expect(await scheduleById(id)).toMatchObject({ tombstone: false });
  });

  it('is restored when the feature is turned on on another device', async () => {
    const id = await deleteCheckingWhileOff();
    await applyMessages([
      {
        dataset: 'preferences',
        row: 'flags.paychecks',
        column: 'value',
        value: 'true',
        timestamp: Timestamp.send()!,
      },
    ] as never);
    await syncFinished('success', ['preferences']);
    expect(await scheduleById(id)).toMatchObject({ tombstone: false });
  });
});

describe('Which paycheck generated each schedule', () => {
  const liveMappings = () =>
    db.all<{ id: string; paycheck: string }>(
      'SELECT id, paycheck FROM paycheck_schedules WHERE tombstone = 0 ORDER BY id',
    );

  it('records every schedule a paycheck creates', async () => {
    await createAcme();
    const paycheck = (await acme())!;
    const listed = [...(await listedIds())].sort();
    expect(await liveMappings()).toEqual(
      listed.map(id => ({ id, paycheck: paycheck.id })),
    );
  });

  it('drops the record of a removed deposit and of a deleted paycheck', async () => {
    await createAcme([savings, checking, travel]);
    await saveAcme([savings, checking]);
    expect((await liveMappings()).map(m => m.id).sort()).toEqual(
      [...(await listedIds())].sort(),
    );

    await handlers['paycheck-delete']({ id: (await acme())!.id });
    expect(await liveMappings()).toEqual([]);
  });

  it('backfills records for a paycheck saved before this change', async () => {
    await createAcme();
    const expected = await liveMappings();
    // A paycheck from before the change has no records
    db.runQuery('DELETE FROM paycheck_schedules');
    await backfillPaycheckSchedules();
    expect(await liveMappings()).toEqual(expected);

    const writes = () =>
      db.first<{ n: number }>(
        "SELECT count(*) AS n FROM messages_crdt WHERE dataset = 'paycheck_schedules'",
      );
    const before = await writes();
    await backfillPaycheckSchedules();
    expect(await writes()).toEqual(before);
  });

  it('undo restores the records with the paycheck', async () => {
    await createAcme();
    const before = await liveMappings();
    expect(before).toHaveLength(3);
    await handlers['paycheck-delete']({ id: (await acme())!.id });
    await undo();
    expect(await liveMappings()).toEqual(before);

    await undo();
    expect(await liveMappings()).toEqual([]);
  });
});

describe('reconcilePaycheckSchedules', () => {
  const depositSchedule = async (depositId: string) =>
    (await acme())!.definition.deposits.find(d => d.id === depositId)!
      .schedule!;

  // Points a deposit at a schedule id that doesn't exist, as when the row
  // never arrived from another device
  async function listMissingSchedule(depositId: string) {
    const paycheck = (await acme())!;
    await db.update('paychecks', {
      id: paycheck.id,
      definition: JSON.stringify({
        ...paycheck.definition,
        deposits: paycheck.definition.deposits.map(d =>
          d.id === depositId ? { ...d, schedule: 'never-arrived' } : d,
        ),
      }),
    });
  }

  it('deletes only mapped strays and keeps their posted transactions', async () => {
    await createAcme();
    await editOnTwoDevices(
      () => saveAcme([savings, checking, emergency()]),
      () => saveAcme([savings, checking, travel]),
    );
    const stray = (await strays())[0];
    await db.insertTransaction({
      id: 'posted-emergency',
      account: 'emergency',
      date: '2026-11-13',
      amount: 20000,
      schedule: stray.id,
    });

    await reconcilePaycheckSchedules();

    expect(await strays()).toEqual([]);
    expect(await scheduleById(stray.id)).toMatchObject({ tombstone: true });
    expect(await db.getTransaction('posted-emergency')).toMatchObject({
      schedule: stray.id,
      tombstone: false,
    });
  });

  it('restores a deleted schedule a paycheck lists, keeping its id and links', async () => {
    await createAcme();
    const id = await depositSchedule('checking');
    await db.insertTransaction({
      id: 'posted-checking',
      account: 'checking',
      date: '2026-11-13',
      amount: 250000,
      schedule: id,
    });
    await schedulesApp.handlers['schedule/delete']({ id });

    await reconcilePaycheckSchedules();

    expect(await scheduleById(id)).toMatchObject({ tombstone: false });
    expect(await depositSchedule('checking')).toBe(id);
    expect(await db.getTransaction('posted-checking')).toMatchObject({
      schedule: id,
    });
    expect(await depositTotal()).toBe(NET_PAY);
  });

  it('recreates a missing schedule a paycheck lists and updates the paycheck', async () => {
    await createAcme();
    await listMissingSchedule('savings');

    await reconcilePaycheckSchedules();

    const id = await depositSchedule('savings');
    expect(id).not.toBe('never-arrived');
    expect(await scheduleById(id)).toMatchObject({ tombstone: false });
    expect(await strays()).toEqual([]);
    expect(await depositTotal()).toBe(NET_PAY);
  });

  it('converges in one more round when two devices recreate the same schedule', async () => {
    await createAcme();
    await listMissingSchedule('savings');
    await editOnTwoDevices(
      () => reconcilePaycheckSchedules(),
      () => reconcilePaycheckSchedules(),
    );
    // Each device made its own Savings schedule; one lost in the definition
    expect(await strays()).toHaveLength(1);

    await reconcilePaycheckSchedules();
    expect(await strays()).toEqual([]);
    expect(await depositTotal()).toBe(NET_PAY);
  });

  it('changes nothing the second time', async () => {
    await createAcme();
    await editOnTwoDevices(
      () => saveAcme([savings, checking, emergency()]),
      () => saveAcme([savings, checking, travel]),
    );
    await reconcilePaycheckSchedules();
    const since = await latestTimestamp();
    await reconcilePaycheckSchedules();
    expect(await messagesSince(since)).toEqual([]);
  });
});

describe('isPaychecksOn', () => {
  const setPref = (id: string, value: string) =>
    db.update('preferences', { id, value });

  it('reads the effective flag from the stored preferences', async () => {
    // beforeEach stores flags.businessCalendars = 'true', and flags.paychecks
    // is unset: an upgraded budget, which counts as on
    expect(await isPaychecksOn()).toBe(true);

    await setPref('flags.paychecks', 'false');
    expect(await isPaychecksOn()).toBe(false);

    await setPref('flags.paychecks', 'true');
    await setPref('flags.businessCalendars', 'false');
    expect(await isPaychecksOn()).toBe(false);
  });
});
