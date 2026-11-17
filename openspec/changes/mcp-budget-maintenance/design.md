# Design

Facts read on origin/development: `loggedWrite` already dry-runs and confirms destructive tools under `confirm_destructive`; `requireRows` caps at `min(grant.max_rows ?? 50, 50)`; `write_undo` has an `UNDOABLE` table and a `planBudgetAmount` planner for `budgeted:YYYY-MM` fields; the API has `setBudgetAmount`, `batchBudgetUpdates`, `setBudgetCarryover`, `holdBudgetForNextMonth`, `resetBudgetHold` but no copy, average or template method.

## D1. Configurable limits

Two server settings give the defaults: rows (default 50) and cells (default 500). Stdio: `ACTUAL_MCP_WRITES_MAX_ROWS` (exists) and new `ACTUAL_MCP_WRITES_MAX_CELLS`. Hosted: `ACTUAL_MCP_MAX_ROWS` and `ACTUAL_MCP_MAX_CELLS`. A grant's `max_rows` and new `max_cells` replace the default for that connection and may be higher or lower; the grants file is root-owned and fail-closed, so it is the operator's choice. The limit in force is `grant value ?? server setting ?? built-in default`. The ceilings, 1,000 rows and 5,000 cells by default, keep an audit line and the response bounded. They are server settings too (hosted `ACTUAL_MCP_MAX_ROWS_CEILING` and `ACTUAL_MCP_MAX_CELLS_CEILING`; stdio `ACTUAL_MCP_WRITES_MAX_ROWS_CEILING` and `_CELLS_CEILING`), set only by the operator, never by a grant. A setting above its ceiling is refused at start; a grant above it makes the file invalid. Rejected: keeping "lower only"; Ken said these are defaults.

## D2. Cells and rows are counted apart

`max_rows` limits rows of transactions, categories and the like. `max_cells` limits budget cells (category-month) that would change. Whole-month actions count changed cells (after differs from before), not categories examined. Over the limit: refused before the attempt line, naming the count and the limit.

## D3. set_budget_amounts

Validate everything first (real months, amounts, existing category ids, no duplicate month and category), refuse the whole call before any audit line. Apply inside `batchBudgetUpdates`, one `setBudgetAmount` per cell, stopping at the first engine failure and reporting applied and failed. Audit: one `budgeted:YYYY-MM` change per cell, the form the single tool logs, so undo reuses `planBudgetAmount`. Not destructive: no dry run.

## D4. Month actions: plan, dry run, write

Copy, average and templates each compute a plan (cell, before, after) without writing; the tool marks itself destructive, so under `confirm_destructive` the first call returns the plan and a `confirm`, and the second recomputes and must match. Without `confirm_destructive` it writes at once. Copy skips hidden categories and, in an envelope budget, income; average skips hidden ones and flips the sign for expenses, as the app does. Fork handlers `api/budget-*` (with `checkFileOpen`, `validateMonth`, `withMutation`) and typed methods; every handler has a `coverage.json` line. Plan and write must give the same cells the app's action gives on the same fixture.

Templates: the one unknown. `processTemplate` writes budgets and goals while it runs, so the plan needs a refactor that returns the cells first. If it is larger than a day, part C ships later as its own story; A and B do not wait. `applyTemplate` also stores note templates into the automation store; the description says so. No AI: templates are parsed notes.

## D5. Carryover and hold

Both are one-cell actions, no dry run. Carryover: the engine sets the flag on the start month and every later month, so the audit logs `carryover:YYYY-MM` for the start month and the count of months, and the description says so. Hold and reset hold are envelope-only and refused in a tracking budget with fixed text; hold changes nothing when to-budget is not positive, so the result reads back `forNextMonth` and says whether it held. They are audited with before and after and not undoable here (sc-4741).

## D6. Undo

Add the tools that write `budgeted:` cells to `UNDOABLE` with `['budget:write']` and the `planBudgetAmount` planner. Copy, average and templates also change goals and, for templates, the automation store; undo restores the budgeted cells only and its description says so. The conflict check (any cell changed since) applies per cell as for one amount.

## Risks

- A raised cell limit makes one audit line and one result large; the result lists cells up to the 100 KB response cap and reports the changed count, and the ceiling in D1 bounds the line.
- Hosting: a grant with `max_cells` before the image knows it makes the grants file invalid and drops every connection to read-only. Ship the image first.
