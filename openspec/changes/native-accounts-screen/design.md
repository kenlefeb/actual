# Design

Facts read on origin/development and in Figma (Accounts page, node 25-2: list, register, search, closed accounts, empty, loading and sync-error frames, light and dark, with the UX Designer's notes):

- The iPhone root is `NativeTabBarController`: tabs Budget, Accounts, Reports and Settings over one web view and one loot-core. Budget, Schedules & Paychecks and Reconcile are native overlays behind `NativeScreenSwitch`. **Accounts and account pages are web** (`components/mobile/accounts/`).
- Web numbers: balances are spreadsheet bindings (`bindings.ts`); the register is `useTransactions` in pages of 50 with `useTransactionsSearch`. Upcoming rows and running balances are worked out in desktop-client hooks (`useAccountPreviewTransactions`), so Swift cannot get them through `query`.
- Reusable: `NativeTransactionRow`, the Reconcile flow and `presentReconcile`, `native/reconcile-month`, `native/reconcile-tick` (cleared toggle) and `clearedBalanceOf` (`server/native/reconcile.ts`).
- Perf gates: `server/native/*.perf.test.ts`, run by `yarn workspace @actual-app/core run perf` in Fork CI ("Native perf gates"), one round trip under 50 ms on the loot-core side.

## D1. Two batched reads, not `query` from Swift

ADR 11 rule 3 allows paging through `query` or a keyset. Upcoming rows, names, split counts and running balances need loot-core logic, and a reduced row crosses less data than an AQL row, so both reads are named handlers in `server/native/accounts.ts`. This change adds no use of `query`.

- `native/accounts-list` returns the currency fields `native/budget-month` carries; `sections` on-budget and off-budget (open accounts in the web's sort order) and `closed`, each `{total, accounts}`; and `netWorth`. An account is `{id, name, balance, offbudget, closed, lastSync, lastTransactionDate, bankSync, clearingFor}`. `clearingFor` is the paycheck name when the account is a paycheck clearing account (paychecks spec). Totals use the same sums as the web bindings. Swift adds nothing up.
- `native/account-register {account_id, scope, search, cursor, limit}` returns `{rows, nextCursor}`. When `cursor` is null it also returns `header {balance, cleared, uncleared}` and `upcoming`.
  - `scope`: `all`, `uncleared` or `uncategorized`.
  - Rows are split parents and plain rows: `{id, date, payee, category, splitCount, notes, amount, cleared, reconciled, transferAccount, transferReconciled, runningBalance}`, with names resolved. Search runs over payee, category, notes and amount, as `useTransactionsSearch` does, and a matching child returns its parent.
  - `upcoming` holds the account's scheduled rows inside the synced upcoming window, from the schedule helpers `native/schedules-paychecks` already uses.

## D2. Keyset paging and configurable limits

The cursor is opaque to Swift and encodes the last row's (date, starting_balance_flag, sort_order, id), the web view's order. A sync that inserts rows mid-scroll then neither repeats nor skips a page.

- The page size is the synced preference `accounts-register-page-size`: default 50, ceiling 200, read with `readLimit` from `server/native/reconcile-lock.ts` (a value that is not a whole number from 1 to the ceiling uses the default). Swift sends no size. The ceiling is a code constant beside the default, as for the reconcile limits.
- The search debounce (250 ms) is a named constant in `NativeBridgeCore`.
- Inputs are checked in loot-core (Security, PR #408):
  - `search` is text of at most 100 characters, as in `native/reconcile-rows`.
  - `%`, `_` and `\` are escaped before a LIKE match.
  - The cursor is decoded strictly: base64 of JSON with exactly `date` (integer), `starting_balance_flag` (number), `sort_order` (number) and `id` (string). Anything else fails the call.
  - Every value is a bound parameter; no input is spliced into SQL.
- `runningBalance` is filled only for scope `all` with no search and the account's `show-balances-<id>` preference on. Elsewhere it is null, as the web hides it when filtering. For each page loot-core computes it from one sum over the rows older than the page.

## D3. Four writes, each a native write

`native/undo` reverses only a write carrying a native token, so the existing `account-reopen` and `account-move` are wrapped rather than allowlisted raw. Every write takes `undoToken`, is one undo step and is all-or-nothing:

- `native/transactions-categorize {account_id, ids, category, confirmedReconciled}`: every id must be a live row of `account_id`, an open account.
  - A split parent or a child is refused (splits change in the editor).
  - Rows of an off-budget account are refused, and so is a transfer between two on-budget accounts; the web gives neither a category.
  - `category` must be an existing, non-hidden category, or null.
  - A reconciled row is refused unless `confirmedReconciled === true` (the design asks first).
- `native/transactions-delete {account_id, ids, confirmedReconciled}`: the same ownership, open-account and reconciled rules. A parent takes its children with it.
  - A transfer's delete also removes its partner row in the other account, as loot-core's transfer handling does.
  - The register row carries `transferAccount` and `transferReconciled`, so the confirmation names the partner account before anything is sent.
  - A reconciled partner needs the same `confirmedReconciled === true`.
- `ids` is capped by the synced preference `accounts-write-max-ids` (default 100, ceiling 500, `readLimit`). Children and transfer partners count toward the cap, and a call over it fails whole.
- `native/account-reopen {id}`: the id must be a closed account.
- `native/account-move {id, targetId}`: both must be open accounts in the same section, or `targetId` is null (end of that section).

Cleared and uncleared reuse `native/reconcile-tick`, which already refuses reconciled rows. The category picker reads the groups from `native/budget-month` for the current month, so there is no new read.

`confirmedReconciled` is a flag the page passes, so injected same-origin script could set it without a tap. That is the same class of risk as sc-4877 (a Swift-minted one-shot nonce for reconcile adjust and lock). It is accepted until production hardening, as the Director accepted sc-4877's, and sc-4877 is to be extended so these writes need the nonce for a reconciled row (task 2.8).

## D3a. Native Undo checks for later changes

`native/undo` is last-write-wins today: it would put back the old values over an edit that synced in after the native write. For the accounts writes, the write records, in its undo metadata, the state it left for each row or account it touched: category, tombstone and sort order. `native/undo` then refuses, changing nothing, when any of them now differs, and the screen says "Changed since — can't undo." Rejected: undoing anyway. That silently loses another device's edit, and the check costs one read of the touched rows.

## D4. The switch ships on

`NativeTab.accounts` joins `nativeTabs`. `NativeScreen.accounts` reads **on** when unset (Ken, 2026-11-15, as reconcile does), and web Settings › Native screens stores false to turn it off. The `NativeScreensScript` entry tells the page. With it off, the Accounts tab is the web screens exactly as today. Default stays off until story 3611 ships the screens (Director, 2026-11-17); the flip to on is task 3.8.

## D5. The overlay

The native Accounts screen lies over the Accounts container while the page shows `/accounts` or `/accounts/<id>` for a known account with the tab bar, as the Budget overlay does. The register is pushed inside a native NavigationStack, so a page route to `/accounts/<id>` (a budget drill-down) opens the native register. Other paths stay web: `/accounts/all` until sc-4387, and `/transactions/<id>`, where tapping a row opens the web editor until sc-3602. Back from the web editor returns to the native register at its scroll position, as the Budget overlay keeps its month.

The web screen shows until loot-core has answered the first list read. If that read fails while the switch is on, the native screen shows its error with Retry rather than falling back to the web screen (PR 424 review, 2026-11-17): the person chose the native screen, and Retry recovers without leaving it. An `/accounts/<id>` the list does not hold still stays web.

## D6. View models

`AccountsListViewModel` and `AccountRegisterViewModel` follow the Budget and Paychecks view models: tested against a fake transport and the contract fixtures.

- The first load is redacted on the real layout (no spinner).
- A re-read keeps the old numbers, and errors and timeouts keep the last values.
- Change events (`transactions`, `accounts`, `preferences`, `payees`, `categories`) coalesce into one re-read of the visible view: the list, or the loaded pages from the top.
- No call is made while the app is in the background; on returning to the foreground the visible view re-reads.
- Pulling down runs `sync` and re-reads, under the Budget tab's rules: one pending pull, no bank sync. Bank sync on pull is sc-3899.

## D7. Screens (iPhone)

- **List:** large title "Accounts", with sync status as the subtitle ("Synced just now", "Offline — changes saved on this iPhone", "Sync failed — tap to retry" in warning text).
  - Rows: an "All accounts" row (web until sc-4387), On budget and Off budget sections with their totals, and a "Closed accounts" row with its count.
  - Each account row shows its name, a detail line (`clearingFor` note, else "Synced …" from `lastSync`, else "Updated …" from `lastTransactionDate`) and the signed balance; negatives in the negative colour.
  - Long-press offers Reconcile.
  - Reorder is through Edit mode with drag handles.
  - A Net worth footer shows `netWorth`.
  - The + menu offers Add account and Link bank account. Both hand off to the web's existing flows until sc-4949 makes them native (D7a).
- **Closed accounts:** names in secondary text. A trailing swipe and the context menu offer Reopen in teal (undoable). Tap opens a read-only register.
- **Register:** inline title (the account name) with the system back button.
  - Header: working balance, then cleared and uncleared. The paycheck clearing note shows when it applies.
  - Search uses the system search field; Cancel restores the register.
  - Scope chips: All, Uncleared, Uncategorized.
  - Upcoming (grey, "Scheduled"), then date sections, newest first.
  - Rows are `NativeTransactionRow`: payee, category (Uncategorized in warning text, "Split (n)"), the signed amount with incoming in green and +, and a status word (Pending, Cleared, Scheduled, Reconciled).
  - Leading swipe: Clear or Unclear, with a haptic. Trailing swipe: Delete, which asks first for a reconciled row. Long-press: Categorize, which opens the category picker.
  - While searching, the header hides and a footer shows the results' total. No results reads "No transactions match “…”." in secondary text.
- **Register ••• menu:** Reconcile (native); Account settings and Sync now hand off to the web until sc-4385 (D7a).
- **States:** no accounts ("Add your first account" with the explanation, and Add account and Link bank account buttons that hand off as the + menu does); loading redacted with no shimmer under Reduce Motion; sync errors in words, never colour alone.
- **Accessibility:** Dynamic Type to AX5 wraps names and moves the amount under the name, never truncating it. VoiceOver reads rows whole and offers the swipes as custom actions. Colours come from the HE variables; numbers use tabular digits; all text is localized.

## D7a. Web hand-offs while the screen is on by default

The screen ships on, so nothing the web Accounts screens offer may be lost. Native sends the chrome message `webAccountAction {action, account_id?}`, where `action` is one of `add-account`, `link-account`, `account-settings` or `bank-sync`. The page then opens the existing mobile web flow: the add-account and link-account dialogs, the account menu, or the account's bank sync. The overlay steps aside while that flow is open and re-reads when it closes.

The chrome checks the message: only from the app's own page side, `action` from the closed set, and `account_id` required for the last two and a known open account. Anything else is ignored. These are stepping stones: sc-4949 makes add and link native, and sc-4385 makes settings native.

The Figma "to review" count and per-account "Bank sync failed · Reconnect" have no source the native app can read today: the web keeps bank-sync failures in client state after a bank sync, and no "review" concept exists. They are left out until sc-3899 and sc-4619 give them one. That is not an invented rule; there is simply no data.

## D8. Reconcile enters from the native screens

The list shows a native banner fed by `native/reconcile-month` ("2 accounts to reconcile", collapsing to "November reconciled ✓"). Tapping it presents the checklist. The register's ••• › Reconcile and the list row's long-press present the flow for that account. The web `NativeReconcileBanner` renders only while the Accounts switch is off, completing native-reconcile-flow D1's hand-over. The Figma "Reconciling register" frame, a banner inside the register, is superseded by the Reconcile flow design (node 49-2) that shipped; the register shows no reconciling banner.

## D9. Mac

There is no Mac app. The Mac Accounts window, sidebar, register table and inspector (Figma frames 28:313 and 41:*) start once the Mac app (sc-3629) exists, on the same handlers. Until then Mac users have the web screens in Electron. This follows the paychecks and reconcile precedent.

## D10. Archiving next to the open native changes

`add-native-paychecks-screen` and `native-budget-month-range` modify `native-bridge`'s handler-class requirement. This change only adds requirements, with headers checked unique at propose time, so the archives are order-independent.

## Risks

- A long register with running balances costs one extra sum per page; the perf gate covers a page 10,000 rows deep.
- The editor stays web until sc-3602, so a tap leaves the native screen; back returns to it.
- Unset reads as on, so every iPhone user gets the native screen on update; Settings turns it off, and the web hand-offs (D7a) keep every web action reachable.
- Accepted: page script can pass `confirmedReconciled` (D3); sc-4877's nonce will close it.

## Decisions for Ken

None. Ken's rules (native first, on by default, Mac after sc-3629, limits configurable) decide the open points.
