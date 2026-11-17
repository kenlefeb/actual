# Tasks

## 1. Set many budget amounts and configurable limits (sc-4209)

- [ ] 1.1 Limits (design D1, D2): server settings for the row and cell defaults, the grant's `max_cells`, ceilings, and `requireCells` beside `requireRows` in `packages/mcp/src/tools/write/shared.ts`, `grants.ts`, `config.ts`. Failing tests first: defaults 50 and 500, a setting changes them, a grant raises or lowers them, a value above a ceiling is refused, an invalid `max_cells` makes the grants file invalid
- [ ] 1.2 `write_set_budget_amounts` (`budget:write`) in `budget.ts` (design D3). Failing tests first: over the cell limit, a bad row in the middle changes nothing, a duplicate cell, scope refusal, audit before and after per cell, stop at first engine failure
- [ ] 1.3 Extend `UNDOABLE` in `undo.ts` for the new tool. Failing tests first: undo round trip, refused after a later change to a cell
- [ ] 1.4 `coverage.json` line, `README.md` (limits table, `max_cells`, new tool), `yarn check:mcp-coverage`
- [ ] 1.5 Hosting follow-up: add `max_cells` to the actual-hosting deploy command's `GRANT_KEYS` allowlist (ship the server image first); file the hosting PR
- [ ] 1.6 Run `yarn typecheck`, `yarn lint` and the `@actual-app/mcp` tests; all pass

## 2. Budget month actions (sc-4487)

### 2A. Carryover and hold

- [ ] 2.1 `write_set_budget_carryover`, `write_hold_budget_for_next_month`, `write_reset_budget_hold` (`budget:write`) (design D5). Failing tests first: scope refusal, tracking budget refuses hold, hold with no to-budget says nothing held, clamped hold reads back, carryover audit names the months, before and after audited, not undoable
- [ ] 2.2 `coverage.json` lines for the three API methods, `README.md`, typecheck, lint, tests

### 2B. Copy and average

- [ ] 2.3 Fork handlers and typed methods in `packages/loot-core/src/server/api.ts` and `packages/api/methods.ts` for copy previous month and the 3, 6, 12-month average, with a plan that does not write. Failing tests first against the app's own action on one fixture (envelope and tracking)
- [ ] 2.4 `write_copy_budget_month` and `write_set_budget_to_average` (design D4). Failing tests first: dry run then confirm, stale confirm after a cell changes, cell cap, hidden and income skipped, audit before and after, undo round trip (extend `UNDOABLE`)
- [ ] 2.5 `coverage.json`, `README.md`, typecheck, lint, tests

### 2C. Templates

- [ ] 2.6 Time-box the plan refactor of `processTemplate` to return cells before writing (design D4); if over a day, stop and file a Backlog story for 2C
- [ ] 2.7 Handlers, typed methods and `write_apply_budget_templates` (apply or overwrite, optional categories). Failing tests first: result equals the app's apply and overwrite on one fixture, dry run then confirm, cap, undo of cells only, no AI path
- [ ] 2.8 `coverage.json`, `README.md`, typecheck, lint, tests
