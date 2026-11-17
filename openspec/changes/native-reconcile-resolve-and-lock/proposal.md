# Proposal

## Why

Story sc-4825 (Integrations, epic 1550), Reconcile B2: B1 (sc-4801, change `native-reconcile-flow`) ends at step 2 with "finish in the register". B2 adds the rest of the dedicated native flow on iPhone: step 3 (resolve the difference), step 4 (lock) and the done screen, so a reconcile can finish natively. Design: Figma "Reconcile — iPhone & Mac" (node 49-2), step 3, the adjustment sheet, step 4 and done. Ken approved going ahead (2026-11-17). Mac is sc-4872, blocked by the native Mac app. Production reconcile waits on this.

## What Changes

- **Step 3, resolve:** likely matches from one loot-core read (a row equal to the difference, two that sum to it, a cleared row equal to its negative), a search (amount, payee, note, swapped digits), "Add the missing transaction" (the existing web add form, with the account and amount filled in), and last an explicit adjustment in its own confirm sheet that spells out the amount.
- **Step 4, lock:** lists what locks (this account's cleared, unreconciled rows and their split children), the linked transfer legs in other accounts that are listed and not locked, the balance on record with its source, and the note that locked rows unlock only in the app. Locking reuses one loot-core selection that equals the app's and the MCP's, consumes the human-recorded balance whenever rows lock, verifies the balance, and stamps `last_reconciled` when verified.
- **Done:** a calm success screen, the checklist's Done status, and the next due account.
- **Replaces B1's exit:** at 0.00 step 2 continues to step 4.
- **Bridge:** `native/reconcile-matches`, `native/reconcile-lock-preview`, `native/reconcile-adjust`, `native/reconcile-lock`, and a `search` argument on `native/reconcile-rows`, allowlisted; none reachable through `api/`.
- **Limits are settings:** match candidates (300, ceiling 2,000), match results (5, ceiling 20), lock list rows (200, ceiling 2,000), as synced preferences.

Mobile scope: the iPhone screens (group 2); the web add form's existing `amount` query parameter is made safe (finite and bounded). The Mac screens are sc-4872.

Not in this change: the Mac flow (sc-4872); moving the MCP's lock onto the loot-core selection (Backlog, needs a fork handler); unlock (sc-4784); the assistant nudge (Backlog); a native transaction form.

## Capabilities

### Modified Capabilities

- `reconcile-flow`: added requirements for steps 3 and 4, the adjustment, the lock and the done state. Additions only: the capability's requirements are in the active change `native-reconcile-flow`, not yet the main spec, so one of its requirements (the step 2 exit) is superseded by an added requirement here and folded at archive (design D8).
- `native-bridge`: an added requirement allowlisting the new handlers and keeping the lock and adjustment off `api/`.

## Impact

- **loot-core:** `server/accounts/reconcile-plan.ts` (the shared lock selection), `server/native/reconcile.ts` and `native/app.ts` (the handlers), prefs key types.
- **desktop-client:** `native-bridge-allowlist.json`; the mobile add-transaction form's existing `amount` parameter (a finite, bounded check).
- **iOS:** `NativeBridgeCore` (view models, allowlist) and the app's reconcile screens (steps 3 and 4, the adjustment sheet, done).
- **Reviews:** Tester; Solution Architect; Security Analyst (a native lock, adjustment creation, new bridge writes); Product Owner; UX Designer (Figma frames need two corrections, design D3 and D5).
