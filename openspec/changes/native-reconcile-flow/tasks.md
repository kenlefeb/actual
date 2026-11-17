# Tasks

Test-first: write the tests, see them fail, then write the code. One story per group, one PR per group. Group 1 ships first and blocks group 2.

## 1. Pre-fill, source and recorded confirmation on web and Electron (sc-4802)

- [x] 1.0 Bank sync stamps `bank-balance-at-<id>` when it writes `balance_current` (design D2). Failing tests first: written with the balance, not when the bank returns none, absent on older accounts
- [x] 1.0a Modify the merged `account-statement-balance-save` (design D3): no `entered_by` parameter, derived from the signed-in user; label checks (`bank-sync`, `cleared`, `statement`, `entered`). Failing tests first for each refusal and for the derived name; update the sc-4793 tests that passed `entered_by`
- [x] 1.1 `account-statement-balance-prefill` in loot-core (design D2) with failing tests first: recent bank balance is the prefill, a stale one, or one with no write stamp, is an alternative, no source is empty, the cleared balance is never the prefill and is always an alternative, credit and loan sign, the max-age preference (default 7, ceiling 30, bad values fall back to 7). Add it to the API-free internal handlers
- [x] 1.2 Desktop `ReconcileMenu` and phone `AccountReconcileModal`: stop pre-filling the cleared balance; render the prefill and its source line (tooltip and "Bank Sync Settings…" link on desktop, tap note on phone), "Entered by you" and "Restore bank balance", "Use cleared balance", empty with a hint and Confirm off. Failing component tests first; copy through `Trans`, numbers through `FinancialText`
- [x] 1.2a Web Settings (desktop and phone web, under Bank Sync): the "Use the bank balance if synced within … days" field for `reconcile-bank-balance-max-age-days`, validated to 1 to 30. Failing tests first; `Trans` copy
- [x] 1.3 Save the sc-4793 record on confirm with the right source; the cleared-source note (design D3); nothing saved on leave. Failing tests first for each source and for leaving
- [ ] 1.4 VRT snapshots for the changed dialogs, in Docker and scoped to the changed tests; release note for the web behaviour change
- [ ] 1.5 Run `yarn typecheck`, `yarn lint`, `openspec validate --all --strict` and the tests; UX Designer reviews against the frames

## 2. Native reconcile on iPhone: checklist, step 1 and step 2 (sc-4801)

- [ ] 2.1 `native/reconcile-month`, `native/reconcile-rows`, `native/reconcile-tick`, `native/reconcile-list-set` in `server/native/app.ts` (design D5). Failing contract tests first on a seed with splits, a reconciled row and a transfer: statuses, exclusion default, tick refuses reconciled, another account's id (whole call fails) and a lone split child, sets a parent's children, and is one undo step, summary equals the MCP's cleared balance, list write touches only its preference; a perf test like `native/app.perf.test.ts`
- [ ] 2.2 Allowlist the handlers (Swift list and `native-bridge-allowlist.json`) and the `presentReconcile` chrome message, tests first: the lists are equal, an off-list name is refused natively, a message from another origin is ignored
- [ ] 2.3 `NativeScreen.reconcile` switch that reads **on** when unset (Ken, 2026-11-15), its Settings toggle to turn it off, and the script entry (design D1). Failing tests first: unset is on, off is off, the toggle persists across a reload
- [ ] 2.4 Page side: the ••• › Reconcile… item and the Accounts banner send `presentReconcile` when the switch is on and fall back to the dialog otherwise; banner states (due, collapsed, hidden). Failing tests first
- [ ] 2.5 Swift view models (`ReconcileMonthViewModel`, `ReconcileStepOneViewModel`, `ReconcileTickViewModel`) against a fake transport and fixtures: loaded, error and timeout keep the last values, coalesced re-reads, Edit List, tick and difference. Failing tests first
- [ ] 2.6 SwiftUI screens: checklist with Edit List, step 1 in its three states, step 2 with the pinned summary, `NativeTransactionRow` (new, reused later by Accounts), tap and swipe ticks, haptic, "To tick" and "All", full-screen large detent. Verify in the Simulator against the Figma frames, light and dark
- [ ] 2.7 Dynamic Type to AX5, VoiceOver (step announcement, difference live region, row labels and custom actions), localization of all text; notes on the story; UX Designer review
- [ ] 2.8 File the Backlog story for the assistant nudge (design D6)

## 3. Reconcile on Mac (sc-4801)

- [ ] 3.1 Once the Mac app (sc-3629) exists: sidebar destination with badge and ⇧⌘R, checklist, step 1 in the content area, step 2 register table with Space to tick and the keyboard flow of the frames, on the same handlers. Failing tests first; with the switch off the sidebar item opens the web dialog
- [ ] 3.2 Keyboard-only use end to end, Dark Mode, VoiceOver and minimum window size; notes on the story

## Workflow follow-up

- Archive when sc-4801 merges, after the open `native-bridge` changes archive. Then move each story's change link to the archive path, add the `spec:reconcile-flow` label, and add the spec to the epic description.
