# Proposal

## Why

Shortcut sc-3850. The native Budget tab (`add-native-budget-screen`, sc-3760) cannot learn the budget's first or last month up front, because nothing handler-free lists them (`get-budget-bounds` creates budgets, `createdMonths` is not queryable, and deriving the range in Swift would copy loot-core's `getBudgetRange`). It finds the edge by trying to step past it: at the first or last month, Previous or Next stays enabled until one tap is refused, and only then is the button disabled and the month dropped from the picker. That wastes a tap at each edge.

The same workaround has a second flaw. A month the screen learned is missing stays hidden until the screen is recreated, so a month the web app adds later (for example by budgeting ahead) is not offered until the app is relaunched. This change folds that former bug in; no separate story is needed.

## What Changes

- **Delta to `native-bridge`.** `native/budget-month` also returns `firstMonth` and `lastMonth`, the earliest and latest month the budget has, as `YYYY-MM` strings. They are additive and read-only, computed from the months loot-core already holds, so reading them creates no budget. The existing handler already refuses any month outside that set, so the range and the "no budget for month" answer cannot disagree.
- **Delta to `native-budget-screen`.** The Budget tab reads the range with every month load. Previous and Next are disabled at the edge and the month picker is built from the range, from first load and with no tap needed. The "learned missing" memory from sc-3760 is dropped, so a month the web adds later is offered after the screen's next read, without a relaunch.
- **Scenario edit in `add-native-budget-screen`.** Its "Month outside the range" scenario drops the learned-edge paragraph and states the up-front behaviour. That spec lives in the still-open change, so it is edited there (see "Capabilities").
- **No new handler and no Swift copy of `getBudgetRange`.** The range comes from the existing handler's result.

Out of scope: any new way to create budget months; a picker control other than the existing menu; a range for any other native screen; desktop and mobile web (unchanged).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `native-bridge`: the `native/budget-month` result gains `firstMonth` and `lastMonth`. (The base requirements are in the still-open changes `native-bridge` and `add-native-budget-screen`; this delta is written against them and applies once they are archived.)
- `native-budget-screen`: month navigation follows the range from the first load. The base requirement and its "Month outside the range" scenario are in `add-native-budget-screen`; that scenario is edited in place there, and this change's delta adds the new requirements beside it.

## Mobile scope

This change is iOS-native only, by nature: it changes the native Budget tab in `packages/mobile-client/ios/` (`NativeBudgetViewController.swift`, `BudgetViewModel.swift`, `BudgetMonth.swift`) and one additive field pair in loot-core's `native/budget-month`. Desktop web and mobile web have their own month navigation and are unchanged. ADR 11 sets native screens as Apple-only with no upstream parity (Ken, 2026-11-11), the recorded exception to the desktop-and-mobile rule.

## Decisions for Ken

None. The decisions are the Architect's, for Product Owner review, in `design.md`.
