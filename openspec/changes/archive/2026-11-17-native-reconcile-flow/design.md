# Design

Facts read on origin/development and in the Figma page "Reconcile — iPhone & Mac" (node 49-2, 23 frames with notes):

- The iPhone root is `NativeTabBarController`: tabs Budget, Accounts, Reports, Settings, one web view and one loot-core; a tab or a screen can show a native overlay over its web screen behind a per-screen switch (`NativeScreenSwitch`, `window.__actualNativeScreens`), and the page and native talk through the `actualNativeChrome` message handler (`route`, `closed`, `nativeScreen`, `haptic`), origin-checked. Native Budget and Schedules & Paychecks overlays exist; **the Accounts tab and its account screens are web.**
- **There is no Mac app yet** (sc-3629); Mac today is Electron running the web UI. The paychecks change put its Mac group after that app.
- Reconcile today: desktop `ReconcileMenu`, phone `AccountReconcileModal` (opened from the ••• menu in `AccountPage.tsx`); both pre-fill the cleared balance; the amount lives in component state; locking is client-side. sc-4793 gives a record (`account-statement-balance-save`, `-get`, `-consume`).
- The Figma notes name a "shared Transaction row (iPhone)" and "shared Register row (Mac)" from the Accounts page: those exist only as designs.

## D1. Entry point for B1 (the PO's open question)

The design opens the flow from the Accounts tab banner and the account ••• menu. Both screens are web today, so B1 keeps them in place and makes them ask for the native flow:

- **Account menu.** The web account page's ••• › "Reconcile…" already exists. `NativeScreen.reconcile` ships **on** (Ken: native screens are on once shipped; Settings turns it off, and unset reads as on, unlike the older switches). With it on, it sends the chrome message `presentReconcile {account_id}` instead of opening the modal; native presents the flow full-screen (large detent only, as the design says). With the switch off, or outside the native app, it opens the dialog as today.
- **Banner.** A small web component at the top of the phone Accounts page, rendered only inside the native app with the switch on, reads `native/reconcile-month` through the page's own loot-core and sends `presentReconcile {checklist: true}`. It shows while something is due, and collapses to "November reconciled ✓" for the rest of the month. When the native Accounts screen is built, a native banner replaces it and the flow itself is unchanged.

