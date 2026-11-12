# Design

## Context

See `proposal.md`. Facts about the code, measured on `development` on 2026-11-12:

- The iPhone root is `NativeTabBarController`. Each tab hosts the web view or a native screen: `nativeScreen(for:)` returns the native one (today only a `NativeTabStub` debug stub), and `NativeTabRouter` (in `NativeBridgeCore`) tracks the tab and path.
- `NativeBridgeClient.call(name, args:)` refuses names off `NativeBridgeAllowlist.handlers` (Swift is the security boundary), applies the 5 s timeout, and today takes `args: [String: String]`. The page copy of the allowlist is `packages/desktop-client/src/data/native-bridge-allowlist.json`; a test compares the two. `nativeBridge.ts` forwards `args` to loot-core's `send()` as-is and forwards `cells-changed` and `sync-event`.
- `native/budget-month` (`packages/loot-core/src/server/native/app.ts`) returns the snapshot: `budgetType`, totals (envelope: `toBudget`, `available`, `forNextMonth`, `fromLastMonth`, `lastMonthOverspent`; tracking: `budgetedIncome`, `saved`), and groups with categories (`budgeted`, `spent`, `balance`, `carryover`, `hidden`). It does not say which months exist.
- Write handlers in `packages/loot-core/src/server/budget/app.ts`, all `mutator(undoable(...))`:
  - `budget/budget-amount` (`setBudget`) picks `reflect_budgets` for a tracking budget and `zero_budgets` for an envelope one by itself, so one handler serves both modes. There is no separate "tracking handler".
  - `budget/transfer-category` (`transferCategory({month, amount, from, to, currencyCode})`) moves category to category, or category to `'to-budget'`.
  - `budget/transfer-available` (`transferAvailable({month, amount, category})`) moves to-budget into a category, capped at the to-budget leftover.
  - The web mobile screen calls these same three (`ExpenseCategoryListItem.tsx`, `BudgetPage.tsx`).

## Goals / Non-Goals

**Goals**

- The native screen shows exactly the numbers the web screen shows, because both read cells loot-core computed.
- Each slice ships alone, is demoable, and can be switched off.

**Non-Goals**

- No Swift-side arithmetic beyond formatting and unit conversion for display and input.
- No new loot-core read or write handler (Decision 3).

## Decisions

### 1. The per-screen switch is a native preference the tab root reads

A `UserDefaults` key `NativeScreen.budget`, default off (`NativeScreenSwitch.screen(for:)` in `NativeBridgeCore`). The native screen is an **overlay** on the Budget tab's container, not a replacement for the web view: there is one web view and one loot-core, and sign-in, the budget list and the engine all run in that web view, so it must stay in the window. The overlay (`NativeBudgetViewController`, laid over the web view by `NativeTabBarController.updateBudgetOverlay`) shows only while the switch is on, the page shows `/budget` with the tab bar visible, and the budget is an envelope one; it is removed when any of these stops being true, and for a tracking budget until sc-3778 (the view model reports `useWebScreen`). The app tells the page the switch's value through a user script rebuilt on every toggle, so a page reload never brings back the value from launch. Ken flips it in the web Settings screen, shown only inside the iOS app, through the existing native chrome plugin. Turning it off takes effect when the tab is next shown. Alternative: an iOS Settings.app bundle, which is harder to reach and has no live effect. Alternative: a server-side flag, which wrongly syncs a per-device choice across devices.

### 2. Plain Swift view models, one read per month

A `BudgetViewModel` (in `NativeBridgeCore`, platform-free, tested against a fake transport and the contract fixtures) holds the visible month, loading and error state, and the decoded `BudgetMonth`. The SwiftUI views render it and hold no computed totals. Every edit ends with a re-read of the month, never a local patch, so a number on screen is always one loot-core computed. The layout follows `budgetType` from the snapshot, not a preference read.

### 3. Reuse existing write handlers

