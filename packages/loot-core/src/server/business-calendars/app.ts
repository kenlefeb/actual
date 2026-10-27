import * as d from 'date-fns';

import { createApp } from '#server/app';
import * as db from '#server/db';
import { mutator } from '#server/mutators';
import { setNextDate } from '#server/schedules/app';
import { addSyncListener } from '#server/sync';
import { undoable } from '#server/undo';
import { setBusinessCalendars } from '#shared/business-calendar-lookup';
import type {
  BusinessCalendarEntity,
  BusinessCalendarException,
  HolidayRule,
  Weekday,
} from '#types/models';

type CalendarFields = Omit<BusinessCalendarEntity, 'id'>;

export type BusinessCalendarsHandlers = {
  'business-calendars-get': typeof getBusinessCalendars;
  'business-calendar-create': typeof createBusinessCalendar;
  'business-calendar-update': typeof updateBusinessCalendar;
  'business-calendar-delete': typeof deleteBusinessCalendar;
};

export const app = createApp<BusinessCalendarsHandlers>();
app.method('business-calendars-get', getBusinessCalendars);
app.method(
  'business-calendar-create',
  mutator(undoable(createBusinessCalendar)),
);
app.method(
  'business-calendar-update',
  mutator(undoable(updateBusinessCalendar)),
);
app.method(
  'business-calendar-delete',
  mutator(undoable(deleteBusinessCalendar)),
);

function parseJsonArray<T>(value: string | null): T[] {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let unlistenSync: (() => void) | null = null;

// Stored next dates are computed once, so recompute them for active schedules
// that use a business calendar, directly or through a relative date's source,
// whenever calendars change. This runs inside the
// same undoable mutation, so undo restores both.
async function refreshCalendarScheduleDates() {
  const schedules = await db.all<{ id: string }>(
    `SELECT s.id FROM schedules s JOIN rules r ON r.id = s.rule
     WHERE s.tombstone = 0 AND s.completed = 0
       AND (r.conditions LIKE '%businessCalendarId%'
         OR r.conditions LIKE '%"relativeTo"%')`,
  );
  for (const { id } of schedules) {
    await setNextDate({ id });
  }
}

async function refreshBusinessCalendarLookup() {
  setBusinessCalendars(await getBusinessCalendars());
}

// Keep the synchronous lookup used by schedule date math in step with the
// table, including changes from undo and other devices
export async function loadBusinessCalendars() {
  await refreshBusinessCalendarLookup();
  unlistenSync?.();
  unlistenSync = addSyncListener((_oldValues, newValues) => {
    if (newValues.has('business_calendars')) {
      void refreshBusinessCalendarLookup();
    }
  });
}

async function getBusinessCalendars(): Promise<BusinessCalendarEntity[]> {
  const rows = await db.all<db.DbBusinessCalendar>(
    'SELECT * FROM business_calendars WHERE tombstone = 0 ORDER BY name, id',
  );
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    nonWorkingDays: parseJsonArray<Weekday>(row.non_working_days),
    holidays: parseJsonArray<HolidayRule>(row.holidays),
    exceptions: parseJsonArray<BusinessCalendarException>(row.exceptions),
  }));
}

async function createBusinessCalendar({
  name,
  nonWorkingDays = [0, 6],
  holidays = [],
  exceptions = [],
}: Pick<CalendarFields, 'name'> & Partial<CalendarFields>): Promise<
  BusinessCalendarEntity['id']
> {
  const fields = { name, nonWorkingDays, holidays, exceptions };
  validateCalendar(fields);
  const id = await db.insertWithUUID('business_calendars', toRow(fields));
  await refreshBusinessCalendarLookup();
  await refreshCalendarScheduleDates();
  return id;
}

async function updateBusinessCalendar({
  id,
  ...fields
}: Pick<BusinessCalendarEntity, 'id'> & Partial<CalendarFields>) {
  validateCalendar(fields);
  await db.update('business_calendars', { id, ...toRow(fields) });
  await refreshBusinessCalendarLookup();
  await refreshCalendarScheduleDates();
}

