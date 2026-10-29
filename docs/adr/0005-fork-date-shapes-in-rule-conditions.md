# 5. Fork date shapes inside upstream rule conditions

Fork-only; never upstream. Accepted 2026-10-29.

## Context

A schedule's date lives in its rule's `date` condition. Upstream allows a
`YYYY-MM-DD` string or a `RecurConfig` there. The fork needs two more things:

- **Business-day moves**: `RecurConfig.businessCalendarId`.
- **Relative dates**: a new `RelativeDateConfig` (`relativeTo: { scheduleId,
  offset, unit, direction }`), used by relative schedules and by every
  paycheck deposit schedule.

Both are defined in [`types/models/schedule.ts`](../../packages/loot-core/src/types/models/schedule.ts).
Adding a fork-only schedule date table would mean forking every upstream
reader of schedule dates.

## Decision

Store the fork shapes in the same condition value, and teach upstream's
readers about them at the narrowest points:

- **Parsing and matching:** [`rules/condition.ts:35-55, 284-294`](../../packages/loot-core/src/server/rules/condition.ts)
  adds a `relative` value type, including `isapprox` within ±2 days.
  [`rule-utils.ts`](../../packages/loot-core/src/server/rules/rule-utils.ts)
  carries `businessCalendarId` through.
- **Next date:** [`shared/schedules.ts` `getNextDate`](../../packages/loot-core/src/shared/schedules.ts)
  delegates to `getNextRelativeDate`. Every caller (forecasts, goal templates,
  previews, posting) goes through it.
- **Validation:** the API checks relative offsets
  ([`server/api.ts` `validateScheduleDate`](../../packages/loot-core/src/server/api.ts)).
  The schedule server refuses chains: a schedule can't be relative to a
  relative schedule
  ([`schedules/app.ts` `assertValidRelativeDate`](../../packages/loot-core/src/server/schedules/app.ts)).

This is a seam we protect. Upstream code that reads `_date` or `value.frequency`
directly, and not through `getNextDate`, is a risk. For example,
`budget/schedule-template.ts:137-140` decides "repeating" from
`'frequency' in value`. It treats a relative schedule as non-repeating, so a
schedule goal template budgets only its next occurrence.

## Consequences

- Upstream merges that touch schedule date handling must keep the guard tests
  green. Those are the tests from sc-561 (PR #67), which run a relative
  schedule through next date, upcoming dates, previews, posting, forecasts and
  goal templates.
- An upstream client can't open these rules ([ADR 4](0004-fork-migrations-and-upstream-compatibility.md)).
- New fork date fields go into these two types only, and any new upstream
  reader gets a guard test.

## Links

- Specs: `schedule-relative-dates` ("Behaves like any schedule"),
  `schedule-business-days`.
- Change: `openspec/changes/archive/2026-10-27-schedule-relative-dates/design.md`.
- Story: sc-561 (PR #67, open at the time of writing).
