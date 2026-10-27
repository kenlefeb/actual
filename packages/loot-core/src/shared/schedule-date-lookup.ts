import type { ScheduleEntity } from '#types/models';

type ScheduleDate = ScheduleEntity['_date'];

// Synchronous cache of each schedule's date condition value, so relative
// dates can read their source without a database query. Filled separately by
// the backend (budget load, rule changes) and the client (cached schedules).
let scheduleDates = new Map<string, ScheduleDate>();

export function setScheduleDates(
  entries: Iterable<readonly [string, ScheduleDate]>,
) {
  scheduleDates = new Map(entries);
}

export function getScheduleDate(
  id: string | null | undefined,
): ScheduleDate | undefined {
  return id ? scheduleDates.get(id) : undefined;
}

// Schedule names, for describing relative dates ("2 business days before
// Payday"). Only the client fills this.
let scheduleNames = new Map<string, string>();

export function setScheduleNames(entries: Iterable<readonly [string, string]>) {
  scheduleNames = new Map(entries);
}

export function getScheduleName(id: string | null | undefined) {
  return id ? scheduleNames.get(id) : undefined;
}
