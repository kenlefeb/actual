# Tasks

Test-first: write the tests, run them and see them fail before writing the code. One story, one PR. iOS native only; desktop and web are unchanged (see the proposal's Mobile scope). Needs the native Budget screen (sc-3796) and its move-money slice (sc-3787, merged).

## 1. loot-core: report the range (sc-3850)

- [ ] 1.1 Add failing vitest tests in `packages/loot-core/src/server/native/app.test.ts`: `firstMonth` and `lastMonth` on a multi-month budget, the same from every month, on envelope, tracking and JPY budgets; the set of created months is unchanged after repeated reads; a month added later moves `lastMonth` on the next read; an out-of-range month still throws "no budget for month". Verify: they fail first.
- [ ] 1.2 Add `firstMonth` and `lastMonth` to `NativeBudgetMonth` and `budgetMonth` in `packages/loot-core/src/server/native/app.ts`, from the minimum and maximum of `sheet.get().meta().createdMonths`, and regenerate the three fixtures with `vitest -u`. Verify: 1.1 passes and the diff of the fixtures is only the two fields.
- [ ] 1.3 Run `yarn check:mcp-coverage` and the 50 ms perf test (`app.perf.test.ts`). Verify: both pass with no `coverage.json` change.

## 2. Swift: decode the range and drive the controls from it (sc-3850)

- [ ] 2.1 Add failing Swift tests in `NativeBridgeCore`: `BudgetMonth` decodes the updated fixtures with the range and still decodes a result without it; the view model, loaded on the first month, has `canGoPrevious` false and a picker with no earlier month after one read; likewise at the last month; the picker equals the range; a later `lastMonth` is offered after the next read with no relaunch; a failed read keeps the last range; an absent range gives the window and enabled controls; a refused step is not remembered. Verify: they fail first.
- [ ] 2.2 Add optional `firstMonth` and `lastMonth` to `BudgetMonth.swift`; in `BudgetViewModel.swift` keep the range of the last successful read, derive `canGoPrevious`, `canGoNext` and `pickerMonths` from it with the window as the fallback, and delete `missingBefore`, `missingAfter` and the memory in `isReachable`. Verify: 2.1 passes.

## 3. SwiftUI Budget tab (sc-3850)

- [ ] 3.1 Confirm `NativeBudgetViewController.swift` needs no change (it binds the three view model properties), or make the smallest change if a check shows otherwise. Verify: Simulator on a budget with a first and a last month: Previous is dimmed on the first month and Next on the last from first load, and the picker spans the range, in light and dark and at the largest Dynamic Type size.
- [ ] 3.2 Device check: on the TestFlight build, add a later month on the web, pull to refresh on the native tab, and see it offered without a relaunch. Record the steps and result on the story. Verify: the result is on sc-3850.

## 4. Wrap up (sc-3850)

- [ ] 4.1 Release note or fork news only if user-facing text changes; otherwise state why none is needed in the PR. Verify: `yarn check:fork-news` passes if a note was added.
- [ ] 4.2 Archive this change after `add-native-budget-screen` and `native-bridge` are archived (the "Month outside the range" edit is already made in the spec PR). Verify: `yarn check:openspec-shortcut`.
