import { setBusinessCalendars } from '#shared/business-calendar-lookup';
import { businessCalendarPresets } from '#shared/business-calendar-presets';
import { setScheduleDates } from '#shared/schedule-date-lookup';
import type { RecurConfig, RelativeDateConfig } from '#types/models';

import { Condition } from './condition';

// The same payday and deposit as the shared relative-dates tests. This one
// lives with the rules because it checks Condition.eval, which is server code.
const federal = {
  id: 'federal',
  name: 'U.S. Federal Holidays',
  ...businessCalendarPresets[0].calendar,
};

const payday: RecurConfig = {
  start: '2026-01-15',
  frequency: 'monthly',
  skipWeekend: true,
  weekendSolveMode: 'before',
  businessCalendarId: 'federal',
};

const deposit: RelativeDateConfig = {
  relativeTo: {
    scheduleId: 'payday',
    offset: 2,
    unit: 'business-days',
    direction: 'before',
  },
  businessCalendarId: 'federal',
};

describe('Condition with a relative date', () => {
  beforeEach(() => {
    setBusinessCalendars([federal]);
    setScheduleDates([['payday', payday]]);
  });

  afterEach(() => {
    setBusinessCalendars([]);
    setScheduleDates([]);
  });

  it('matches an imported transaction near a relative occurrence', () => {
    const approx = new Condition('isapprox', 'date', deposit, null);
    expect(approx.eval({ date: '2026-11-10' })).toBe(true);
    expect(approx.eval({ date: '2026-11-12' })).toBe(true);
    expect(approx.eval({ date: '2026-11-20' })).toBe(false);

    const exact = new Condition('is', 'date', deposit, null);
    expect(exact.eval({ date: '2026-11-10' })).toBe(true);
    expect(exact.eval({ date: '2026-11-11' })).toBe(false);
  });
});
