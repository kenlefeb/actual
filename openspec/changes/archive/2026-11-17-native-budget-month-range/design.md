# Design

## Context

See `proposal.md`. Facts about the code, read on `development` on 2026-11-13:

- `native/budget-month` (`packages/loot-core/src/server/native/app.ts`) accepts a `YYYY-MM` month only if the month's spreadsheet sheet has a `total-budgeted` cell, otherwise it throws `native/budget-month: no budget for month <m>`. A month's cells exist exactly when loot-core has created that month, and loot-core records the created months in `sheet.get().meta().createdMonths`, a `Set<string>` the handler can read without side effects.
- The web gets its bounds from `get-budget-bounds`, which is `createAllBudgets()`: it creates the months of `getBudgetRange` (3 months before the earliest need, a year or more ahead) and returns `{start, end}`. It writes, so the native bridge must not call it, and it is not on the allowlist.
- `BudgetViewModel` (`NativeBridgeCore`) keeps `missingBefore` and `missingAfter`, set when a month step fails with `noBudgetForMonth`, and derives `canGoPrevious`, `canGoNext` and `pickerMonths` (a window of 24 months back and 12 forward of the visible month, filtered by those two values) from them. They are never cleared, so a month learned as missing stays hidden for the life of the view model. Every load and every step goes through `read(_:isStep:)`, which is generation-counted and keeps the last good snapshot (`.stale`) on failure.
- `NativeBudgetViewController.swift` binds the two chevrons' `disabled` state and the picker's `ForEach` to those three properties, so it needs no change beyond what the view model exposes.
- The Swift side and the loot-core side are decoded against the same fixtures (`packages/loot-core/src/server/native/fixtures/budget-month-*.json`). The page, and so loot-core, is served by the sync server, so an app build can meet a server whose handler predates the fields.

## Goals / Non-Goals

**Goals**

- Previous, Next and the picker know the edges from the first load, with no wasted tap.
- A month the web adds later is offered without relaunching the app.
- The handler stays read-only.

**Non-Goals**

- No new handler, no new allowlist entry, no way to create months from native, no Swift copy of `getBudgetRange`.

## Decisions

### 1. Two additive fields on the existing handler

`native/budget-month` returns `firstMonth` and `lastMonth`: the minimum and maximum of `createdMonths`, as `YYYY-MM`. They are plain strings and every month between them is readable, because loot-core creates the budget range as one run of months (`createAllBudgets`). The handler has already refused an unknown month by the time it builds the result, so the set is non-empty and `firstMonth <= month <= lastMonth` always holds. The cost is one pass over a few dozen strings, far under the 50 ms read gate.

Alternatives. (a) Call `get-budget-bounds` from native: it creates budgets, so a read could write. Rejected. (b) A second handler such as `native/budget-range`: a second round trip and a new allowlist entry for two strings that belong to the read the screen already makes. Rejected. (c) Derive the range with `query` in Swift: copies `getBudgetRange`. Rejected; the story forbids it.

### 2. The range travels with every read; no memory

The view model keeps the range of its last successful read and derives `canGoPrevious`, `canGoNext` and `pickerMonths` from it. `missingBefore` and `missingAfter` are deleted. Each successful read, whether a load, a step, a change event, a sync or a save, replaces the range, so when the web adds a later month the next read (the existing `cells-changed` and `sync-event` re-reads, a pull to refresh, or returning to the tab) offers it. A failed read keeps the last range along with the last good numbers.

### 3. The picker lists the whole range

`pickerMonths` becomes every month from `firstMonth` through `lastMonth`, which the tab shows newest first as it does now. The old 24-back, 12-forward window existed only because the range was unknown; a range is typically a few years, and a SwiftUI `Menu` scrolls. Alternative: keep the window, clamped to the range. Rejected as a second rule to keep in step with the first, and it would leave early months reachable only by repeated Previous taps.

### 4. Version skew: an absent range falls back, without memory

`firstMonth` and `lastMonth` decode as optional in `BudgetMonth`, so a server whose loot-core predates them does not break the screen. With no range the tab behaves as before the change: Previous and Next are enabled, the picker shows the window around the visible month, and a step the handler refuses ("no budget for month") keeps the month and its numbers on screen. That refusal is not remembered; the next read that carries a range, or the next tap, decides again. The fallback is deleted once the minimum supported server includes the fields.

### 5. A refused step with a known range

With a range, a step outside it is never sent. If the range was stale and a step is still refused (a month cannot be removed from a budget, so this needs a race or a reset), the screen keeps the visible month and numbers, as it does today, and the next read refreshes the range.

### 6. Testing

Test first, as `tasks.md` orders. The vitest contract gains the two fields in the envelope, tracking and JPY fixtures (regenerate with `vitest -u`), plus tests that a budget with several months reports the right edges, that reading creates no budget (the set of created months is unchanged), and that months created later move `lastMonth` on the next read. The Swift tests decode the same fixtures and cover the view model: edges disabled at first load with no read beyond the first, the picker equal to the range, a later `lastMonth` offered after the next read with no relaunch, an absent range falling back to the window, and no behaviour left that depends on a remembered refusal.

## Risks / Trade-offs

- [The set of created months is not contiguous] → loot-core creates ranges, so it is contiguous in practice; the contract test seeds a gap-free set and the spec states the assumption. A gap would at worst offer a month the handler then refuses, which the screen handles (Decision 5).
- [A long picker on a large range] → `Menu` scrolls; revisit if Ken finds it unwieldy on a device.
- [Old server, new app] → Decision 4.
- [The base specs are in open changes] → this delta is written against them and archives after them; if the names differ at archive time, the requirement text moves with them.

## Migration Plan

No data migration and no switch of its own: it ships inside the native Budget screen, behind the per-screen switch (default off). The fields are additive, so the web client and `packages/mcp` are unaffected (`yarn check:mcp-coverage` must still pass; no `coverage.json` line changes, because the handler name is unchanged). Rollback is turning that switch off.

## Open Questions

None.
