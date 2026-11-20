# Tasks

**Tests first:** for every task, write the tests, see them fail, then write the code. Say in the PR which tests failed first.

**Depends on:** nothing unmerged. Open design questions (design.md Q1 to Q5) are answered by the Product Owner and Architect before group 2 starts; group 1 does not wait.

## 1. Schedule tools (sc-4207)

- [ ] 1.1 `list_schedules` fields (payee id, account id, amount operator and amount, date definition, `posts_transaction`, managing paycheck id). Failing tests first: a created schedule shows every field; a paycheck's schedule names its paycheck.
- [ ] 1.2 `packages/api/methods.ts`: `skipScheduleNextDate` and `postScheduleTransaction` (`send` wrappers). Failing tests first: skip moves the next date; post adds a linked transaction.
- [ ] 1.3 `write_create_schedule` in `tools/write/schedules.ts` (`schedules:write`). Failing tests first:
  - the monthly loan payment scenario, and the stored rule equals the one `schedule/create` makes from the app form's input;
  - each date form (one-time, recurrence with each end mode, relative with a business calendar);
  - refusals: unknown or closed ids, bad amount, `isbetween` with min above max, two date forms, bad recurrence, duplicate name, with no audit line;
  - audit attempt and outcome lines with the created id.
- [ ] 1.4 `write_update_schedule`. Failing tests first: one field changes only that field; the next date follows the engine; no field, a paycheck-managed schedule and a duplicate name are refused; before and after are logged.
- [ ] 1.5 `dry_run` on create and update. Failing tests first: next dates are returned; nothing is written, including the audit log.
- [ ] 1.6 `write_skip_schedule_date` and `write_post_schedule_transaction`, each declared in `NOT_UNDOABLE` with its reason. Failing tests first: results match the app's actions; completed, accountless and paycheck-managed schedules are refused; `write_undo` gives the reason.
- [ ] 1.7 Undo of create and update in `undo.ts` and the `UNDOABLE` table. Failing tests first: create removed; update restored; refused after another edit, with linked transactions or dependents; refused the second time.
- [ ] 1.8 Scope tests: each tool is refused without `schedules:write` and names it; its description names its scopes and its undo sentence.
- [ ] 1.9 `coverage.json` lines for the handlers these tools call, `README.md` tool list and the production grant note; `yarn check:mcp-coverage` passes.

## 2. Schedule delete and paychecks (sc-4650)

- [ ] 2.1 `write_delete_schedule` (`schedules:write`, `delete`, destructive). Failing tests first: refused without `delete`; dry run and `confirm` under `confirm_destructive`; a paycheck-managed schedule is refused; the attempt line holds the undo snapshot and relative dependents, within the audit-line limit.
- [ ] 2.2 Undo of a schedule delete per design Q3 (extend `api/undelete-rows` to the schedule rows, or declare it not undoable if the Architect decides so). Failing tests first: same ids back, linked transactions linked again, dependents refreshed; refused on any conflict.
- [ ] 2.3 `write_create_paycheck` (`schedules:write`). Failing tests first: the paycheck and schedules equal the app's for the same input; bad clearing account, deductions above the row limit; undo deletes while no pay posted.
- [ ] 2.4 `write_delete_paycheck` (`schedules:write`, `delete`, destructive; not undoable). Failing tests first: confirm flow; the dry run returns the definition; `write_undo` gives the reason.
- [ ] 2.5 `coverage.json`: `paycheck-create` and `paycheck-delete` (and their API names) map to the tools, replacing their skips; `paycheck-update` keeps its skip (sc-4208). `yarn check:mcp-coverage` passes.
- [ ] 2.6 Tell Ken the production grant line (design D5) when the build ships; do not edit the production grant.
