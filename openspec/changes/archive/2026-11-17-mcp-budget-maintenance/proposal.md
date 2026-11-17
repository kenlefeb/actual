# Proposal

## Why

Story sc-4209: `write_set_budget_amount` takes one category and one month, and setting bill and debt budgets for two months took over 100 calls. Story sc-4487 (from the sc-4478 gap list; Ken: agents can do everything he can, limits by permission): the budget menu and month actions (carryover, hold, copy last month, set to average, apply templates) have no tool. Both are in Integrations (epic 1550), part of sc-4203.

Ken decided on 2026-11-16 (sc-4487 comment 4739): budget cells get their own per-call limit, separate from `max_rows`, default 500; whole-month actions always show a cell-by-cell dry run under `confirm_destructive`; and every limit (the row cap, the new cell cap, the grant's `max_rows`) is a default of a configurable setting, not a hard-coded number.

## What Changes

- **Group 1, sc-4209:** `write_set_budget_amounts` sets up to the cell limit of `{month, category_id, amount}` cells in one call, with before and after for each. New limits settings and grant option (below).
- **Group 2, sc-4487**, three parts, one PR each:
  - **A:** `write_set_budget_carryover`, `write_hold_budget_for_next_month`, `write_reset_budget_hold`. Existing API methods.
  - **B:** `write_copy_budget_month` and `write_set_budget_to_average` (3, 6 or 12 months), with a dry run. New fork handlers and typed API methods.
  - **C:** `write_apply_budget_templates` (apply or overwrite, optionally for listed categories), with a dry run. Templates are deterministic note rules, no AI.
- **Limits are settings.** Delete tools get their own limit so raising budget limits never widens a delete. The per-call row cap (default 50) and the new budget-cell cap (default 500) are server settings; a grant's `max_rows` and new `max_cells` set a connection's own values, and may be above or below the default, up to ceilings that are also operator settings. The audit tail is a setting too and bounds the ceilings.
- **Undo:** `write_undo` also reverses `write_set_budget_amounts`, copy and average, cell by cell against the cell limit. Carryover and hold (sc-4741) and templates (goals and the automation store are not restorable yet; their audit line records goals) are audited but not undoable here.
- All budget tools need `budget:write`. No new scope: they overwrite values and delete nothing.

Mobile scope: none. The MCP server has no UI, so this change is exempt from the desktop and mobile rule.

Not in this change: undo of carryover and hold (sc-4741); undo of templates (Backlog); a time budget or chunking for long runs (Backlog, linked to sc-4715); cover-overspending, transfer-available and the other budget-menu moves (Backlog if wanted); a UI for the limits.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-server`: new requirements "Set many budget amounts", "Budget carryover and hold", "Copy and average a budget month", "Apply budget templates", "Budget cells have their own limit" and "Limits are configurable defaults", "Delete tools have their own limit", "A confirm covers everything a call writes" and "Undo of budget cells"; "Write limits", "A grant sets the row and cell limits" (renamed from "A grant can lower the row cap"), "Hosted grants come from a grants file", "The grants file schema is strict", "Category group delete transfer target and limits" and "What undo reverses" are modified.

## Impact

- **api-fork-handlers:** parts B and C add handlers and typed methods; that spec's handler count and list change in the same PRs (a delta added then, once the handler names are fixed).

- **Code:** `packages/mcp/src/tools/write/budget.ts`, `shared.ts` (`requireRows`, new `requireCells`), `grants.ts` and `config.ts` (`max_cells`, the defaults), `undo.ts` (undoable table), tests, `coverage.json`, `README.md`; `packages/loot-core/src/server/api.ts` and `packages/api/methods.ts` for B and C.
- **Hosting (own story, after the image ships):** the actual-hosting deploy command's `GRANT_KEYS` allowlist and env passthrough for the new settings, and a deploy that validates the grants file with the target image first (design D7).
- **Reviews:** Tester; Solution Architect; Security Analyst (bulk overwrite, raised limits); Product Owner reviews intent.

## Decisions for Ken

None open. Decided 2026-11-16: separate cell cap, default 500, limits configurable.
