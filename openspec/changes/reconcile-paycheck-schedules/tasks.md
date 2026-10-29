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
  - "Deleted on one device, edited on the other": no "Acme" schedule is active.
  - "A user's own schedule relative to the pay date": "Gym" is kept.

  Verify each fails on `development` for the reason in its name; "Gym" already passes.

## 2. Record which paycheck generated each schedule

- [ ] 2.1 Add the fork migration `packages/loot-core/migrations/<timestamp>_add_paycheck_schedules.sql`, creating `paycheck_schedules (id TEXT PRIMARY KEY, paycheck TEXT, tombstone INTEGER DEFAULT 0)` with an id later than `1793200000000`. Add the table to the AQL schema (`server/aql/schema/index.ts`). Verify the migration tests and `yarn typecheck` pass.
- [ ] 2.2 In `writePaycheckSchedules`, insert a mapping row for each schedule it creates, and in `deletePaycheck`, tombstone the paycheck's rows. Unit tests: after create, every listed schedule has a row for the paycheck; after delete, none is live. Undo of a create or delete restores the rows too.
- [ ] 2.3 Add the backfill at budget load: for each live paycheck, insert the missing rows for its listed schedules. Unit test: a paycheck created without rows gets them, and running it twice changes nothing.

## 3. Reconcile

- [ ] 3.1 Add `reconcilePaycheckSchedules()` to `server/paychecks/app.ts`. It finds each mapped, active schedule that is unlisted in its live paycheck, or whose paycheck is deleted or missing, calls `deleteSchedule`, and tombstones the mapping row. It never touches an unmapped schedule. Unit tests: it deletes only mapped strays, keeps transactions posted from them, and a second run changes nothing.
- [ ] 3.2 Run it in the server `sync` handler (`server/schedules/app.ts:979`) on `success` when `tables` includes `paychecks`, `paycheck_schedules` or `schedules`. Await it before `advanceSchedulesService`, inside `runMutator` and not undoable. Also run it at budget load, after the backfill, and for the saved paycheck at the end of `paycheck-update`. Verify every 1.2 test passes.

## 4. Docs and checks

- [ ] 4.1 Update ADR 2's "Concurrent edits aren't handled yet (sc-556)" to describe the mapping table and when the reconcile runs. Add `DROP TABLE paycheck_schedules` to ADR 4's "remove fork data" steps. Verify both ADRs name `paycheck_schedules`.
- [ ] 4.2 Run the loot-core tests, `yarn typecheck` and `yarn lint`; all pass. The existing `server/paychecks` tests are unchanged and pass.

## Workflow follow-up

- Archive the change when sc-556 is Done.
- File follow-ups for any Product decision the PO defers: a conflict notice (3), and a report of strays from before this change (4).
