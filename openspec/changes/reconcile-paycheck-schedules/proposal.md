# Proposal

## Why

Two devices that each add a deposit to the same paycheck before syncing leave one deposit's schedule active but listed in no paycheck. Forecasts then count that deposit on top of net pay (Shortcut sc-556; ADR 2, ADR 3).

The paycheck definition is one JSON value, and the newest write wins. Each device generates the schedules for its own edit, though, and both devices' new schedule rows survive the merge. A save deletes only the schedules its stored definition used to list. The losing device's schedule was never listed, so no later save removes it.

This was reproduced with real sync messages (design.md, "Reproduction"):
- After the merge, the definition lists Savings, Checking and Travel.
- "Acme → Emergency" (200.00) stays active.
- The deposit schedules total 3,200.00 against 3,000.00 of net pay.
- Saving the paycheck again doesn't remove it.

## What Changes

- **Remember which paycheck generated each schedule.** Each pay and deposit schedule a paycheck generates gets a row in a new fork-only table, `paycheck_schedules`. Each device writes its own rows, so the record survives a concurrent edit where the definition doesn't.
- **Reconcile, in both directions:** a schedule recorded for a paycheck but not listed in its definition is deleted, like a deposit the user removed. A schedule a live definition lists but that is missing or deleted is restored, in place when its row still exists, so a save that crossed with the other device's clean-up isn't lost. This runs:
  - after every successful sync, not just the first of the day, queued before the schedules service posts anything;
  - when the budget loads;
  - on every paycheck save.
- **Posted transactions stay.** Transactions already posted from such a schedule are kept, as when a deposit is removed today.
- **Backfill:** existing paychecks get their mapping rows from their definitions when the budget opens.
- **Delete:** deleting a paycheck also removes its mapping rows.

Non-goals:
- Merging the two devices' deposits into one definition. Last write wins stays (ADR 3); see Product decisions.
- Detecting strays left by concurrent edits before this change. They aren't in the mapping (design.md, Product decisions 4).
- A public paychecks API.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `paychecks`: adds two requirements. They're added rather than folded into "Editing and deleting paychecks", which sc-558's open change already modifies.
  - "Edits on two devices": every active schedule a paycheck generated is listed in its definition, and one left behind by edits on two devices is deleted after sync, before anything posts.
  - "Clean-up after edits on two devices": that clean-up keeps posted transactions and never deletes a user's own schedule.

## Impact

- **Code:** `packages/loot-core` only.
  - A fork migration adding `paycheck_schedules`. It's additive, as ADR 4 allows.
  - The AQL schema entry for the new table.
  - `server/paychecks/app.ts`: record the mapping in `writePaycheckSchedules`, add a reconcile function, and drop mappings in `deletePaycheck`.
  - A hook on the server `sync` success event that runs before `advanceSchedulesService` (`server/schedules/app.ts:979`), plus one at budget load.
- **Data:** one row per generated schedule. ADR 4's "remove fork data" export path also drops `paycheck_schedules`.
- **ADR 2:** "Consequences" is updated to say when the reconcile runs.
- **Related:** sc-558's "managed by paycheck" lookup keeps its meaning, "listed in a live definition". The new table is only for finding strays (design.md).
