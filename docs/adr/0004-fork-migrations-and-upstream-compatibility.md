# 4. Fork migrations, and budgets don't go back to upstream

Fork-only; never upstream. Accepted 2026-10-29 (Product Owner with the
Solution Architect, on sc-562).

## Context

The fork adds two migrations:

- [`1793116240000_add_business_calendars.sql`](../../packages/loot-core/migrations/1793116240000_add_business_calendars.sql):
  the `business_calendars` table.
- [`1793200000000_add_paychecks.sql`](../../packages/loot-core/migrations/1793200000000_add_paychecks.sql):
  the `paychecks` table, plus `accounts.business_calendar_id` and
  `accounts.deposit_days_early`.

Both are additive. Upstream's migration check tolerates unknown ids after
`ADDITIVE_ONLY_CUTOFF`, but only while every migration it knows is applied
([`checkDatabaseValidity`, `migrate/migrations.ts:155-230`](../../packages/loot-core/src/server/migrate/migrations.ts)).
The fork also stores fork-only shapes inside upstream rule conditions
([ADR 5](0005-fork-date-shapes-in-rule-conditions.md)).

## Decision

- Fork migrations are additive only: new tables, and new nullable or
  defaulted columns. Their ids are timestamps later than the fork's upstream
  base. Upstream migrations merged in later run in id order through upstream's
  interleaved-id support.
- **A budget with fork data doesn't go back to upstream Actual cleanly, and we
  accept that.** An upstream release newer than the fork's base sees the fork
  migration ids as unknown, next to its own new migrations that aren't applied
  yet, so it refuses the budget with `out-of-sync-migrations`. Even when it
  opens, upstream fails on a relative date
  (`Invalid date format`) and ignores business calendars.
- The way out is a documented **remove fork data** export, below. A later story
  can implement it as a handler or script.

### Remove fork data (export path)

On a copy of the budget's `db.sqlite`, in one transaction:

1. **Relative-date schedules.** For each rule whose `date` condition value has
   `relativeTo`, replace the value with a one-time date: the schedule's stored
   `next_date`, or delete the schedule if it has none. This covers paychecks'
   deposit schedules. A materialized `RecurConfig` would need the source's
   pattern plus the offset, and upstream can't express that.
2. **Calendar ids on repeating dates.** In each `date` condition value with
   `businessCalendarId`, remove that key. Keep `skipWeekend` and
   `weekendSolveMode`, so these schedules fall back to skipping weekends.
3. **Fork tables.** `DROP TABLE paychecks`, `DROP TABLE paycheck_schedules`
   and `DROP TABLE business_calendars`.
   The schedules a paycheck generated stay as ordinary schedules, already
   converted by step 1.
4. **Fork account columns.** `ALTER TABLE accounts DROP COLUMN
   business_calendar_id` and `DROP COLUMN deposit_days_early`.
5. **Fork flags.** `DELETE FROM preferences WHERE id IN
   ('flags.businessCalendars', 'flags.paychecks')`.
6. **Migration records.** `DELETE FROM __migrations__ WHERE id IN
   (1793116240000, 1793200000000, 1793300000000)`.
7. **Sync history.** Delete `messages_crdt` and `messages_pending` rows whose
   `dataset` is `paychecks`, `paycheck_schedules` or `business_calendars`, or
   whose `column` is one of
   the two dropped account columns.

Then import the result into upstream as a **new** budget file, with a new sync
id, rather than syncing it into the old group. Messages on the server would
otherwise bring the fork data back. Check that upstream opens the copy and
shows the same balances and the same schedule next dates.

## Consequences

- Upstream merges into the fork stay cheap: there's no schema fork, only
  additions.
- Leaving the fork is a one-way export, not a downgrade. The archived paychecks
  design's "delete paychecks before downgrading" covers only older fork
  builds.
- New fork migrations must update the export steps above in the same PR.

## Links

- Changes: `openspec/changes/archive/2026-10-27-business-calendars/design.md`
  and `2026-10-27-paychecks/design.md` ("Migration Plan").
- Story: sc-562 (this decision). The export implementation isn't planned
  until someone needs to leave the fork.
