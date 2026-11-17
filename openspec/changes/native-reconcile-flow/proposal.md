# Proposal

## Why

Stories sc-4802 (web and Electron pre-fill) and sc-4801 (native Reconcile B1), both in Integrations (epic 1550) and both follow-ups to sc-4793 and sc-4800. The app pre-fills the reconcile statement balance with the account's own cleared balance, which is the number it is compared with, so clicking Reconcile always passes, and it keeps no record of what the person confirmed. Ken (sc-4793 comments 4795 and 4799; sc-4801 comment 4824): the person confirms the balance, pre-filled from the best source with the source shown; a dedicated native Reconcile flow; "Reconcile this month" lists all open accounts by default with an Edit List control. Design: Figma "Reconcile — iPhone & Mac" (node 49-2). Production reconcile waits on this change and on B2 (sc-4825, steps 3 and 4, a later change).

## What Changes

- **Group 1, sc-4802:** one loot-core resolver for the pre-fill (`account-statement-balance-prefill`), used by web and native. The web and Electron reconcile dialogs (desktop menu, phone modal) stop pre-filling the cleared balance, pre-fill the recent bank-sync balance (freshness window a synced preference, default 7 days, at most 30) with a source indicator, offer "Use cleared balance" one tap away, save the sc-4793 record on confirm, and say at once when a confirmed cleared balance cannot be used by the assistant. Desktop and phone web both.
- **Group 2, sc-4801, iPhone:** a SwiftUI Reconcile flow over the one loot-core: the "Reconcile this month" checklist (all open accounts by default, Edit List, a synced exclusion list), step 1 (confirm the balance) and step 2 (tick off, with a pinned Statement / Cleared / Difference summary). Entry points that exist today (design D1): the account's ••• menu "Reconcile…" and a banner at the top of the Accounts tab's web list, both asking the native chrome to present the flow, behind a `NativeScreen.reconcile` switch with the web dialog as fallback.
- **Group 3, sc-4801, Mac:** the same flow as a sidebar destination and content-area steps, **after the Mac app (sc-3629) exists**, as the paychecks change did (design D8).
- **Bridge:** three batched native handlers (`native/reconcile-month`, `native/reconcile-rows`, `native/reconcile-tick`), one write (`native/reconcile-list-set`), and the sc-4793 and prefill handlers allowlisted; one new chrome message to present the flow.

Mobile scope: group 1 covers the desktop and phone web layouts; group 2 is the iPhone screens; the Mac native screens are group 3.

Not in this change: steps 3 and 4 (resolve the difference, adjustment, lock; sc-4825); an assistant nudge for the "Ready to confirm" group (no source exists, design D6; Backlog story); a statement-derived pre-fill source (slot only); a native Accounts screen; any change to the MCP tool.

## Capabilities

### New Capabilities

- `reconcile-flow`: the pre-fill and its source, the recorded confirmation, the monthly checklist, steps 1 and 2 on web, iPhone and Mac.

### Modified Capabilities

- `native-bridge`: an added requirement allowlisting the reconcile handlers and the present message. Additive only: the active `add-native-paychecks-screen` modifies the handler-class requirement, and this change leaves that text alone (design D9).

## Impact

- **loot-core:** `server/accounts/` (prefill resolver, checklist and rows reads, tick, list write), `server/native/app.ts`, the prefs key types.
- **desktop-client:** `components/accounts/Reconcile.tsx`, `components/modals/AccountReconcileModal.tsx`, `AccountPage.tsx` (menu entry), the Accounts page banner, `data/native-bridge-allowlist.json`, tests, VRT snapshots for the changed dialogs.
- **iOS:** `NativeBridgeCore` (view models, allowlist, the switch), the app's reconcile screens and the Settings toggle.
- **Reviews:** Tester; Solution Architect; Security Analyst (the recorded balance's source); Product Owner; UX Designer against the Figma frames.
