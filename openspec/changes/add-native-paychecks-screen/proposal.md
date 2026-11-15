# Proposal

## Why

Shortcut sc-4309 (umbrella), with sc-4341, sc-4343 and sc-4352. Schedules and Paychecks are still web screens inside the native Apple apps. Ken plans with them every pay period, and the UX Designer has finished the native designs for iPhone and Mac (Figma `2Ts4fUoFzCWfvubD9vgTWx`, node 31-2). ADR 11 (`docs/adr/0011-native-ui-without-upstream-parity.md`) moves screens to SwiftUI one at a time over the one loot-core, and keeps every number and rule in loot-core. Today the web works out the paycheck plan (next date, skipped dates, later dates, deposit dates) and the paycheck form's errors in the browser, so a native screen cannot reuse them without first moving them into loot-core.

## What Changes

- **New capability `native-paychecks-screen`**:
  - The native Schedules & Paychecks list on iPhone (sc-4341).
  - The paycheck editor as a full-height sheet (sc-4343).
  - The Budget-tab summary row and its per-screen switch with web fallback (sc-4309).
  - The Mac window and editor sheet (sc-4352).
  - Scenarios come from the stories' acceptance criteria and Ken's decisions of 2026-11-14: the summary row sits on the Budget tab, the Skip confirm button is teal, the editor is a full-height sheet with ✕ (cancel) and ✓ (save), and money uses the incoming-only colour.
- **The paycheck plan and draft checks move into loot-core.** The web's `planPaycheck` and the paycheck form's error rules move unchanged into loot-core's shared paycheck module. The web imports them from there, so the web and native screens run the same code.
- **Three new fork-only native handlers:**
  - `native/schedules-paychecks`: one batched read for the list and the summary row.
  - `native/paycheck-preview`: a read-only check of a draft (net pay, deposit amounts, dates, error codes).
  - `native/paycheck-save`: one all-or-nothing write, with one undo step, for the paycheck and its days-early changes.
  - `native/undo`: undoes a native write only when the top undo step carries that write's token.
  - `paycheck-year-to-date` gains an additive `hasHistory` flag.
- **Delta to `native-bridge`:**
  - The allowlist gains the paycheck handlers (`native/schedules-paychecks`, `native/paycheck-preview`, `paycheck-year-to-date`, `native/paycheck-save`, `paycheck-skip-next`, `paycheck-delete`).
  - It also gains `native/undo({token})`; the bare `undo` and `redo` stay off the list.
  - The handler-class requirement is renamed and modified to allow these.
  - A latency gate is added for the new read.

Duplicate-latest: the web phone editor has no "duplicate the latest paycheck" action. The only spec text is paycheck-planning's "Duplicate of the latest paycheck", which is about a pay transaction imported twice. The native list covers that by running the same `planPaycheck`, and has a scenario for it.

Out of scope: editing a single schedule (stays on the web), schedule forms beyond what the web phone UI does, Android, and any change to the web screens' behaviour. Each story writes its own code; this change writes none.

## Capabilities

### New Capabilities

- `native-paychecks-screen`: the SwiftUI Schedules & Paychecks list, paycheck editor and Budget-tab summary row on iPhone, and the window and sheet on Mac.

### Modified Capabilities

- `native-bridge`: allowlists the paycheck handlers and `native/undo`, renames and modifies the handler-class rule, and adds the batched paycheck read with its latency gate.

## Mobile scope

This change is the mobile screen: the iPhone Budget tab's summary row, the native list and the editor sheet, in `packages/mobile-client/ios/` and `NativeBridgeCore`. The Mac window comes after the Mac app (sc-3629). The web desktop and web phone screens (`components/schedules/`, `components/mobile/schedules/`) keep their behaviour. Their code changes only to import the moved functions. ADR 11 makes native screens Apple-only, with no upstream parity (Ken, 2026-11-11).

## Decisions for Ken

None. Ken's design decisions (2026-11-14) are recorded on sc-4309. The PO settled the rest on the stories: the schedule count is the list's count, the row hides while paychecks are off, native gets Undo, saving is all-or-nothing, and sc-4341 ships first.

## Impact

- loot-core:
  - `src/shared/paychecks.ts` gains the plan and the draft checks.
  - `src/server/native/app.ts` gains the three handlers.
  - `src/server/paychecks/app.ts`: year-to-date reports `hasHistory`, skip and delete record an optional undo token, and the create, update and business-days functions are exported for the save handler.
  - `src/server/undo.ts`: two small fork-only helpers, one that reads the top undo step's marker meta and one that drops a reverted group from the redo history.
- desktop-client:
  - `PaycheckRow.tsx`, `PaychecksSection.tsx` and `usePaycheckForm.ts` import the moved functions.
  - `src/data/native-bridge-allowlist.json` and the page bridge's write checks change.
- iOS: `NativeBridgeCore` (allowlist, view models, the screen switch) and the app's Budget tab, list and sheet.
- `packages/mcp/coverage.json`: lines for the new native handlers.
