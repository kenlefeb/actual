# Design

## Context

See `proposal.md`. Facts about the code, measured on `development` on 2026-11-14:

- `packages/loot-core/src/server/paychecks/app.ts` already has these handlers:
  - `paychecks-get`.
  - `paycheck-create`, `paycheck-update`, `paycheck-delete` and `paycheck-skip-next`, all `mutator(undoable(...))`. Update runs `reconcilePaycheckSchedules()`.
  - `paycheck-year-to-date`, which returns zeros for a paycheck with no history.
  - `paychecks-clearing-status`, which loops over every paycheck in one call.
  - `account-set-business-days`, which rewrites every paycheck that deposits to the account.
- Server `validate()` throws one English message at save.
- The web works out what the list shows in the browser:
  - `planPaycheck` (`desktop-client/src/components/schedules/PaycheckRow.tsx`) uses `computePaycheck`, `getRelativeOccurrences` and `toRelativeDay`, inside `withScheduleLookups`. It is fed by a client `q('transactions')` query for the posted pay dates (`PaychecksSection.tsx`).
  - Schedule statuses come from `getStatus` and `getHasTransactionsQuery` (`#shared/schedules`), run in `useSchedules`.
  - The list hides the schedules in `paycheck_schedules` (`usePaycheckMembership`).
- `usePaycheckForm.ts` builds the form errors (about ten rules) plus `computePaycheck` errors on every render. The save is two steps: the paycheck, then `account-set-business-days` once for each changed account.
- `native/budget-month` (`src/server/native/app.ts`) is the pattern for a batched read: a contract test, fixtures that Swift decodes, and a perf test.
- A local mutator write ends in `applyMessages`, which emits a `sync` event of type `applied` with the changed tables (`server/sync/index.ts`). The page forwards it to native as `sync-event`, so native sees its own writes and other screens' writes as change events.
- `undo` (`server/main.ts`) is a mutator over the one global undo stack. One `undoable` handler call is one undo step.

## Goals / Non-Goals

**Goals**

- Native and web show the same numbers and messages because they run the same loot-core functions, not because two copies match.
- No paycheck rule in Swift: Swift formats values and maps error codes to text, and nothing more.

**Non-Goals**

- No change to paycheck behaviour. The `paychecks` and `paycheck-planning` specs stay as they are.
- No native single-schedule editor.

## Decisions

### 1. Move the plan and the draft checks into loot-core, don't copy them

`planPaycheck` moves unchanged into `#shared/paychecks`. So do the form rules from `usePaycheckForm`, as `validatePaycheckDraft`, which returns `{code, field}` errors and includes `computePaycheck`'s codes. The web imports both. The existing web tests (PaycheckRow, PaychecksSection, the paycheck editor tests) must pass without edits, which shows the move changed nothing.

Alternative: keep them in desktop-client and port them to Swift. Rejected, because ADR 11 forbids a second engine and the two copies would drift.

### 2. `native/schedules-paychecks`: one batched read for the list and the row

In `server/native/app.ts`, with no arguments, the handler:

