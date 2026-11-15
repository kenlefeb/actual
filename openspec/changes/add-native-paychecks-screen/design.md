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
2. Calls `getPaychecks()` and runs one SQL query for the posted dates of every pay schedule.
3. Runs `planPaycheck` for each paycheck, sorted as the web sorts them.
4. Joins on `getClearingStatus()`.
5. Reads the schedules, minus the ids in `paycheck_schedules`, each with `getStatus` (honouring each schedule's upcoming length and the `upcomingScheduledTransactionLength` pref).
6. Builds the currency block, from a helper shared with `native/budget-month`.
7. Returns `enabled: isPaychecksOn()`.
8. Builds the `summary`: the earliest next date, that paycheck's `netAmount`, the listed schedule count, `anyWarning` and `hasPaychecks`.

The row and the list read the same message, so they cannot disagree. Amounts are integer minor units.

Alternative: allowlist `paychecks-get`, `paychecks-clearing-status` and `query`, and combine them in Swift. Rejected: several round trips, and the plan would still be missing.

### 3. `native/paycheck-preview` for live editing

A read-only handler that takes a draft (name, definition, whether the clearing account is new, the new clearing account's name, and the days-early inputs). It returns:

- `netAmount` and the deposit amounts;
- the pay date and each deposit's date, moved for business days;
- the default name for a new clearing account;
- `errors: [{code, field}]` from `validatePaycheckDraft`.

The editor calls it debounced (about 250 ms after the last edit) and shows only the latest answer. Swift maps codes to English text. The table is a fixture that a vitest test checks against the web's messages, so "same messages" is tested.

Alternative: send translated strings. Rejected, because loot-core has no i18n.

### 4. `native/paycheck-save`: one write, all or nothing, one undo step

`mutator(undoable(save))`, where `save` does the following:

1. Validates its arguments at the boundary. The page side and Swift check them too, as in add-native-budget-screen Decision 4.
2. Runs `validatePaycheckDraft` and the server `validate()`, and refuses any error before writing.
3. Calls the create or update function directly, not through a handler, so no nested undo group is made.
4. Applies each changed days-early value, using `setAccountBusinessDays` exported as a function.

A throw at any step rolls back the whole write: the mutator's messages are not applied. Native saves therefore never half-succeed, unlike the web's two-step save, which stays as it is.

Alternative: call the existing handlers one by one, as the web does. Rejected: several 5 s round trips, and a half-saved state when one fails.

### 5. Undo

Native offers Undo for about 5 s after a successful `native/paycheck-save`, `paycheck-skip-next` or `paycheck-delete`. It withdraws the offer on timeout, on any change event other than the write's own `applied` event, on another write, or when the user leaves the screen.

`undo` is global, so the guard is in Swift. The typed `undo()` method refuses unless a screen holds an Undo offer, and the offer is single-use. The page refuses `undo` with arguments. `redo` is not allowlisted. A write's own `applied` event is recognised as the first event after the write's result, whose tables are only the ones that write touches.

Residual risk: a mutation from the web side in the same moment could be the one undone. Withdrawing the offer on any other event narrows that window to under one frame.

### 6. Year-to-date `hasHistory`

`paycheck-year-to-date` gains an additive `hasHistory: boolean` per year (true when at least one pay transaction counted). The web ignores it until it wants it. Swift shows the empty state when both years are false.

### 7. Switch, re-reads, Mac

- A `NativeScreen.paychecks` key in UserDefaults, default off, handled like `NativeScreen.budget` (add-native-budget-screen Decision 1: a user script tells the page, and Settings in the iOS app toggles it).
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
- [`getClearingStatus` runs a few queries per paycheck and per deposit] → the perf gate covers 20 × 4; if it misses, batch the queries in loot-core, never in Swift.
- [Undo undoes someone else's change] → the single-use offer, withdrawn on any other event (Decision 5).
- [`native-bridge` deltas from open changes (add-native-budget-screen, native-budget-month-range)] → this delta adds requirements and modifies only the handler-class requirement, which is already in the main spec. Archive after those changes, or rebase the MODIFIED block when they archive.
- [Debounced preview and a stale answer] → only the latest request's answer is shown, and save uses `native/paycheck-save`'s own validation, never the preview's.

## Migration Plan

No data migration. Ship behind the default-off switch. Rollback is turning it off.