Why: an overlay on a scrolling web list is fragile, the paychecks precedent overlays whole screens and not parts of one, and these two entries need no native Accounts screen. Rejected: a Budget-tab banner (not where Ken's design puts it) and waiting for the native Accounts screen (blocks production reconcile). Not Ken's call: it follows his design placement and rules.

## D2. One resolver for the pre-fill (sc-4802)

`account-statement-balance-prefill {account_id}` in loot-core returns `{prefill, alternatives, cleared_balance, record, account_type}`. `prefill` is the first of: the bank-sync balance (`balance_current`) when the account has `account_sync_source` and the balance's own write time is within the max age (a setting, below). `last_sync` is not used: it is stamped on every sync while `balance_current` is written only when the bank returned one, so an old balance could look fresh. Bank sync writes a synced per-account preference `bank-balance-at-<id>` (ms) each time it writes `balance_current`; a balance with no such stamp (every account before this change, until its next sync) is offered with "balance date unknown", never pre-filled; a statement-derived slot (none exists, always empty); else null. Each source carries `{amount, source, as_of, link}`; `as_of` is that write date. `link` names Account Info › Bank sync. A stale bank balance is not the prefill and appears in `alternatives` ("Use bank balance from Nov 2"); choosing it saves source `bank-sync` with that stale `as_of`. The cleared balance is never the prefill and is always in `alternatives` as source `cleared`. Neither platform computes this; web and Swift only render it. Credit and loan sign is as the register shows it.

The freshness window is the **synced budget preference `reconcile-bank-balance-max-age-days`** (default 7 days, ceiling 30; a value that fails `^\d+$`, is zero or is above the ceiling is ignored and the default used; `Number()` is not used, since it accepts `1e1` and `0x7`). It is a preference, not a server setting, because the resolver runs in the budget's own engine on every device, and the person owns it. It follows them across devices. Web Settings (desktop and phone web, under Bank Sync) gets a small "Use the bank balance if synced within … days" field in group 1; the iPhone reads the same preference, and a native control for it is a later Backlog item (Settings on iPhone is web today).

## D3. The recorded confirmation

**This modifies the merged `account-statement-balance-save` (sc-4793).** It no longer takes `entered_by`: loot-core derives it from `subscribe-get-user` (display name, else user name, else `app`, at most 100 characters). It checks the label against the data: `bank-sync` only when the amount equals the resolver's bank balance (fresh or stale; the stale alternative saves `bank-sync` with its own `as_of`), `cleared` only when it equals the live cleared balance (children excluded), `statement` rejected until a producer exists, `entered` for any amount. `entered` is open on purpose: a person typing the statement balance often types a number equal to the cleared balance. So this stops a mislabelled source from defeating the MCP's cleared-source refusal; it does not stop a compromised page, which can type anything, and that risk is accepted. The requirement is added here, not modified, because the sc-4793 change is not archived.

Confirming calls `account-statement-balance-save` with the amount, the source (`bank-sync` while unedited, `entered` once the text differs, `cleared` for "Use cleared balance"), `as_of` and `entered_by`. Leaving without confirming saves nothing and locks nothing. A confirmed `cleared` record shows, at that moment, fixed text: the cleared balance is the app's own figure and not a statement, so an assistant cannot use it to reconcile; enter the statement's balance to let it. The note never blocks the person's own reconcile.

## D4. The source indicator (web, iPhone, Mac)

A line under the field with an information icon and words, never colour alone: "From {SimpleFIN} balance, synced {time}" (always visible); the note, tooltip or tap, adds "May include pending items. Compare with your statement." After an edit it reads "Entered by you" with "Restore bank balance". Desktop: hover and focus tooltip plus a "Bank Sync Settings…" link. Phone and iPhone: tap the icon for the note, tap again to hide. VoiceOver reads the source with the amount.

## D5. Handlers (the bridge's new surface)

- `native/reconcile-month`: one batched read: the open accounts not in the exclusion list with `{id, name, status, detail, last_reconciled}`, the exclusion list, and the month. `status` is `in-progress` (an unconsumed, unexpired record exists), `done` (`last_reconciled` in this month) or `due`; `ready` is reserved (D6).
- `native/reconcile-rows {account_id, scope}`: the account's rows (`to-tick`: uncleared up to today; `all`: every row of the period, reconciled flagged) and the summary `{statement, cleared, difference}`, where `statement` is the unconsumed record's amount and the cleared balance and difference come from the same loot-core query the MCP uses (cleared, split children left out). Swift does no arithmetic.
- `native/reconcile-tick {account_id, ids, cleared}`: toggles cleared on rows: every id must belong to `account_id` or the whole call fails; a split parent sets its children and a child alone is refused; reconciled rows are refused in loot-core, not only in the UI; one undo step, and returns the new summary. Ticks save as you go; nothing locks before step 4 (B2).
- `native/reconcile-list-set {excluded}`: writes only the synced preference `reconcile-excluded-accounts` (a JSON array of account ids). `preferences/save` can write this key too, so the read is defensive: a value that is not an array of strings, or is over 500 entries, reads as an empty list; `native/reconcile-list-set` validates and caps the same way and refuses otherwise. The list is stored as exclusions so a new account appears by default (Ken: all open accounts by default).
- `presentReconcile {account_id}`: native checks the id against the open accounts it read through `native/reconcile-month`, ignores anything else (a non-string, a path-like value, an unknown or closed id), and loads rows only through `native/reconcile-rows`.
- `account-statement-balance-prefill`, `-save` and `-get` are allowlisted for native use. Writes carry typed values; the bridge's existing token and undo rules apply.
- The page also forwards loot-core change events, and the views re-read on `transactions`, `accounts` and `preferences` events as the other native screens do.

## D6. "Ready to confirm" has no source yet

The design's Ready group quotes an assistant's hand-off. No MCP tool or record creates one: the Architect's Explore rejected a pending request, and sc-4800 made the record human-only. So B1 builds the group but nothing fills it, and the group does not show. A Backlog story ("assistant nudge: the agent leaves a note that an account is ready to reconcile", a `requested_at` and message on the record or a sibling key, written by an MCP tool, read-only for the nudge text) feeds it later; the nudge is never a balance.

## D7. Native screens (iPhone)

SwiftUI over `NativeBridgeCore` view models with fakes and fixtures, as the paychecks screens: `ReconcileMonthViewModel`, `ReconcileStepOneViewModel`, `ReconcileTickViewModel`. Loaded, error and timeout states keep the last values; re-reads are coalesced. A `NativeTransactionRow` is built here (the design's shared Transaction row exists only in Figma) and the Accounts story reuses it. Step 1 matches the frames: pre-filled, edited, and no-source states, the decimal pad, Return to confirm, ✕ saves nothing. Step 2: pinned summary, rows toggle on tap and leading swipe, press-and-hold opens the existing edit sheet, "To tick" and "All", light haptic, Difference announced. Dynamic Type to AX5 wraps and never truncates an amount; Dark Mode through the HE colour variables; `FinancialText`-equivalent for numbers; copy through the app's localization, no hard-coded English.

Until steps 3 and 4 exist (sc-4825), step 2 ends in an exit: at 0.00 "Ready to lock — finish in the register" opens the web reconcile on the account (the web path locks, as today); above zero, "Done for now" closes the flow and keeps the ticks.

## D8. Mac

There is no Mac app. Group 3 (sidebar "Reconcile" with a count badge, ⇧⌘R, the checklist, step 1 in the content area, step 2 as the register table with Space to tick, the keyboard flow of the frames) starts when the Mac app (sc-3629) exists and reuses the same handlers. Until then Mac users get group 1's pre-fill and record in Electron. This differs from "iPhone and Mac ship together" and follows the paychecks precedent; the PO confirms it.

## D9. Archiving next to the open native changes

`add-native-paychecks-screen` and `native-budget-month-range` are active and modify the handler-class requirement of `native-bridge`. This change adds one requirement with its own header and modifies nothing, so the archives are order-independent. Checked at propose time: no requirement header collides.

## Risks

- The banner is web inside a native app; if the page cannot reach native (no switch, or an old build) it opens the dialog, so no path is a dead end.
- A synced exclusion list means an account removed on one device disappears on all; Edit List re-adds it.
- The bank-sync balance can include pending items; the source line says so, and the check against cleared rows still decides the lock.

## Decisions for Ken

None. Ken's design and list decisions are recorded on sc-4793 and sc-4801; the Mac timing (D8) is for the PO.
