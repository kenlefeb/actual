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
  - Rows are split parents and plain rows: `{id, date, payee, category, splitCount, notes, amount, cleared, reconciled, transfer, runningBalance}`, with names resolved. Search runs over payee, category, notes and amount, as `useTransactionsSearch` does, and a matching child returns its parent.
  - `upcoming` holds the account's scheduled rows inside the synced upcoming window, from the schedule helpers `native/schedules-paychecks` already uses.

## D2. Keyset paging and configurable limits

The cursor is opaque to Swift and encodes the last row's (date, sort_order, id). A sync that inserts rows mid-scroll then neither repeats nor skips a page.

- `limit` defaults to 50 with a ceiling of 200; a value that is not an integer from 1 to 200 uses the default.
- The search debounce (default 250 ms) and the page size are constants in one place in `NativeBridgeCore`, not literals.
- `runningBalance` is filled only for scope `all` with no search and the account's `show-balances-<id>` preference on. Elsewhere it is null, as the web hides it when filtering. For each page loot-core computes it from one sum over the rows older than the page.

## D3. Four writes, each a native write

`native/undo` reverses only a write carrying a native token, so the existing `account-reopen` and `account-move` are wrapped rather than allowlisted raw. Every write takes `undoToken`, is one undo step and is all-or-nothing:

- `native/transactions-categorize {account_id, ids, category, confirmedReconciled}`: every id must be a live row of `account_id`. A split parent or a child is refused (splits change in the editor). `category` must be an existing, non-hidden expense or income category, or null. A reconciled row is refused unless `confirmedReconciled` is true (the design asks first).
- `native/transactions-delete {account_id, ids, confirmedReconciled}`: the same ownership and reconciled rules. A parent takes its children with it.
- `native/account-reopen {id}`: the id must be a closed account.
- `native/account-move {id, targetId}`: both must be open accounts in the same section, or `targetId` is null (end of that section).

Cleared and uncleared reuse `native/reconcile-tick`, which already refuses reconciled rows. The category picker reads the groups from `native/budget-month` for the current month, so there is no new read.

## D4. The switch ships on

`NativeTab.accounts` joins `nativeTabs`. `NativeScreen.accounts` reads **on** when unset (Ken, 2026-11-15, as reconcile does), and web Settings › Native screens stores false to turn it off. The `NativeScreensScript` entry tells the page. With it off, the Accounts tab is the web screens exactly as today.

## D5. The overlay

The native Accounts screen lies over the Accounts container while the page shows `/accounts` or `/accounts/<id>` for a known account with the tab bar, as the Budget overlay does. The register is pushed inside a native NavigationStack, so a page route to `/accounts/<id>` (a budget drill-down) opens the native register. Other paths stay web: `/accounts/all` until sc-4387, and `/transactions/<id>`, where tapping a row opens the web editor until sc-3602. Back from the web editor returns to the native register at its scroll position, as the Budget overlay keeps its month.

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
  - The + menu is out of scope (add account has no native story yet; filed as a follow-up).
- **Closed accounts:** names in secondary text. A trailing swipe and the context menu offer Reopen in teal (undoable). Tap opens a read-only register.
- **Register:** inline title (the account name) with the system back button.
  - Header: working balance, then cleared and uncleared. The paycheck clearing note shows when it applies.
  - Search uses the system search field; Cancel restores the register.
  - Scope chips: All, Uncleared, Uncategorized.
  - Upcoming (grey, "Scheduled"), then date sections, newest first.
  - Rows are `NativeTransactionRow`: payee, category (Uncategorized in warning text, "Split (n)"), the signed amount with incoming in green and +, and a status word (Pending, Cleared, Scheduled, Reconciled).
  - Leading swipe: Clear or Unclear, with a haptic. Trailing swipe: Delete, which asks first for a reconciled row. Long-press: Categorize, which opens the category picker.
  - While searching, the header hides and a footer shows the results' total. No results reads "No transactions match “…”." in secondary text.
- **States:** no accounts ("Add your first account" with the explanation); loading redacted with no shimmer under Reduce Motion; sync errors in words, never colour alone.
- **Accessibility:** Dynamic Type to AX5 wraps names and moves the amount under the name, never truncating it. VoiceOver reads rows whole and offers the swipes as custom actions. Colours come from the HE variables; numbers use tabular digits; all text is localized.

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
- Unset reads as on, so every iPhone user gets the native screen on update; Settings turns it off.

## Decisions for Ken

None. Ken's rules (native first, on by default, Mac after sc-3629, limits configurable) decide the open points.
