import * as api from '@actual-app/api';
import { z } from 'zod';

import { pageList } from '#paging';
import { withText } from '#sanitize';

import { date, pageShape } from './shared';
import type { RegisterTool } from './shared';

// A day, a repeat rule or a date relative to another schedule (by id); the
// engine validates the shape and refuses anything else.
const scheduleDate = z.union([date, z.record(z.string(), z.unknown())]);

type ScheduleDate = Parameters<typeof api.getScheduleDates>[0];

export function registerCalendarTools(tool: RegisterTool) {
  tool(
    'list_business_calendars',
    'List business calendars: non-working weekdays, holiday rules and exceptions.',
    pageShape,
    async p => {
      const calendars = await api.getBusinessCalendars();
      return pageList(
        calendars.map(c =>
          withText(
            { id: c.id, non_working_days: c.nonWorkingDays },
            { name: c.name, holidays: c.holidays, exceptions: c.exceptions },
          ),
        ),
        p,
      );
    },
  );

  tool(
    'get_schedule_next_dates',
    'Expand a schedule date into upcoming dates (YYYY-MM-DD): a day, a repeat rule, or a date relative to another schedule ({ relativeTo: { scheduleId, offset, unit: "days" | "business-days", direction: "before" | "after" } }). Starts today unless `start` is given; `count` caps the dates (default 10, at most 100).',
    {
      date: scheduleDate,
      start: date.optional(),
      end: date.optional(),
      count: z.number().int().min(0).max(100).optional(),
    },
    async ({ date: d, start, end, count }) => ({
      dates: await api.getScheduleDates(d as ScheduleDate, {
        start,
        end,
        count: count ?? 10,
      }),
    }),
  );
}