The allowlist adds `budget/budget-amount`, `budget/transfer-category` and `budget/transfer-available`. Move money maps to them: category to category and category to to-budget use `transfer-category`; to-budget to category uses `transfer-available`. Alternative: a fork-only batched `native/budget-edit`, which means more code, a second place for budget rules, and one more thing to keep equal to the web. Rejected.

### 4. Typed bridge arguments

`NativeBridgeClient.call` takes `args: [String: String]`, which cannot send an amount (a number) to `budget/budget-amount`. The first write slice (sc-3769) changes the argument type to a small `Encodable` JSON value, keeping every existing call working, with the same allowlist and timeout checks. Amounts cross the bridge as integer minor units, exactly as `native/budget-month` returns them; conversion from what the user types happens only at the edit field. The currency comes from `native/budget-month`: the snapshot gains the currency code and decimal places (an additive field, in the `native-bridge` delta), which the handler reads from the `defaultCurrencyCode` preference and the currency table. `transfer-category` needs a `currencyCode` (it only writes the movement note); the screen passes the snapshot's code, not a Swift constant. The web gets its currency from a client hook, which native code cannot call.

**Write validation.** loot-core's handlers trust their arguments: `setBudget` turns a non-number amount into 0 and writes a row for any month or category string, and `transferCategory` does not clamp. So the bridge validates writes itself, at the boundary, on both sides. The page side validates before `send` (the amount is a finite integer, the month is `YYYY-MM` and has a snapshot, the category id is a category of that snapshot, plus the transfer rules), by reading the month's snapshot, which needs no new handler. Swift builds each write from a typed per-handler struct (`BudgetAmountWrite`, `Transfer`), not a generic `Encodable`, and validates it too. Neither side trusts the other.

### 5. Month range

The snapshot does not list months. Navigation limits come from the same loot-core budget bounds the web screen uses. Slice sc-3760 first checks whether a cell or `query` gives them and, if not, treats the "no budget for month" error from `native/budget-month` as the edge. See Open Questions.

### 6. Re-reads

The screen subscribes to `cells-changed` and `sync-event` through the existing `ChangeCoalescer` (at most one re-read per frame). It does not read while the scene is not active, and re-reads the visible month when the scene becomes active. Every call keeps the 5 s timeout; a timeout shows a retry state and keeps the last good numbers, dimmed.

### 7. Testing

Swift unit tests against a fake transport and the shared fixtures, per ADR 11. The two slices that need a device (sc-3805, sc-3823) record their evidence on the story; sc-3805 needs Ken's iPhone and a TestFlight build, which the Director arranges. `swift test` and the `check-native-swift` fork check run in Fork CI as today. No web VRT: the web screens do not change.

## Risks / Trade-offs

- [Native screen drifts from the web screen's numbers] → every number is a loot-core cell, and each slice's scenario compares native to web for the same budget.
- [A write while the engine is suspended hangs] → the 5 s timeout, no calls in the background, and an error that keeps the old value.
- [A native write lands but the re-read times out] → the screen shows the error and re-reads on the next change event or foreground; the write is never retried automatically, so an edit cannot apply twice.
- [Unusual budget state: carryover, hidden categories, income group] → the snapshot already carries them; slices render what it says, and the web screen is the oracle in their comparison scenarios.
- [`native-bridge` is still an open change] → the delta is written against it and archives after it. Its base requirement says the allowlist holds only reads until a screen story adds writes; the next native screen that adds a write handler modifies this delta's requirement (MODIFIED) once both are archived.
- [loot-core handlers accept bad arguments] → validated in the bridge on both sides (Decision 4); no loot-core change, so the upstream-merge risk stays low.

## Migration Plan

No data migration. Ship behind the default-off switch; Ken turns it on in Settings. Rollback is turning it off.

## Open Questions

- Month range source (Decision 5): handler-free if a cell or `query` can give it. If sc-3760 finds it cannot, it files a Backlog story for a small additive field on `native/budget-month` before going on; that is a spec change to `native-bridge`.
- Whether the Move money sheet should offer "cover overbudgeted" beyond a plain move. Out of scope here; revisit after sc-3787.
