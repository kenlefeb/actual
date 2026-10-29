# Design

## Context

See proposal.md (Why) and ADR 2 and ADR 3.

- **How schedules are written:**
  - `writePaycheckSchedules` (`server/paychecks/app.ts:232-358`) updates the schedules the **stored** definition lists, creates any that are missing, and deletes deposit schedules that the stored definition listed but the new one doesn't (lines 349-356).
  - A schedule created by another device's edit isn't in the stored definition. So nothing ever deletes it.
- **What the merge does:**
  - Sync merges cell by cell, and the newest write wins (ADR 3). `paychecks.definition` is one cell, so one device's deposit list replaces the other's.
  - Each device's new schedule, rule and `schedules_next_date` rows are separate rows, so both survive.
- **Why forecasts double-count:** they read every schedule with `tombstone = 0` and `completed = false` (`server/forecast/forecast-schedules.ts:72-78`). Previews and the Schedules page do the same, so the stray is counted.
- **What runs after a sync:**
  - The server emits `app.events` `sync` `{ type: 'success', tables }` once a full sync has finished, after every page of messages is applied (`server/sync/index.ts:869-875`).
  - `server/schedules/app.ts:979-999` handles that event by running `advanceSchedulesService`, which can post due transactions.
- **The sc-558 lookup:** "managed by a paycheck" means a live paycheck's definition lists the schedule's id (`openspec/changes/paycheck-schedules-api-guard/design.md`, "One lookup in the paychecks module"). A stray isn't managed under that definition, and sc-558 explicitly leaves it to this change.

### Reproduction

Reproduced through real sync messages in a throwaway loot-core test, which isn't committed. Task 1.1 makes it the failing test.
1. Enable syncing mode (`setSyncingMode('enabled')`, `mockSyncServer.reset()`), set up accounts, and create "Acme" with Savings (500.00, fixed) and Checking (remainder) from 3,000.00 gross.
2. Snapshot the database (better-sqlite3 `serialize()`), and note the newest `messages_crdt.timestamp`.
3. **Device B:** add an Emergency deposit (200.00). Capture its 27 `messages_crdt` rows.
4. Restore the snapshot with `openDatabase(buffer)`, then `loadMappings()` and `loadRules()`. This device never saw B's edit.
5. **Device A:** add a Travel deposit (100.00).
6. Apply B's rows with `applyMessages`, decoding values with `deserializeValue`.
7. **Result:**
   - The definition is A's: Savings, Checking, Travel.
   - "Acme → Emergency" (200.00) is active and unlisted.
   - Deposit schedules total 3,200.00 against 3,000.00 net.
   - Saving "Acme" again on A leaves the stray in place.

## Goals / Non-Goals

**Goals:**
- After any merge, every active schedule a paycheck generated is listed in a live definition.
- The clean-up never deletes a user's own schedule, and never deletes transactions.
- It finishes before the schedules service can post from a stray.

**Non-Goals:**
- Merging deposit lists. Last write wins stays (ADR 3).
- Making the clean-up undoable. It's a repair to match the merged data, not a user action.
- Finding strays that concurrent edits left before this change (Product decisions 4).

## Decisions

### Record what each paycheck generated in a new `paycheck_schedules` table
- **Migration:** a fork migration creates `paycheck_schedules (id TEXT PRIMARY KEY, paycheck TEXT, tombstone INTEGER DEFAULT 0)`. The id is the schedule's id, and the table gets an AQL schema entry.
- **Write:** `writePaycheckSchedules` inserts a row for every pay and deposit schedule it creates.
- **Delete:** `deletePaycheck` tombstones the paycheck's rows.
- **Why a table:** each device inserts its own rows, and rows merge, so the record survives the edit that loses the definition. It's the only fork-only place that does: the definition is one cell, and ADR 2 says it's the source of truth for which schedules are *wanted*. The table only says which schedules a paycheck *made*.
- **Alternative: infer strays.** A schedule relative to a paycheck's pay schedule, paying from its clearing account's transfer payee, and named "<paycheck> → <account>". Rejected. A user can make their own relative schedule on a pay date (`schedule-relative-dates`), and deleting one by mistake loses user data. The spec forbids that.
- **Alternative: deterministic schedule ids** derived from the paycheck and deposit ids. Rejected:
  - `createSchedule` assigns UUIDs, so this would mean changing upstream schedule code.
  - Existing schedules would keep UUID ids, so the marker would only apply to new ones.
