import type { BusinessCalendarEntity } from '#types/models';

// Synchronous cache for schedule date math, filled separately by the backend
// (budget load, mutations, sync) and the client (calendars query)
let calendars = new Map<string, BusinessCalendarEntity>();

export function setBusinessCalendars(list: BusinessCalendarEntity[]) {
  calendars = new Map(list.map(calendar => [calendar.id, calendar]));
}

export function getBusinessCalendar(
  id: string | null | undefined,
): BusinessCalendarEntity | undefined {
  return id ? calendars.get(id) : undefined;
}
