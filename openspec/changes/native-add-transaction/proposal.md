# Proposal

## Why

This change ships story sc-3602 in epic 470. Adding a transaction is the most frequent action in the iPhone app, and it is still the web form. The native tab bar's Add button and the native register (sc-3611) both open that web form today. ADR 11 and Ken's rule (2026-11-15: native first for everything) make it the next native screen. It runs over the one loot-core through the bridge.

- Explore findings: sc-3602 comment 5078. Product Owner scope: comment 5094.
- Design: Figma "Home Economics" native design system, Accounts page (node 25-2): the Add sheet and the same sheet in edit mode.

## What Changes

- **Group 1, engine (sc-3602):** four new native handlers.
  - Reads: `native/transaction-form` (accounts, transfer targets, categories, and for edit the whole transaction with a digest) and `native/payees` (capped search of live payees).
  - `native/transaction-preview` runs the same rules as the web form and evaluates the amount arithmetic in loot-core.
  - `native/transaction-save` is one undoable, all-or-nothing write. It refuses with `[native:changed-since]` when anything it would touch changed after the form was read, and with `[native:preview-stale]` when rules would store something other than what the person saw.
  - A native-chosen id makes a retried add safe.
  - Also in this group: five new limits, the shared refusal codes, contract fixtures, perf gates, both allowlists, and the reconciled-split-parent rule added to `native/transactions-delete`.
- **Group 2, view model (sc-3602):** `TransactionFormViewModel` in `NativeBridgeCore`, tested against the fake transport with an injected clock.
- **Group 3, iPhone sheet (sc-3602):**
  - **The form:** add and edit, the payee, category and account pickers, the amount field with sign and arithmetic, splits, transfers, date, notes and cleared.
  - **Delete:** through the existing `native/transactions-delete`.
  - **Routing and hand-off:** routing from the Add tab, the native register and `/transactions/<id>`; the web hand-off for "Make recurring".
  - **The switch:** `NativeScreen.addTransaction`. It stays off until a hands-on Simulator pass, then becomes on by default with a Settings toggle.
  - VoiceOver, Dynamic Type and hardware-keyboard entry are requirements.

Mobile scope: this change covers the iPhone app's Add sheet and edit sheet. The web form (`components/mobile/transactions/TransactionEdit.tsx`) and the desktop register do not change. While the switch is off, the iPhone shows the web form as today.

How the split-out work follows:

- **Attachments, sc-5091:**
  - Until then, the native sheet lists a saved transaction's documents by name.
  - "Add document" hands off to the web editor for that transaction.
  - On a transaction being added, the Documents row says documents can be added once it is saved. Nothing is saved early.
  - sc-5091 adds `native/attachment-add` and the native pickers on these handlers.
- **Mac inspector, sc-5092 (under the Mac app, sc-3629):** the same handlers and view model drive the Mac right-side inspector. Ken's open question (save as you go, or a Save button) is settled there; it does not change this change's handlers.
- **Not in this change:**
  - native rules (sc-4618) and the schedule editor (sc-4617). "Make recurring" hands off to the web until sc-4617.
  - payee-location suggestions.
  - duplicate detection on a manual add (the web has none).
  - editing the new limits in a Settings screen (sc-4643).

## Capabilities

### New Capabilities

- `native-add-transaction`: the native add and edit transaction sheet on iPhone, with its switch, pickers, amount entry, splits, transfers, validation, save, delete, routing and accessibility.

### Modified Capabilities

- `native-bridge`: added requirements for the transaction form reads, the preview, the save, their limits and refusal codes, the latency gates, and allowlisting them. Additive only.

## Impact

- **loot-core:**
  - `server/native/transaction-form.ts` (new), `server/native/app.ts`, the `LIMITS` registry (moved out of `reconcile-lock.ts` if Group 1 needs that);
  - fixtures and `native-refusal-codes.json`;
  - tests and `transaction-form.perf.test.ts`.
- **desktop-client:**
  - `data/native-bridge-allowlist.json` and `native/nativeBridge.ts` (the argument lists);
  - `native/nativeChrome.ts` and `components/settings/NativeScreens.tsx`;
  - the hand-off message handler.
- **iOS:**
  - `NativeBridgeCore`: the client allowlist, the switch, the router, the view model and the decode tests;
  - the App target: the sheet's SwiftUI sources added to `App.xcodeproj`, `NativeTabBarController` and the register's row tap.
- **MCP:** four `coverage.json` skips. Agents already add and edit transactions with `write_create_transactions` and `write_update_transactions`.
- **AI:** nothing in this change uses AI features. Rules and learn-categories are the only auto-fill, with or without AI turned on.
- **Reviews:** Tester, Security Analyst (allowlist and writes), Product Owner, and the UX Designer against the Figma frames.
