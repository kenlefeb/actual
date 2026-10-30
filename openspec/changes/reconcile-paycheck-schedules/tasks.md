# Tasks

## 1. Contract and failing tests

- [x] 1.1 Spec delta for `paychecks` "Edits on two devices", "Clean-up after edits on two devices" and "No Delete for a paycheck's schedules". Verify with `openspec validate reconcile-paycheck-schedules --strict`.
- [x] 1.2 Add `server/paychecks/concurrent-edits.test.ts` with two-device helpers, following the reproduction in design.md:
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

  - "Deleted while paychecks were off": with the feature off, delete a deposit schedule, and check that a sync doesn't restore it. Then turn the feature on in two ways, each restoring it: a local toggle, which emits an `applied` event with `preferences` in `tables`, and a toggle that arrives by sync, a `success` event.

  Verify each fails on `development` for the reason in its name; "Gym" already passes.
- [x] 1.3 Add UI guard tests for "No Delete for a paycheck's schedules", one per place Delete is reachable today (design.md, the table under "No Delete for a paycheck's schedules"):
  - desktop schedules table (`SchedulesTable` / `schedules/index.tsx`): with `paychecks` on, "Acme → Checking" isn't listed, so no row menu offers Delete for it;
  - mobile schedules list (`MobileSchedulesPage`): it isn't listed, so there's no swipe Delete for it;
  - desktop schedule editor (`ScheduleEditModal`): no Delete, and the paycheck note offers "Edit paycheck", which opens "Acme";
  - mobile schedule edit page (`MobileScheduleEditPage`): no Delete, and "Edit paycheck" is offered. **This fails today**: the page has no paycheck note.

  The first three pass today and guard against regressions. Verify the mobile edit page test fails.

## 2. Record which paycheck generated each schedule

- [x] 2.1 Add the fork migration `packages/loot-core/migrations/<timestamp>_add_paycheck_schedules.sql`, creating `paycheck_schedules (id TEXT PRIMARY KEY, paycheck TEXT, tombstone INTEGER DEFAULT 0)` with an id later than `1793200000000`. Add the table to the AQL schema (`server/aql/schema/index.ts`). Verify the migration tests and `yarn typecheck` pass.
- [x] 2.2 In `writePaycheckSchedules`, insert a mapping row for each schedule it creates, and in `deletePaycheck`, tombstone the paycheck's rows. Unit tests: after create, every listed schedule has a row for the paycheck; after delete, none is live. Undo of a create or delete restores the rows too.
- [x] 2.3 Add the backfill at budget load: for each live paycheck, insert the missing rows for its listed schedules. Unit test: a paycheck created without rows gets them, and running it twice changes nothing.

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
- [ ] 3.2 Add `loot-core/src/shared/feature-flags.ts`, holding the flag defaults, `FEATURE_FLAG_REQUIRES` and `isFlagOn` moved from `desktop-client/src/hooks/useFeatureFlag.ts:22-55`. Point `useFeatureFlag` and `Experimental.tsx` at it, and re-export from the hook so other callers don't change. Add a server helper that reads `SELECT id, value FROM preferences WHERE id LIKE 'flags.%'` and returns `isFlagOn(prefs, 'paychecks')`. Unit tests for the shared rule and the server helper:
  - the upgrade case: `businessCalendars` on and `flags.paychecks` unset is **on**;
  - `flags.paychecks` `'true'` with `businessCalendars` off is off;
  - both on is on, and `flags.paychecks` `'false'` is off.

  Verify the existing `useFeatureFlag` and `Experimental` tests still pass.
- [ ] 3.3 Gate the reconcile on that effective flag: it does nothing while the flag is off. Verify "Deleted while paychecks were off" passes, for both the local and the synced toggle.
- [ ] 3.4 Hook it into the schedules `sync` handler (`server/schedules/app.ts:987-1000`), **before** the `lastScheduleRun !== currentDay()` guard, leaving the guarded `advanceSchedulesService` call as it is. Call `void runMutator(() => reconcilePaycheckSchedules())`:
  - on `type === 'success'`, when `tables` includes `paychecks`, `paycheck_schedules` or `schedules`;
  - on `type === 'applied'` or `'success'`, when `tables` includes `preferences` and the effective flag is on.

  Also run it at budget load, after the backfill, and for the saved paycheck at the end of `paycheck-update`. Verify every 1.2 test passes, including "A later sync on the same day", "Nothing posts before the clean-up" and both toggles in "Deleted while paychecks were off".

## 4. Edit paycheck instead of Delete

- [ ] 4.1 On the mobile schedule edit page, show the paycheck note for a schedule `usePaycheckMembership().scheduleIds` contains, following the UX Designer's conditions (PR #91, sc-556):
  1. Reuse the desktop note's text word for word, with the "Edit paycheck" button. Add no phone-only text.
  2. On a phone, the button opens the paycheck's own page, not the desktop dialog, the same way the Schedules page opens paychecks.
  3. Put the note at the top of the page, above the schedule form, aligned with the form's side padding.
  4. On phones, stack the grey text with "Edit paycheck" below it, left-aligned. Use a 40px normal (not primary) button; Save stays the only primary action. Desktop keeps its current row.
  5. The page offers no Delete anywhere, and the guard test checks that.
  6. Add a VRT of the stacked note at 375px, in light and dark (see the `running-vrts` skill).

  In the desktop editor, make sure `PaycheckScheduleNote` offers "Edit paycheck". If a list ever shows a listed schedule, its row menu or swipe offers "Edit paycheck" instead of Delete. Verify every 1.3 test passes and the VRTs match.

## 5. Docs and checks

- [ ] 5.1 Update ADR 2's "Concurrent edits aren't handled yet (sc-556)" to describe the mapping table, the two-way reconcile, and when it runs. In ADR 4's "remove fork data" steps, add:
  - `DROP TABLE paycheck_schedules` to step 3;
  - the new migration's id to step 6's `__migrations__` delete;
  - `paycheck_schedules` to step 7's list of `dataset` values whose `messages_crdt` and `messages_pending` rows are deleted.

  Amend ADR 6 (`docs/adr/0006-feature-flag-policy.md`):
  - under "Gate only the UI", add the one server-side exception: the paycheck reconcile runs only while the effective `paychecks` flag is on, because it would otherwise undo a delete the user made while the feature was off;
  - under "What the code does today", say that `loot-core/src/shared/feature-flags.ts` is the one place the effective flag is computed, used by `useFeatureFlag`, `Experimental.tsx` and the server.

  Verify that ADR 2 and all three ADR 4 steps name `paycheck_schedules` or its migration id, and that ADR 6 names the exception and the shared module.
- [ ] 5.2 Run the loot-core and desktop-client tests, `yarn typecheck` and `yarn lint`; all pass. The existing `server/paychecks` tests are unchanged and pass.

## Workflow follow-up

- Merge after #87 and sc-558's change, in that order. Merge each previous one in rather than rebasing.

- Archive the change when sc-556 is Done.
- File follow-ups for any Product decision the PO defers: a conflict notice (3), and a report of strays from before this change (4).