async function deleteBusinessCalendar({
  id,
}: Pick<BusinessCalendarEntity, 'id'>) {
  await db.delete_('business_calendars', id);
  await refreshBusinessCalendarLookup();
  await refreshCalendarScheduleDates();
}

function toRow(
  fields: Partial<CalendarFields>,
): Partial<db.DbBusinessCalendar> {
  const row: Partial<db.DbBusinessCalendar> = {};
  if (fields.name !== undefined) {
    row.name = fields.name.trim();
  }
  if (fields.nonWorkingDays !== undefined) {
    row.non_working_days = JSON.stringify(fields.nonWorkingDays);
  }
  if (fields.holidays !== undefined) {
    row.holidays = JSON.stringify(fields.holidays);
  }
  if (fields.exceptions !== undefined) {
    row.exceptions = JSON.stringify(fields.exceptions);
  }
  return row;
}

const OBSERVANCES = new Set(['none', 'sunday-to-monday', 'nearest-weekday']);

function isWeekday(value: unknown): value is Weekday {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 6;
}

function isIsoDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    d.isValid(d.parseISO(value)) &&
    d.format(d.parseISO(value), 'yyyy-MM-dd') === value
  );
}

function validateHoliday(rule: HolidayRule) {
  if (typeof rule.id !== 'string' || !rule.id) {
    throw new Error('Each holiday needs an id');
  }
  if (typeof rule.name !== 'string' || !rule.name.trim()) {
    throw new Error('Each holiday needs a name');
  }
  if (!Number.isInteger(rule.month) || rule.month < 1 || rule.month > 12) {
    throw new Error(`Invalid month for holiday "${rule.name}"`);
  }
  if (!OBSERVANCES.has(rule.observance)) {
    throw new Error(`Invalid observance for holiday "${rule.name}"`);
  }
  switch (rule.kind) {
    case 'fixed': {
      // A leap year allows February 29
      const date = new Date(2024, rule.month - 1, rule.day);
      if (!Number.isInteger(rule.day) || date.getMonth() !== rule.month - 1) {
        throw new Error(`Invalid day for holiday "${rule.name}"`);
      }
      break;
    }
    case 'nth-weekday':
      if (!isWeekday(rule.weekday) || ![1, 2, 3, 4].includes(rule.nth)) {
        throw new Error(`Invalid weekday rule for holiday "${rule.name}"`);
      }
      break;
    case 'last-weekday':
      if (!isWeekday(rule.weekday)) {
        throw new Error(`Invalid weekday rule for holiday "${rule.name}"`);
      }
      break;
    default:
      throw new Error('Unknown holiday kind');
  }
}

function validateCalendar(fields: Partial<CalendarFields>) {
  if (fields.name !== undefined && !fields.name.trim()) {
    throw new Error('Calendar name is required');
  }
  if (fields.nonWorkingDays !== undefined) {
    const days = fields.nonWorkingDays;
    if (!Array.isArray(days) || !days.every(isWeekday)) {
      throw new Error('Invalid non-working weekdays');
    }
    if (new Set(days).size >= 7) {
      throw new Error('A calendar needs at least one working weekday');
    }
  }
  if (fields.holidays !== undefined) {
    if (!Array.isArray(fields.holidays)) {
      throw new Error('Invalid holidays');
    }
    fields.holidays.forEach(validateHoliday);
  }
  if (fields.exceptions !== undefined) {
    if (!Array.isArray(fields.exceptions)) {
      throw new Error('Invalid exceptions');
    }
    const dates = new Set<string>();
    for (const exception of fields.exceptions) {
      if (!isIsoDate(exception.date)) {
        throw new Error('Exception dates must be valid YYYY-MM-DD dates');
      }
      if (dates.has(exception.date)) {
        throw new Error(`Duplicate exception for ${exception.date}`);
      }
      if (typeof exception.isBusinessDay !== 'boolean') {
        throw new Error(`Invalid exception for ${exception.date}`);
      }
      dates.add(exception.date);
    }
  }
}
