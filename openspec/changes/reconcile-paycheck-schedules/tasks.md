# Tasks

## 1. Contract and failing tests

- [ ] 1.1 Spec delta for `paychecks` "Edits on two devices" and "Clean-up after edits on two devices". Verify with `openspec validate reconcile-paycheck-schedules --strict`.
- [ ] 1.2 Add `server/paychecks/concurrent-edits.test.ts` with two-device helpers, following the reproduction in design.md:
  - enable syncing mode with the mock sync server;
  - snapshot the database with `serialize()` and restore it with `openDatabase(buffer)`, then `loadMappings()` and `loadRules()`;
  - capture a device's `messages_crdt` rows since a timestamp, and apply them with `applyMessages` and `deserializeValue`.

  Write failing tests named after the spec scenarios:
  - "Both devices add a deposit": after the merge, no active schedule is unlisted, and the deposit schedules add up to net pay.
  - "Forecasts count each deposit once": `getNormalizedSchedules` (or `forecast/generate`) has no "Emergency" Acme deposit and each other deposit once.
  - "A deposit that already posted": the posted transfer remains.
  - "Nothing posts before the clean-up": the `sync` success event with a due, auto-posting stray posts nothing for "Emergency".
  - "A later sync on the same day": with `lastScheduleRun` already set to today, a `sync` success event that brings in the stray still deletes it.
  - "Saved again while the other device cleaned up": device A deletes the stray S after the merge, device B saves "Acme" again listing S before receiving that, then both sync. S is active, keeps its id, and the deposits add up to net pay.
  - "Deleted on one device, edited on the other": no "Acme" schedule is active.
  - "A user's own schedule relative to the pay date": "Gym" is kept.

  Verify each fails on `development` for the reason in its name; "Gym" already passes.

## 2. Record which paycheck generated each schedule

- [ ] 2.1 Add the fork migration `packages/loot-core/migrations/<timestamp>_add_paycheck_schedules.sql`, creating `paycheck_schedules (id TEXT PRIMARY KEY, paycheck TEXT, tombstone INTEGER DEFAULT 0)` with an id later than `1793200000000`. Add the table to the AQL schema (`server/aql/schema/index.ts`). Verify the migration tests and `yarn typecheck` pass.
- [ ] 2.2 In `writePaycheckSchedules`, insert a mapping row for each schedule it creates, and in `deletePaycheck`, tombstone the paycheck's rows. Unit tests: after create, every listed schedule has a row for the paycheck; after delete, none is live. Undo of a create or delete restores the rows too.
- [ ] 2.3 Add the backfill at budget load: for each live paycheck, insert the missing rows for its listed schedules. Unit test: a paycheck created without rows gets them, and running it twice changes nothing.

## 3. Reconcile

- [ ] 3.1 Add `reconcilePaycheckSchedules()` to `server/paychecks/app.ts`, working in both directions (design.md, "Reconcile in both directions"):
  - **Restore:** for each live paycheck, a listed schedule that is tombstoned is restored in place (clear the tombstone on the schedule, its rule and its mapping row, then rerun `writePaycheckSchedules`). A listed schedule that is missing is recreated by `writePaycheckSchedules`.
  - **Delete:** then each mapped, active schedule that is unlisted in its live paycheck, or whose paycheck is deleted or missing, gets `deleteSchedule` and its mapping row tombstoned.
  - It never touches an unmapped schedule.

  Unit tests:
  - it deletes only mapped strays, and keeps transactions posted from them;
  - a tombstoned listed schedule comes back with the same id, and its posted transactions stay linked;
  - a missing listed schedule is recreated and the definition updated;
  - two recreates of the same deposit converge after one more reconcile;
  - a second run changes nothing.
- [ ] 3.2 Hook it into the schedules `sync` handler (`server/schedules/app.ts:987-1000`): on `type === 'success'`, when `tables` includes `paychecks`, `paycheck_schedules` or `schedules`, call `void runMutator(() => reconcilePaycheckSchedules())` **before** the `lastScheduleRun !== currentDay()` guard, and leave the guarded `advanceSchedulesService` call as it is. Also run it at budget load, after the backfill, and for the saved paycheck at the end of `paycheck-update`. Verify every 1.2 test passes, including "A later sync on the same day" and "Nothing posts before the clean-up".

## 4. Docs and checks

- [ ] 4.1 Update ADR 2's "Concurrent edits aren't handled yet (sc-556)" to describe the mapping table, the two-way reconcile, and when it runs. In ADR 4's "remove fork data" steps, add:
  - `DROP TABLE paycheck_schedules` to step 3;
  - the new migration's id to step 6's `__migrations__` delete;
  - `paycheck_schedules` to step 7's list of `dataset` values whose `messages_crdt` and `messages_pending` rows are deleted.

  Verify that ADR 2 and all three ADR 4 steps name `paycheck_schedules` or its migration id.
- [ ] 4.2 Run the loot-core tests, `yarn typecheck` and `yarn lint`; all pass. The existing `server/paychecks` tests are unchanged and pass.

## Workflow follow-up

- Merge after #87 and sc-558's change, in that order. Merge each previous one in rather than rebasing.

- Archive the change when sc-556 is Done.
- File follow-ups for any Product decision the PO defers: a conflict notice (3), and a report of strays from before this change (4).
