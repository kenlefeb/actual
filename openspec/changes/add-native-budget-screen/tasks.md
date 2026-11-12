# Tasks

Test-first: write the tests, run them and see them fail before writing the code. One story, one PR. After sc-3751, groups 2, 3 and 6 can run in parallel; order is in the blocked-by relations on the stories.

## 1. Read-only envelope tab, per-screen switch and web fallback (sc-3751)

- [ ] 1.1 Add failing Swift tests in `NativeBridgeCore` for a `BudgetViewModel` that loads the current month through a fake transport fed by the contract fixtures: loaded, loading, error and timeout states, and no total computed in Swift. Verify: the tests fail before the view model exists.
- [ ] 1.2 Add failing tests for the switch: `nativeScreen(for: .budget)` is the web view while `NativeScreen.budget` is off or unset, and the native screen while on. Verify: they fail first.
- [ ] 1.3 Implement the view model and the SwiftUI Budget tab (groups, categories, budgeted, spent, balance, to-budget, error state with retry) in `packages/mobile-client/ios/`, hosted by the native tab bar. Verify: 1.1 passes and the tab runs in the Simulator on a seeded budget.
- [ ] 1.3a Add failing tests that, with the switch on and a tracking budget open, the tab shows the web Budget screen until the tracking group (sc-3778) lands. Then implement the fallback. Verify: the tests pass.
- [ ] 1.4 Add the switch to Settings in the iOS app through the native chrome plugin, default off. Verify: toggling it in the Simulator swaps the tab between native and web.
- [ ] 1.5 Compare the native month with the web Budget screen for the same seeded budget and month. Verify: the numbers are equal; record the check on the story.

## 2. Month navigation (sc-3760)

- [ ] 2.1 Add failing tests for previous, next and picker on the view model: one `native/budget-month` read per month, no month outside the range, and the visible month kept across leaving the tab. Verify: they fail first.
- [ ] 2.2 Find the budget's month range without a new handler (a cell or `query`); if that is impossible, file a Backlog story for an additive field and stop. Verify: the choice is written in the PR.
- [ ] 2.3 Implement the navigation controls and the picker in the tab. Verify: 2.1 passes; stepping back three months in the Simulator matches the web screen.

## 3. Edit a budgeted amount through loot-core (sc-3769)

- [ ] 3.0 Add a failing vitest contract test that `native/budget-month` returns the currency code and decimal places, on a seeded budget with a currency and one without, and regenerate the fixtures; add the fields to the handler and the Swift `BudgetMonth`. Verify: the vitest test and the Swift decode test pass.
- [ ] 3.0a Add failing vitest tests in `packages/desktop-client/src/native/` that the page bridge refuses, with an error result and no `send` of the write: a non-integer, non-finite, missing or non-number amount; a month not `YYYY-MM` or with no budget; an unknown category id and a group id. Then implement the validation before `send`. Verify: the tests pass and a valid write is still forwarded.
- [ ] 3.0b Add failing Swift tests for typed per-handler write values (`BudgetAmountWrite`): an invalid amount, month or id is refused before the transport is called. Then implement them. Verify: `swift test` passes.
- [ ] 3.0c Add a failing origin-guard test (extending `PageOriginGuardTests`) that a write message from another frame, host, scheme or port is ignored for `budget/budget-amount`, `budget/transfer-category` and `budget/transfer-available`. Verify: it passes after the allowlist change.
- [ ] 3.1 Add `budget/budget-amount` to the Swift allowlist and `native-bridge-allowlist.json`, with failing tests first: both lists equal, the call is forwarded, and `budget/set-zero` is still refused. Verify: the tests pass after.
- [ ] 3.2 Add failing tests for typed bridge arguments: a number arrives at the page as a number, and every existing string-argument call still works. Then change `NativeBridgeClient.call` to an `Encodable` JSON argument type. Verify: `swift test` passes.
- [ ] 3.3 Add failing view-model tests for save: the call, the re-read after it, a failed or timed-out save that keeps the old value, and the minor-unit conversion at the edit field using the snapshot's currency decimal places, and that an id or month not in the snapshot is never sent. Then implement the edit field, the save and the haptic. Verify: the tests pass.
- [ ] 3.4 Run `check-native-swift` and compare native against web after an edit on a seeded budget. Verify: the check is green and the web screen shows the edit.

## 4. Tracking budget mode (sc-3778)

