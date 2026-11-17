# Design

Facts read on origin/development: `loggedWrite` already dry-runs and confirms destructive tools under `confirm_destructive`; `requireRows` caps at `min(grant.max_rows ?? 50, 50)`; `write_undo` has an `UNDOABLE` table and a `planBudgetAmount` planner for `budgeted:YYYY-MM` fields; the API has `setBudgetAmount`, `batchBudgetUpdates`, `setBudgetCarryover`, `holdBudgetForNextMonth`, `resetBudgetHold` but no copy, average or template method.

## D1. Configurable limits

Server settings (operator only) give the defaults and ceilings. Stdio uses `ACTUAL_MCP_WRITES_` names, hosted `ACTUAL_MCP_`:

| Setting (suffix) | Default | Ceiling setting (suffix) | Ceiling default |
| --- | --- | --- | --- |
| `MAX_ROWS` | 50 | `MAX_ROWS_CEILING` | 1,000 |
| `MAX_CELLS` | 500 | `MAX_CELLS_CEILING` | 2,000 |
| `MAX_DELETE_ROWS` | 50 | `MAX_DELETE_ROWS_CEILING` | 1,000 |
| `AUDIT_TAIL_BYTES` | 2 MB | none | none |
| `MAX_RESPONSE_BYTES` | 100 KB | `MAX_RESPONSE_BYTES_CEILING` | 1 MB |

A grant's `max_rows`, `max_cells` and `max_delete_rows` replace the default for that connection, up to the ceiling; above it the grants file is invalid (a typo drops every connection to read-only, which is fail closed, and why the deploy validates the file first, D7). The limit in force is `grant ?? setting ?? built-in default`. No limit is hard-coded beyond these defaults. Rejected: keeping "lower only"; Ken said these are defaults.

