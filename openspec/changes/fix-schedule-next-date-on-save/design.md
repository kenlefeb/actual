# Design

## Context

From Explore (sc-4437, comment 4441), in `server/schedules/app.ts`:

- `updateSchedule` recomputes the next date (`setNextDate({reset: true})`) only when the date or account condition changed. It decides that with `areConditionValuesEqual`, which compares key lists.
- The paycheck save (`writePaycheckSchedules`) builds its date conditions with `businessCalendarId: … ?? undefined`. The stored rule went through JSON, so it has no such key. With no calendar, the key lists differ, an unchanged paycheck reads as changed, and the recompute drops the skips.
- `getNextDateFrom(dateCond, today)` returns the earlier of `getNextDate(dateCond, today)` and `getNextDateAfter(dateCond, yesterday)`. The first moves an occurrence on or after today, so a Sunday the 15th moved "before" becomes Friday the 13th, in the past. The second is the first moved date today or later.

## Goals / Non-Goals

**Goals:** save and load agree on the next date; an unchanged save changes nothing.

**Non-Goals:** no change to how occurrences are moved, how skips are stored, or how the budget load advances schedules.

## Decisions

### 1. Treat an `undefined` key as missing when comparing conditions

`areConditionValuesEqual` ignores object keys whose value is `undefined`, on both sides. A condition built fresh and the same condition read back from JSON then compare equal.

Alternative: build the paycheck's conditions without `undefined` keys. Rejected, because it fixes one caller, and any other caller that spreads an optional field would hit the same bug.

### 2. A save never picks a moved date before today, and the load is untouched

`getNextDateFrom` stays as it is. Its other callers are the load's recompute for a paid schedule (`setNextDate({ id })` from `advanceSchedulesService`), `refreshRelativeDependents` and `refreshCalendarScheduleDates`. They rely on it returning a moved-back date. Example: a non-posting schedule on the 15th, moved before weekends, has next date Oct 31. Its Oct 31 transaction imports on Saturday Nov 14. The load then recomputes and gets Nov 13, so the Nov 15 paycheck shows as missed. Changing the function globally would give Nov 30, and that paycheck would silently disappear.

So the rule applies only where a save picks a date: `createSchedule`, and `setNextDate` when `reset` is true. Both use `getNextDateAfter(dateCond, yesterday)`, the first moved date that is today or later, and fall back to `getNextDate` only when that is null (an ended schedule keeps its last occurrence). The load never recomputes an upcoming schedule, so it leaves that date unchanged.

### 3. A date change keeps skips that still exist and shows added dates

In `setNextDate`'s reset path, before writing, compute the occurrence dates (after moves) of the old and the new date conditions over a window from today up to the stored next date. The new next date is the earliest new occurrence, today or later, that either is not an old occurrence or is on or after the stored next date. If there is none in that window, it is the first new occurrence on or after the stored next date, from `getNextDateAfter(newCond, storedNext - 1 day)`, or the save rule from Decision 2 when the stored date is missing or before today.

Skips are stored only as a next date advanced past occurrences. So old occurrences before the stored date are exactly the skips: they stay skipped, and occurrences the edit added still show. Example: today is Nov 16, the schedule is on the 15th and the last day, next date Nov 30. Adding the 20th gives Nov 20, not Nov 30.

### 4. Dependents keep their skips too

`paycheck-skip-next` skips each deposit schedule separately, and a pay-date change runs `refreshRelativeDependents`, which today recomputes every dependent from today. That drops the deposits' skips, and an auto-posting deposit could then post for a skipped paycheck. So, when the refresh follows a date change of the source:

- Capture each dependent's old occurrence dates before the source's lookup is refreshed.
- Apply Decision 3's rule with each dependent's own stored next date.

The refresh after a source is deleted, and the calendar refresh, keep their current behaviour.

## Risks / Trade-offs

- [This changes upstream code in `schedules/app.ts`] → four small, local changes, each covered by a failing test first. Upstream merges may conflict there; the tests show the intent.
- [A pay schedule that posts automatically and holds a past next date could post on load] → verifying this fix, the Tester checks real budgets for a duplicate pay transaction on a moved-back date (for example November 13, 2026). Any found is a separate bug story.
- [Decisions 3 and 4 compare old and new occurrence lists] → the window runs from today to the stored next date (usually a few weeks), and each comparison is a test-covered helper shared by the schedule and its dependents.
- [Decision 2's rule differs from the load's recompute for paid schedules] → intended. The load may show a just-passed moved date as missed, but a save never picks one. The spec says only that a load leaves a saved date unchanged.

## Migration Plan

None. Stored next dates already in the past are moved on by the next load, as today.
