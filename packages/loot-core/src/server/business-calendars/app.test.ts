import { app } from '#server/business-calendars/app';
import { loadMappings } from '#server/db/mappings';
import { undo } from '#server/undo';
import { businessCalendarPresets } from '#shared/business-calendar-presets';
import type { HolidayRule } from '#types/models';

const july4: HolidayRule = {
  id: 'july-4',
  name: 'Independence Day',
  kind: 'fixed',
  month: 7,
  day: 4,
  observance: 'nearest-weekday',
};

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
});

describe('business calendars app', () => {
  it('creates a calendar with a default weekend', async () => {
    const id = await app.handlers['business-calendar-create']({
      name: ' Acme Corp ',
    });

    expect(await app.handlers['business-calendars-get']()).toEqual([
      {
        id,
        name: 'Acme Corp',
        nonWorkingDays: [0, 6],
        holidays: [],
        exceptions: [],
      },
    ]);
  });

  it('creates an independent copy of a preset', async () => {
    const preset = businessCalendarPresets[0];
    const first = await app.handlers['business-calendar-create']({
      name: preset.name,
      ...preset.calendar,
    });
    const second = await app.handlers['business-calendar-create']({
      name: 'Copy',
      ...preset.calendar,
    });
    await app.handlers['business-calendar-update']({ id: first, holidays: [] });

    const calendars = await app.handlers['business-calendars-get']();
    expect(calendars.find(c => c.id === first)?.holidays).toEqual([]);
    expect(calendars.find(c => c.id === second)?.holidays).toHaveLength(11);
    expect(preset.calendar.holidays).toHaveLength(11);
  });

  it('renames and edits rules, weekdays and exceptions', async () => {
    const id = await app.handlers['business-calendar-create']({ name: 'Acme' });
    await app.handlers['business-calendar-update']({
      id,
      name: 'Acme Payroll',
      nonWorkingDays: [5, 6],
      holidays: [july4],
      exceptions: [
        { date: '2026-12-26', isBusinessDay: false, name: 'Closure' },
      ],
    });

    expect(await app.handlers['business-calendars-get']()).toEqual([
      {
        id,
        name: 'Acme Payroll',
        nonWorkingDays: [5, 6],
        holidays: [july4],
        exceptions: [
          { date: '2026-12-26', isBusinessDay: false, name: 'Closure' },
        ],
      },
    ]);
  });

  it('deletes a calendar', async () => {
    const id = await app.handlers['business-calendar-create']({ name: 'Acme' });
    await app.handlers['business-calendar-delete']({ id });

    expect(await app.handlers['business-calendars-get']()).toEqual([]);
  });

  it('undoes a rename', async () => {
    const id = await app.handlers['business-calendar-create']({ name: 'Acme' });
    await app.handlers['business-calendar-update']({ id, name: 'Renamed' });
    await undo();

    const [calendar] = await app.handlers['business-calendars-get']();
    expect(calendar.name).toBe('Acme');
  });

  describe('validation', () => {
    const create = (fields: object) =>
      app.handlers['business-calendar-create']({ name: 'Acme', ...fields });

    it('requires a name', async () => {
      await expect(create({ name: '  ' })).rejects.toThrow(/name is required/);
    });

    it('rejects a calendar without working weekdays', async () => {
      await expect(
        create({ nonWorkingDays: [0, 1, 2, 3, 4, 5, 6] }),
      ).rejects.toThrow(/at least one working weekday/);
    });

    it('rejects invalid weekdays', async () => {
      await expect(create({ nonWorkingDays: [7] })).rejects.toThrow(
        /Invalid non-working weekdays/,
      );
    });

    it('rejects impossible fixed dates but allows February 29', async () => {
      await expect(
        create({ holidays: [{ ...july4, month: 2, day: 30 }] }),
      ).rejects.toThrow(/Invalid day/);
      await expect(
        create({ holidays: [{ ...july4, month: 2, day: 29 }] }),
      ).resolves.toEqual(expect.any(String));
    });

    it('rejects invalid months, observances and nth values', async () => {
      await expect(
        create({ holidays: [{ ...july4, month: 13 }] }),
      ).rejects.toThrow(/Invalid month/);
      await expect(
        create({ holidays: [{ ...july4, observance: 'monday' }] }),
      ).rejects.toThrow(/Invalid observance/);
      await expect(
        create({
          holidays: [
            {
              ...july4,
              kind: 'nth-weekday',
              weekday: 1,
              nth: 5,
              day: undefined,
            },
          ],
        }),
      ).rejects.toThrow(/Invalid weekday rule/);
    });

    it('rejects unknown holiday kinds and unnamed holidays', async () => {
      await expect(
        create({ holidays: [{ ...july4, kind: 'easter' }] }),
      ).rejects.toThrow(/Unknown holiday kind/);
      await expect(
        create({ holidays: [{ ...july4, name: '' }] }),
      ).rejects.toThrow(/needs a name/);
    });

    it('rejects invalid and duplicate exception dates', async () => {
      await expect(
        create({
          exceptions: [{ date: '2026-02-30', isBusinessDay: false, name: 'X' }],
        }),
      ).rejects.toThrow(/valid YYYY-MM-DD/);
      await expect(
        create({
          exceptions: [
            { date: '2026-12-26', isBusinessDay: false, name: 'A' },
            { date: '2026-12-26', isBusinessDay: true, name: 'B' },
          ],
        }),
      ).rejects.toThrow(/Duplicate exception/);
    });
  });
});