The ceilings are bounded by the audit tail, not by a second constant: a cell costs about 105 bytes in a change plus 38 in `applied`, so 150 bytes with margin, and one ceiling-size write plus its undo plus a neighbour must stay in the tail the undo reads (`undo.ts` `MAX_TAIL_BYTES`, now `AUDIT_TAIL_BYTES`). The server refuses to start when `4 x MAX_CELLS_CEILING x 150`, or `4 x max(MAX_ROWS_CEILING, MAX_DELETE_ROWS_CEILING) x 250`, exceeds the tail (Security, PR #385: row writes fill the tail too). At the defaults that is 1.2 MB of 2 MB. This is why the cell ceiling is 2,000, not 5,000.

**Delete limit.** Today `requireRows` and 50 guard `write_delete_category_group` (`categories.ts`), account close and delete (`account-close.ts` counts transactions plus transfer partners) and undo of a create. Raising `max_rows` for budgets must not widen those. Delete tools use `min(grant.max_delete_rows ?? setting, grant.max_rows ?? infinity)`: raising `max_rows` or `max_cells` changes nothing for them, lowering `max_rows` still lowers them, so the existing lowered-cap scenarios hold. The `.max(MAX_WRITE_ROWS)` in the `transactions.ts` zod schemas and the "up to 50" tool descriptions derive from the row ceiling and setting at registration; the grant is enforced by `requireRows`. The tool list does not depend on the grant, so the schema allows up to the ceiling and the call is refused by the grant, with the message from `requireRows`.

## D2. Cells and rows are counted apart

`max_rows` limits rows of transactions, categories and the like. `max_cells` limits budget cells (category-month) that would change. Whole-month actions count changed cells (after differs from before), not categories examined. Over the limit: refused before the attempt line, naming the count and the limit. Audit lines name cells as `category:month` in `ids` and `applied`; a category id alone would make two months of one category indistinguishable.

## D3. set_budget_amounts

Validate everything first (real months, amounts, existing category ids, no duplicate month and category), refuse the whole call before any audit line. Apply one `setBudgetAmount` per cell, each re-reading its cell and re-checking its `before` inside the lock (D4) and stopping at the first mismatch or engine failure, reporting applied and failed cells; only applied cells enter `applied`. The lock is held for the whole run; a time budget or chunking is deferred (Backlog story linked to sc-4715), and the cell ceiling bounds it meanwhile. Not inside `batchBudgetUpdates`: a batch hides its own writes from reads until it ends, so the re-check of the next cell would be blind (found when implementing sc-4209). Audit: one `budgeted:YYYY-MM` change per cell, the form the single tool logs, so undo reuses `planBudgetAmount`. Not destructive: no dry run.

## D4. Month actions: plan, dry run, write

Copy, average and templates each compute a plan (cell, before, after, and for templates goal before and after) without writing; the tool marks itself destructive, so under `confirm_destructive` the first call returns the plan and a `confirm`. The `confirm` MAC binds the whole plan: every cell's before and after and every goal and automation-store value the call would write, because they are all in `entry.changes`. A dry run that cannot list every cell, with each category and group name beside it, within the response size setting (`MAX_RESPONSE_BYTES`, 100 KB by default; the reads keep their own 100 KB paging) is refused with fixed text and no `confirm` (narrow the categories or month); it is never truncated, because Ken wants a cell-by-cell dry run. At the default 500 cells (about 200 bytes each) it fits; the check matters when a setting raises the limit.

At write time, inside the lock, the plan is recomputed and must equal the confirmed one, and each cell re-checks its `before` as it is written; on a mismatch the remaining cells are not written and the result and outcome name applied and failed cells. A sync from another device between recompute and write is caught by the per-cell check. Without `confirm_destructive` the call writes at once with the same per-cell check.

Copy skips hidden categories and, in an envelope budget, income; average skips hidden ones and flips the sign for expenses, as the app does. Fork handlers `api/budget-*` (with `checkFileOpen`, `validateMonth`, `withMutation`) and typed methods; every handler has a `coverage.json` line. The cells must equal the app's action on the same fixture.

Templates: the one unknown. `processTemplate` writes budgets and goals while it runs, so the plan needs a refactor that returns the cells and goals first. If it is larger than a day, part C ships later as its own story; A and B do not wait. `applyTemplate` also stores note templates into the automation store; the plan lists those entries so the `confirm` covers them. No AI: templates are parsed notes.

Done in sc-4487 part 2C, well inside the time-box: `computeTemplates` already computed without writing, so the refactor only split `processTemplate`'s write lists out (`templateWrites`) and added `planTemplates`, which overlays the templates the notes would store (and the ones they would clear) on the stored ones and runs the same computation. The engine applies a template run as one batch, so the write step recomputes the plan inside the lock, requires it to equal the confirmed plan, applies once and reads the cells back, rather than checking cell by cell.

## D5. Carryover and hold

Both are one-cell actions, no dry run. Carryover: the engine sets the flag on the start month and every later month, so the audit logs `carryover:YYYY-MM` for the start month and the count of months, and the description says so. Hold and reset hold are envelope-only and refused in a tracking budget with fixed text; hold changes nothing when to-budget is not positive, so the result reads back `forNextMonth` and says whether it held. They are audited with before and after and not undoable here (sc-4741).

## D6. Undo

Undo of a budget-cell write is counted against the cell limit, not the row cap (today `undo.ts` calls `requireRows(log, plan.steps.length)` and `planBudgetAmount` handles one change). The planner works per `category:month` cell from `applied`: it compares each applied cell with the value the write left, refuses the whole undo, changing nothing, if any differs, and otherwise restores them. A write that stopped midway recorded only its applied cells, so cells that were never written cannot raise a false conflict (the case of one category in two months where the second failed). A partial failure during undo is recorded as for other undos: `applied` and `failed`, and the write cannot be undone again.

Undoable: `write_set_budget_amounts`, copy, average. Not undoable: carryover and hold (sc-4741) and templates. Templates also write goals and the automation store, which undo cannot restore yet; their audit line records each cell's goal before and after so a hand restore is possible. Marking them not undoable now, rather than restoring cells and leaving goals wrong, is the safe choice; a Backlog story covers undo of templates once goals are restorable.

## D7. Rollout

Order: (1) the server image that knows the new keys, (2) the actual-hosting `GRANT_KEYS` allowlist and the env passthrough of the new setting names (without the passthrough they silently stay at defaults), (3) the grants that use `max_cells`, `max_delete_rows` or raised values. The deploy validates the new grants file with the target image's validator before swapping it in. Rollback: rolling the image back after a grant uses a new key makes the file invalid and every connection read-only (an outage, fail closed); remove the new keys from the grants file first, then roll back. Until both environments run the new image they disagree: an old image clamps `max_rows` above 50 to 50, the new one honours it. The hosting change gets its own story after the image ships (PO, on PR #385).

## Risks

- A raised cell limit makes one audit line large; the ceiling is tied to the audit tail (D1), and a dry run that does not fit the response cap is refused (D4).
- One bad value in the grants file drops every connection to read-only (D7).
- A long run holds the write lock (sc-4715); deferred to a Backlog story.