- [ ] 4.1 Add failing view-model tests on a tracking fixture: the tracking layout with no to-budget, the tracking totals, and a mode switch between two reads. Verify: they fail first.
- [ ] 4.2 Implement the tracking layout, taking the layout from `budgetType`, and edit through `budget/budget-amount`. Verify: 4.1 passes.
- [ ] 4.3 Compare a seeded tracking budget with the web screen, and edit an amount. Verify: the numbers are equal and the web screen shows the edit; record it on the story.

## 5. Move money (sc-3787)

- [ ] 5.1 Add `budget/transfer-category` and `budget/transfer-available` to both allowlists, with failing tests first, and the refused-name test kept (`budget/cover-overspending` is refused). Verify: the tests pass after.
- [ ] 5.1a Add failing vitest tests that the page bridge refuses `budget/transfer-category` with source equal to destination, an amount of 0 or less, an income category, or (envelope) an amount above the source's balance or the month's to-budget, and `budget/transfer-available` with an amount of 0 or less, each with an error result and no write; a case that the literal `to-budget` is accepted as source or destination of `budget/transfer-category` and refused anywhere else; and the same rules as failing Swift tests for the typed `Transfer` values, so both sides enforce them. Then implement both. Verify: the tests pass.
- [ ] 5.2 Add failing view-model tests for the move: category to category and category to to-budget call `budget/transfer-category` with the snapshot's currency code; to-budget to category calls `budget/transfer-available`; each re-reads; a failure keeps the old numbers; a tracking month offers no sheet. Verify: they fail first.
- [ ] 5.2a Add a failing view-model test that the sheet prefills the source's balance, shows "You can move up to <amount>" and cannot confirm a larger amount. Verify: it fails first.
- [ ] 5.3 Implement the Move money sheet with the haptic. Verify: 5.2 passes and moving 10 dollars from to-budget to a category works in the Simulator.
- [ ] 5.4 Compare native against web after a move. Verify: both categories (or to-budget) match the web screen.

## 6. Change events, foreground and background (sc-3796)

- [ ] 6.1 Add failing tests for the view model's event handling with the `ChangeCoalescer`: a change event refreshes the month, a burst in one frame re-reads at most once, no read while the scene is inactive, and one re-read on becoming active. Verify: they fail first.
- [ ] 6.2 Add failing tests that every call on the screen uses the client timeout and handles the timeout error. Verify: they fail first.
- [ ] 6.3 Implement the subscription to `cells-changed` and `sync-event` and the scene-phase handling. Verify: 6.1 and 6.2 pass.
- [ ] 6.4 In the Simulator, edit in the web Budget, then background and foreground the app. Verify: the native tab refreshes, and makes no read in the background.

## 7. Real sync-event on a device against staging (sc-3805)

- [ ] 7.1 Write the repeatable device test as steps (second client, change, expected refresh, timings) and Ken's self-contained checklist, which the Director arranges. Verify: a reviewer who has not seen the code can follow it.
- [ ] 7.2 Run it on Ken's iPhone from a TestFlight build against staging. Verify: the evidence (steps, observed refresh, timings) is on the story.
- [ ] 7.3 If `sync-event` forwarding is defective, add a failing test and fix it here when small, or file a `bug` story. Verify: the test passes, or the story id is on sc-3805.

## 8. Dynamic Type, Dark Mode and VoiceOver (sc-3814)

- [ ] 8.1 Add failing UI or snapshot checks where the project can: the largest accessibility size with a large amount, dark appearance, and VoiceOver labels on a category row and in the Move money sheet. Verify: they fail on any control that truncates or lacks a label.
- [ ] 8.2 Fix every control: tabular digits and no truncation, `native-appearance` semantic colours, and VoiceOver label, value, trait and focus order for groups, categories, the edit field and the Move money sheet. Verify: 8.1 passes.
- [ ] 8.3 Audit with VoiceOver and the Accessibility Inspector in the Simulator. Verify: the notes are on the story.

## 9. 300-category performance check (sc-3823)

- [ ] 9.1 Add a measurement test or script for the screen's load and scroll on the 300-category fixture. Verify: it runs and prints the median and p95 before any fix.
- [ ] 9.2 Measure in the Simulator, then on Ken's iPhone with the hidden benchmark where it applies. Verify: the median and p95 are on the story and compared with 50 ms.
- [ ] 9.3 Fix regressions (lazy lists, diffing, no per-category reads) until it meets the target; if it cannot, stop and report to the Director so ADR 11 is revisited. Verify: the numbers after the fix are on the story.
