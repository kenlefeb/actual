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

### 2. The next date from a recompute is never a moved date before today

`getNextDateFrom` returns `getNextDateAfter(dateCond, yesterday)` whenever it is not null. It falls back to `getNextDate` only when that is null, so an ended schedule keeps its last occurrence as it does today. `createSchedule`, `setNextDate` and the load's recompute all call it, so they agree.

The existing comment's case still works: an earlier occurrence moved "after" the weekend onto today or later is exactly what `getNextDateAfter(…, yesterday)` finds.

### 3. A date change keeps a surviving skip

In `setNextDate`'s reset path, if the stored next date is today or later and is still a moved occurrence of the new dates (`getNextDateAfter(newCond, storedNext - 1 day) === storedNext`), keep it. Otherwise use the recomputed date. Skips are stored only as a next date advanced past occurrences, so keeping the stored date keeps exactly the skips of occurrences that still exist before it.

## Risks / Trade-offs

- [This changes upstream code in `schedules/app.ts`] → three small, local changes, each covered by a failing test first. Upstream merges may conflict there; the tests show the intent.
- [A pay schedule that posts automatically and holds a past next date could post on load] → verifying this fix, the Tester checks real budgets for a duplicate pay transaction on a moved-back date (for example November 13, 2026). Any found is a separate bug story.
- [Decision 3 keeps a later next date after a date edit] → it does so only when that date is still an occurrence, which is the PO's rule. Skipping is undoable, as before.

## Migration Plan

None. Stored next dates already in the past are moved on by the next load, as today.