- **Alternative: a `schedules.paycheck_id` column.** Rejected. It adds a fork column to an upstream table, where ADR 4's export path and upstream compatibility are easier with a fork-only table.

### Delete the stray, as a removed deposit is deleted
`reconcilePaycheckSchedules()` finds every active schedule that has a `paycheck_schedules` row and either:
- isn't listed in its paycheck's live definition, or
- belongs to a paycheck that's missing or deleted.

It calls the existing `deleteSchedule` on each one and tombstones its mapping row. `deleteSchedule` tombstones the schedule and its rule, and leaves transactions alone, which is what "Remove a deposit" does today. A stray deposit has no relative dependents, so `refreshRelativeDependents` is a no-op.
- **Alternative: mark it `completed`.** That also drops it from forecasts, but it leaves a dead generated schedule visible in schedule lists, with nothing in the app able to edit it (Product decisions 1).

### When it runs
1. **On the `sync` `success` event, before `advanceSchedulesService`.** The schedules handler awaits the reconcile, then runs the service. That ordering is what the spec's "Nothing posts before the clean-up" scenario needs.
   - It runs only when `tables` includes `paychecks`, `paycheck_schedules` or `schedules`.
   - It runs through `runMutator`, not `undoable`, so it isn't in the undo history.
   - Running once per finished sync, rather than in a per-batch sync listener, means a page that holds the new rows but not yet the definition can't trigger it.
2. **At budget load**, after the backfill below. This catches budgets that synced on a version without this change.
3. **On every paycheck save**, for that paycheck, after `writePaycheckSchedules`. This replaces nothing: the existing previous-versus-new deletion stays.

Both devices may reconcile the same merge. Each tombstones the same rows, which converges, because a tombstone is the same value whichever device writes it.

### Backfill the mapping once
At budget load, for each live paycheck, insert any missing `paycheck_schedules` rows for its listed `paySchedule` and `deposits[].schedule`. Rows are keyed by schedule id, so the backfill is idempotent across devices and loads.

### Keep sc-558's lookup as it is
`getPaycheckManagingSchedule` keeps answering "which live definition lists this schedule". That's still the right test for the API guard: a stray left by another device isn't managed by anything, and it's deleted at the next reconcile anyway. The new table answers a different question ("did a paycheck make this?"). The reconcile uses both.

## Product decisions

For the Product Owner to confirm. A recommendation is given for each.

1. **Delete or complete the stray schedule?** Recommendation: **delete it**. It matches "Remove a deposit". It keeps generated schedules out of the Schedules page, which the spec hides for paychecks anyway. And the app can't edit an unlisted generated schedule.
2. **Transactions already posted from the stray?** Recommendation: **keep them**, unchanged. They're real transfers, possibly already reconciled with the bank. "Editing and deleting paychecks" already promises that saving never changes posted or linked transactions. The user can delete a duplicate by hand.
3. **Tell the user that the other device's deposit was dropped?** Recommendation: **not in this change**. Last write wins already drops edits silently, for every paycheck and calendar field (ADR 3). A notice for this one case would be inconsistent, and it belongs with a general conflict notice, if Ken wants one. File it as a follow-up if the PO agrees.
4. **Strays left before this change?** They have no mapping row, so the reconcile can't tell them from a user's own schedule. Recommendation: **out of scope**. Optionally, a later story could add a one-off report, the heuristic in "Alternative: infer strays", that lists suspected strays for the user to delete. It wouldn't delete anything automatically.

## Risks / Trade-offs

- **[A sync delivers a device's new mapping row before its definition write]:** the reconcile could delete a schedule the definition is about to list. → It runs only after a full sync finishes. One device's mutation is sent in one batch, so its rows and its definition arrive together. If a split ever happens, the next paycheck save recreates the missing schedule ("A missing one is recreated", ADR 2). The task 1.1 test covers the normal ordering.
- **[Reconcile cost on every sync]:** → It runs only when the synced tables include paycheck or schedule data. It reads one small table joined to `paychecks`.
- **[Two pending changes edit `server/paychecks/app.ts`]** (this one and sc-558's) → both add functions near the end of the file. Coordinate the merge order through the Director.
- **[Older clients on other devices]** don't write mapping rows for schedules they create. → The backfill at budget load maps everything a definition lists, so only strays created by an old client are missed. That's the same limit as Product decisions 4.

## Migration Plan

- One additive fork migration (ADR 4). The ADR 4 "remove fork data" export path adds `DROP TABLE paycheck_schedules`.
- **Rollback:** a build without this change ignores the table. Strays come back only from new concurrent edits.