1. Calls `refreshScheduleDateLookup()`, then sets the business-calendar and schedule lookups that `withScheduleLookups` sets on the web.
2. Calls `getPaychecks()`, then reads the posted pay dates with the web's own AQL query (`q('transactions').filter({schedule: {$oneof: paySchedules}}).select(['schedule', 'date'])`, moved from `PaychecksSection.tsx`). Reading through AQL keeps split and tombstoned rows handled as the web handles them.
3. Runs `planPaycheck` for each paycheck, sorted as the web sorts them.
4. Joins on `getClearingStatus()`.
5. Reads the schedules through AQL (`q('schedules')`, as `useSchedules` does, so `_date`, `next_date` and `completed` match), minus the ids in `paycheck_schedules`, each with `getStatus` (honouring each schedule's upcoming length and the `upcomingScheduledTransactionLength` pref).
6. Builds the currency block, from a helper shared with `native/budget-month`.
7. Returns `enabled: isPaychecksOn()`.
8. Builds the `summary`: the earliest next date, that paycheck's `netAmount`, the listed schedule count, `anyWarning` and `hasPaychecks`.

The row and the list read the same message, so they cannot disagree. Amounts are integer minor units.

Alternative: allowlist `paychecks-get`, `paychecks-clearing-status` and `query`, and combine them in Swift. Rejected: several round trips, and the plan would still be missing.

### 3. `native/paycheck-preview` for live editing

A read-only handler that takes a draft (name, definition, whether the clearing account is new, the new clearing account's name, and the days-early inputs). It returns:

- `netAmount` and the deposit amounts;
- the pay date and each deposit's date, moved for business days;
- the employer (payee) name, from which Swift formats the default name for a new clearing account ("{employer} Paycheck"), since that text is translated on the web;
- `errors: [{code, field}]` from `validatePaycheckDraft`.

The editor calls it debounced (about 250 ms after the last edit) and shows only the latest answer. Swift maps codes to English text. The table is a fixture that a vitest test checks against the web's messages, so "same messages" is tested.

Alternative: send translated strings. Rejected, because loot-core has no i18n.

### 4. `native/paycheck-save`: one write, all or nothing, one undo step

`mutator()` has no rollback: each db write is applied as it is made. Deferring them with `batchMessages` is not an option either, because the save reads its own writes (`recordGenerated` reads `paycheck_schedules`; `setAccountBusinessDays` rewrites schedules from the updated account). So all or nothing comes from two steps.

1. **Validate everything before the first write.** This covers the arguments at the boundary (the page and Swift check them too, as in add-native-budget-screen Decision 4), `validatePaycheckDraft`, the server `validate()`, each days-early value's range, and that every account it touches exists and is open. Any error refuses the save with nothing written.
2. **Revert on a later throw.** The handler is `mutator(undoable(save, metaFromToken))`. Inside it, `save` calls the create or update function and then each days-early change directly, not through handlers, so the whole save is one undo group (`withUndo` does not nest while `undoListening` is set). If a step throws, the `catch` first asks whether this group has recorded any undo entries (a read-only helper in `undo.ts`: is the latest history entry after this group's marker a recorded write). Only then does it call `undo()`, which reverts to the group's marker inside the same mutator, and drop the reverted group from the redo history (a small fork-only helper, so the web's Redo can't re-apply a half save). If the group recorded nothing, for example `getTransferPayee` throwing on the update path before any write, it just rethrows. Calling `undo()` there would revert the user's previous edit, possibly a web one, and the trim would drop its Redo.

Example of a late failure: another paycheck also deposits to Savings, and one of its transfer deductions points at a transfer payee that has gone missing. Rewriting it in step 4 throws after "Acme" is written. The catch reverts "Acme" and the Savings days-early value. Task 2.3 injects exactly this failure.

Alternative: call the existing handlers one by one, as the web does. Rejected: several 5 s round trips, and a half-saved state when one fails. The web's two-step save stays as it is.

### 5. Undo is token-checked in loot-core

`undo` is one global stack shared with the hidden web page, and change events can't tell native which write is on top: a write's own `applied` events all arrive before its result, one per db write, and the follow-up full sync sends `start` and `success` events with `tables: []`. So the check sits in loot-core, not in Swift:

- Each native write sends an `undoToken`, a nonce Swift makes for that write. `native/paycheck-save` and the existing `paycheck-skip-next` and `paycheck-delete` registrations become `undoable(fn, args => args.undoToken ? { nativeUndoToken: args.undoToken } : undefined)`. Web calls pass no token, so their undo meta is unchanged.
- `native/undo({token})` is a mutator. It finds the marker that `undo()` would revert to with exactly `undo()`'s walk: step back one from `CURSOR`, then back to the nearest marker (a small read-only helper in `undo.ts`). It reads that marker's meta, not `MESSAGE_HISTORY[CURSOR].meta`. The difference matters for a token write that recorded nothing. Its marker sits at `CURSOR`, `undo()` would walk past it and revert the previous group, and the exact walk finds that previous group's marker, which has no matching token. It calls `undo()` only if that meta's `nativeUndoToken` equals `token`, and otherwise throws a fixed "nothing to undo" error. Mutators run one at a time, so nothing undoable can slip in between the check and the undo.
- The bare `undo` and `redo` stay off the allowlist.

Swift offers Undo for about 10 s (PO, sc-4341), armed when the write's result arrives. Events before the result are the write's own. It withdraws the offer on timeout, on another write, when the user leaves the screen, or on a `sync-event` with non-empty `tables` (or an `undo-event`) after the result. That withdrawal is for the user's sake. Safety comes from the token: a stale tap is refused.

Residual risk: a remote change to the same rows that is applied after the offer's last event and before the user taps Undo is overwritten by the undo's old values. The web's own Undo has the same behaviour. The window is the time from a remote sync landing to the next coalesced event reaching Swift.

### 6. Year-to-date `hasHistory`

`paycheck-year-to-date` gains an additive `hasHistory: boolean` per year (true when at least one pay transaction counted). The web ignores it until it wants it. Swift shows the empty state when both years are false.

### 7. Switch, re-reads, Mac

- A `NativeScreen.paychecks` key in UserDefaults, reading on when unset (sc-5090), handled like `NativeScreen.budget` (add-native-budget-screen Decision 1: a user script tells the page, and Settings in the iOS app toggles it).
- The row and the list are overlays shown only while the switch is on and `enabled` is true. Otherwise the web screens show.
- Re-reads go through `ChangeCoalescer` on `sync-event`s whose tables include paychecks, paycheck_schedules, schedules, transactions, accounts or preferences, and on foreground.
- The view models live in `NativeBridgeCore`, free of platform code, so the Mac app (sc-3629) reuses them in sc-4352.

### 8. MCP coverage

`packages/mcp/coverage.json` gets `skip` lines:

- `native/schedules-paychecks` and `native/paycheck-preview`: MCP reads the same data through `list_paychecks` and `get_paychecks_clearing_status`.
- `native/paycheck-save`: paychecks are not in the MCP v1 write set.

The other names already have lines.

## Risks / Trade-offs

- [Moving web code changes behaviour by accident] → the move is mechanical, the web tests stay unchanged, and the native contract test compares the read with `planPaycheck` on the same seed.
- [The read is slow on 20 × 4] → most of the time went to `planPaycheck`'s occurrence math (rschedule over its ±366-day window), not queries. `#shared/relative-dates` now caches source occurrences, keyed on content (the source, the query and the calendar its weekend moves use; at most 1,000 entries), so `planPaycheck` itself is unchanged. `getClearingStatus` also batches its queries: one each for balances, pay dates and deposit links. The perf gate covers warm reads and reads with one paycheck changed, and prints the cold read. Any further work stays in loot-core, never in Swift (sc-4341, Architect decision).
- [Undo undoes someone else's change] → `native/undo` checks the token on the top undo step inside the mutator, so it can only undo the native write it names (Decision 5). The remaining risk is the remote-overwrite case described there.
- [The save reverts through `undo()`] → covered by an injected late-failure test (task 2.3); the fork-only helpers in `undo.ts` are small and read or trim only.
- [`native-bridge` deltas from open changes (add-native-budget-screen, native-budget-month-range)] → this delta adds requirements and renames and modifies only the handler-class requirement, which is already in the main spec. Archive after those changes, or rebase the MODIFIED block when they archive.
- [Debounced preview and a stale answer] → only the latest request's answer is shown, and save uses `native/paycheck-save`'s own validation, never the preview's.

## Migration Plan

No data migration. Ships on, behind a switch (sc-5090). Rollback is turning it off.
