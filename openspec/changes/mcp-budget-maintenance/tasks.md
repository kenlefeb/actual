# Tasks

## 1. Set many budget amounts and configurable limits (sc-4209)

- [x] 1.1 Limits (design D1, D2): the settings and ceilings of the D1 table, the grant's `max_cells` and `max_delete_rows`, `requireCells`, and the delete limit `min(max_delete_rows, max_rows)` for `write_delete_category_group`, account close and delete and undo of a create, in `shared.ts`, `grants.ts`, `config.ts`; derive the zod `.max` and the "up to" text in `transactions.ts` and `categories.ts` from the settings. Failing tests first: defaults, a setting changes them, a grant raises or lowers within the ceiling, above the ceiling is refused or invalid, a raised ceiling admits a higher grant, start refused when the audit tail cannot hold 4 ceiling-size writes, a raised `max_rows` does not widen a group delete or account close, the existing lowered-cap scenarios still pass
- [x] 1.2 `write_set_budget_amounts` (`budget:write`) in `budget.ts` (design D3). Failing tests first: over the cell limit, a bad row in the middle changes nothing, a duplicate cell, scope refusal, audit before and after per cell, stop at first mismatch or engine failure with applied and failed cells named, per-cell before re-check inside the lock
- [x] 1.3 Budget-cell undo (design D6): audit cells as `category:month`, `UNDOABLE` for the new tool, cell-limit count instead of `requireRows`, `AUDIT_TAIL_BYTES` setting. Failing tests first: a 200-cell write is undone under the defaults, a write that failed on its second cell (one category, two months) undoes its first, one applied cell edited since refuses the whole undo, round trip
- [x] 1.4 `coverage.json` line, `README.md` (limits table, `max_cells`, new tool), `yarn check:mcp-coverage`
- [ ] 1.5 Hosting is its own story, filed once the image ships (design D7): `GRANT_KEYS` accepts `max_cells` and `max_delete_rows`, the setting names pass through, the deploy validates the grants file with the target image's validator before swapping it, in that order (image, then allowlist and env, then grants); note the rollback line. Not in this PR
- [x] 1.6 Run `yarn typecheck`, `yarn lint` and the `@actual-app/mcp` tests; all pass

## 2. Budget month actions (sc-4487)

Backlog stories to file before the PRs merge: undo of templates (goals and the automation store), and a time budget or chunking for long write runs, linked to sc-4715.

### 2A. Carryover and hold

- [x] 2.1 `write_set_budget_carryover`, `write_hold_budget_for_next_month`, `write_reset_budget_hold` (`budget:write`) (design D5). Failing tests first: scope refusal, tracking budget refuses hold, hold with no to-budget says nothing held, clamped hold reads back, carryover audit names the months, before and after audited, not undoable
- [x] 2.2 `coverage.json` lines for the three API methods, `README.md`, typecheck, lint, tests

### 2B. Copy and average

- [ ] 2.3 Fork handlers and typed methods in `packages/loot-core/src/server/api.ts` and `packages/api/methods.ts` for copy previous month and the 3, 6, 12-month average, with a plan that does not write. Failing tests first against the app's own action on one fixture (envelope and tracking)
- [ ] 2.4 `write_copy_budget_month` and `write_set_budget_to_average` (design D4). Failing tests first: dry run then confirm, a dry run too large for the response cap is refused with no confirm, stale confirm after a cell changes, a cell changed between recompute and write aborts the rest, cell cap, hidden and income skipped, audit before and after, undo round trip (extend `UNDOABLE`)
- [ ] 2.5 `coverage.json`, `README.md`, typecheck, lint, tests

### 2C. Templates

- [ ] 2.6 Time-box the plan refactor of `processTemplate` to return cells before writing (design D4); if over a day, stop and file a Backlog story for 2C
- [ ] 2.7 Handlers, typed methods and `write_apply_budget_templates` (apply or overwrite, optional categories). Failing tests first: result equals the app's apply and overwrite on one fixture, dry run then confirm, a `confirm` refused after a template line changes a goal with the same budgeted cells, the audit line holds goals before and after, undo refused as not undoable, cap, no AI path
- [ ] 2.8 `coverage.json`, `README.md`, typecheck, lint, tests
