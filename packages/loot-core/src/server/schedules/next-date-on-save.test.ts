import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { toDateRepr } from '#server/models';
import { loadRules } from '#server/transactions/transaction-rules';
import { currentDay } from '#shared/months';
import type * as MonthsType from '#shared/months';
import { q } from '#shared/query';
import type { RecurConfig } from '#types/models';

import {
  advanceSchedulesService,
  createSchedule,
  app as schedulesApp,
  setNextDate,
  updateSchedule,
} from './app';

// Tests fix `currentDay` at 2017-01-01; these need it on the mocked clock
vi.mock('#shared/months', async () => {
  const actual = await vi.importActual<typeof MonthsType>('#shared/months');
  return { ...actual, currentDay: vi.fn(actual.currentDay) };
});

/* Nov / Dec 2026 calendar for reference:
  | Su | Mo | Tu | We | Th | Fr | Sa |
  | 08 | 09 | 10 | 11 | 12 | 13 | 14 |
  | 15 | 16 | 17 | 18 | 19 | 20 | 21 |
  | 22 | 23 | 24 | 25 | 26 | 27 | 28 |
  | 29 | 30 | 01 | 02 | 03 | 04 | 05 |
  | 06 | 07 | 08 | 09 | 10 | 11 | 12 |
  | 13 | 14 | 15 | 16 | 17 | 18 | 19 |
*/
// The 15th and the last day of each month, moved before weekends
const twiceMonthly: RecurConfig = {
  start: '2026-10-01',
  frequency: 'monthly',
  patterns: [
    { type: 'day', value: 15 },
    { type: 'day', value: -1 },
  ],
  skipWeekend: true,
  weekendSolveMode: 'before',
};

const dateCondition = (value: RecurConfig) => ({
  op: 'isapprox' as const,
  field: 'date' as const,
  value,
});

const nextDate = async (id: string) =>
  (await aqlQuery(q('schedules').filter({ id }).calculate('next_date'))).data;

async function setToday(day: string) {
  vi.setSystemTime(new Date(`${day}T12:00:00`));
  vi.mocked(currentDay).mockReturnValue(day);
}

async function storeNextDate(id: string, date: string | null) {
  const row = await db.first<{ id: string }>(
    'SELECT id FROM schedules_next_date WHERE schedule_id = ?',
    [id],
  );
  // Written earlier, so a save's reset (stamped now) wins over it
  const writtenAt = Date.now() - 1000;
  await db.update('schedules_next_date', {
    id: row?.id,
    local_next_date: date && toDateRepr(date),
    local_next_date_ts: writtenAt,
    base_next_date: date && toDateRepr(date),
    base_next_date_ts: writtenAt,
  });
}

async function createTwiceMonthly(storedNextDate?: string | null) {
  const id = await createSchedule({
    conditions: [dateCondition(twiceMonthly)],
  });
  if (storedNextDate !== undefined) {
    await storeNextDate(id, storedNextDate);
  }
  return id;
}

const endsIn2027: RecurConfig = {
  ...twiceMonthly,
  endMode: 'on_date',
  endDate: '2027-12-31',
};

const changeDates = (id: string, value: RecurConfig) =>
  updateSchedule({ schedule: { id }, conditions: [dateCondition(value)] });

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
  await loadRules();
  // Fills the schedule view's condition paths, as at budget load
  schedulesApp.startServices();
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(async () => {
  await schedulesApp.stopServices();
  vi.mocked(currentDay).mockReset();
  vi.useRealTimers();
});

describe('next date on save', () => {
  it('Moved back before today: a new schedule skips the 13th, and a load keeps its date', async () => {
    await setToday('2026-11-15');
    const id = await createTwiceMonthly();

    expect(await nextDate(id)).toBe('2026-11-30');
    await advanceSchedulesService(true);
    expect(await nextDate(id)).toBe('2026-11-30');
  });

  it("keeps the load's recompute for a paid schedule: Oct 31 paid on Nov 14 gives Nov 13", async () => {
    await setToday('2026-11-15');
    const accountId = await db.insertAccount({
      name: 'Checking',
      offbudget: 0,
      closed: 0,
    });
    const id = await createSchedule({
      conditions: [
        { op: 'is', field: 'account', value: accountId },
        dateCondition(twiceMonthly),
      ],
    });
    await storeNextDate(id, '2026-10-31');
    await db.insertTransaction({
      account: accountId,
      amount: 1000,
      date: '2026-11-14',
      schedule: id,
    });

    await advanceSchedulesService(true);

    // Shown as missed, so the Nov 15 paycheck doesn't silently disappear
    expect(await nextDate(id)).toBe('2026-11-13');
  });

  it('Saved with the same dates: a name or amount change keeps the next date', async () => {
    await setToday('2026-11-15');
    const id = await createTwiceMonthly('2026-12-15');

    await updateSchedule({
      schedule: { id, name: 'Renamed' },
      conditions: [
        { op: 'isapprox', field: 'amount', value: 5000 },
        dateCondition(twiceMonthly),
      ],
    });

    expect(await nextDate(id)).toBe('2026-12-15');
  });

  it('Dates changed, the skipped date still exists: the next date is kept', async () => {
    await setToday('2026-11-15');
    // November 30 skipped
    const id = await createTwiceMonthly('2026-12-15');

    await changeDates(id, endsIn2027);

    expect(await nextDate(id)).toBe('2026-12-15');
  });

  it('Dates changed, the skipped date no longer exists: the next date is Nov 20', async () => {
    await setToday('2026-11-15');
    const id = await createTwiceMonthly('2026-12-15');

    await changeDates(id, {
      ...twiceMonthly,
      patterns: [
        { type: 'day', value: 1 },
        { type: 'day', value: 20 },
      ],
    });

    expect(await nextDate(id)).toBe('2026-11-20');
  });

  it('a date change with a stored next date before today picks no date moved before today', async () => {
    await setToday('2026-11-15');
    const id = await createTwiceMonthly('2026-10-31');

    await changeDates(id, endsIn2027);
    expect(await nextDate(id)).toBe('2026-11-30');
  });

  it('a date change with no stored next date picks no date moved before today', async () => {
    await setToday('2026-11-15');
    const id = await createTwiceMonthly(null);

    await changeDates(id, endsIn2027);
    expect(await nextDate(id)).toBe('2026-11-30');
  });

  it('a forced reset picks no date moved before today', async () => {
    await setToday('2026-11-15');
    const id = await createTwiceMonthly('2026-12-15');

    await setNextDate({ id, reset: true });
    expect(await nextDate(id)).toBe('2026-11-30');
  });

  it('A pay date added: adding the 20th on Nov 16 gives Nov 20', async () => {
    await setToday('2026-11-16');
    const id = await createTwiceMonthly('2026-11-30');

    await changeDates(id, {
      ...twiceMonthly,
      patterns: [...(twiceMonthly.patterns ?? []), { type: 'day', value: 20 }],
    });

    expect(await nextDate(id)).toBe('2026-11-20');
  });
});
