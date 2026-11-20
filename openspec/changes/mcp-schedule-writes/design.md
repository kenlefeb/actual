# Design

## Facts

Read from the code on `development` (2026-11-20).

- **Engine.** `schedule/create`, `schedule/update`, `schedule/delete`, `schedule/skip-next-date` and `schedule/post-transaction` are in `loot-core/src/server/schedules/app.ts`. `@actual-app/api` has `createSchedule`, `updateSchedule`, `deleteSchedule`, `getSchedules` and `getScheduleDates`, but no skip or post.
- **What the handlers guarantee.**
  - `createSchedule` requires a date condition, validates a relative date, refuses a duplicate name, inserts the rule, the next-date row and the schedule in one write, and computes the next date from today.
  - `updateSchedule` refuses a rule change and a duplicate name, recomputes the next date when the date or account changes (keeping skips on a date-only change), and refreshes relative dependents.
  - `deleteSchedule` deletes the rule and the schedule, then clears relative dependents.
- **API wrappers.** `api/schedule-create` builds the rule's conditions from a flat entity (payee, account, `amountOp`, `amount`, `date`); a missing payee or account is stored as the text `undefined`. `api/schedule-update` and `api/schedule-delete` refuse a schedule a paycheck manages. `next_date` and `completed` are system-managed and refused on update.
- **Complete.** No app action sets `completed`. The schedules service sets it when a one-time date has passed or a repeat ends. The app's row actions are Edit, Post transaction, Post transaction today, Skip next date and Delete.
- **MCP.** `schedules:write` is already one of the scopes. `loggedWrite` gives audit lines and, for a `destructive` tool under `confirm_destructive`, a dry run with a `confirm`. A create or update has no dry run today. `list_schedules` returns only id, completed, next date, amount and name.
- **Production grant.** It is a server file named by `ACTUAL_MCP_GRANTS_FILE` (format in `packages/mcp/README.md`); it is not in the hosting repo.

## D1. The tools

| Tool | Scopes | Needs | Undo |
| --- | --- | --- | --- |
| `write_create_schedule` | `schedules:write` | payee_id, account_id, one date form, amount rule | delete it while unused |
| `write_update_schedule` | `schedules:write` | schedule_id and any field | restore the fields |
| `write_skip_schedule_date` | `schedules:write` | schedule_id | not undoable |
| `write_post_schedule_transaction` | `schedules:write`, `transactions:write` | schedule_id, `today` optional | not undoable |
| `write_delete_schedule` | `schedules:write`, `delete` | schedule_id | not undoable (Q3) |
| `write_create_paycheck` | `schedules:write` | name, definition | delete it while unused |
| `write_delete_paycheck` | `schedules:write`, `delete` | paycheck_id | not undoable (Q2) |

Inputs use ids, never names. A create takes:
- `name`, `payee_id`, `account_id` (an existing, open account) and `posts_transaction` (default false, as in the app);
- the amount, in cents: `amount_op` of `is` or `isapprox` with `amount` (negative for money out), or `isbetween` with `amount_min` and `amount_max`;
- exactly one date form: `date` (one-time, `YYYY-MM-DD`), `recurrence`, or `relative_to`.

`recurrence` is `frequency` (daily, weekly, monthly, yearly), `interval`, `start`, optional day `patterns`, `end_mode` (never, after_n_occurrences, on_date) with `end_occurrences` or `end_date`, `skip_weekend`, `weekend_solve_mode` and `business_calendar_id`. `relative_to` is the engine's `RelativeDateConfig`. Both map one-to-one to the engine types, so `schedule-business-days` and `schedule-relative-dates` apply unchanged.

An update takes `schedule_id` and the same fields, all optional, plus `reset_next_date`. An update with no field is refused.

The tool maps to the engine's conditions the way the app's schedule form does, not through the API's flat entity, which stores `undefined` for a missing payee and fixes the date operator. A test compares the stored rule with the one `schedule/create` makes from the app form's input (acceptance: same stored result as the app).

The API gains `skipScheduleNextDate` and `postScheduleTransaction` (thin `send` wrappers, as `skipNextPaycheck` is).

## D2. Dry run

`dry_run: true` on create and update returns `{ dry_run: true, ids, changes, next_dates }` and writes nothing, not even an audit line. The next dates come from `getScheduleDates` with the existing count limit of `get_schedule_next_dates`. It needs no `confirm`: a create and an update are not destructive, and the existing rule is that only destructive and permanent actions answer a first call with a `confirm`.

Schedule delete and paycheck delete are not undoable, so both always answer the first call with a dry run and a `confirm`, whatever `confirm_destructive` says (`alwaysConfirm`, the "Permanent actions always confirm" rule). The schedule's preview names it, its next date, how many linked transactions it leaves behind and any relative dependents, and returns its definition so it can be recreated. The paycheck's preview returns its definition.

## D3. Errors

All refusals use fixed text, name `Nothing changed.`, and come before any audit line.
- Unknown or deleted payee, account or schedule id; a closed account.
- A paycheck-managed schedule on update, delete, skip or post: the text names the paycheck id and `write_update_paycheck` is not named (sc-4208 is not built).
- Amount: not an integer of cents (existing `requireAmount`), an `isbetween` range with min above max, or an amount form that does not fit the operator.
- Date: not exactly one date form; a date outside 1970 to 2100 (existing `requireDate`); an invalid recurrence (interval below 1, an end mode without its end value, an unknown calendar, an end date before the start); an invalid relative date (the engine's own check, including a cycle).
- A duplicate name (the engine's refusal, passed through).
- Post on a schedule with no account, or a completed schedule.

## D4. Audit, undo and the undo table

Every write appends the attempt and outcome lines through `loggedWrite`. A create logs `new` ids replaced by the created id on the outcome line, as `write_create_category` does. An update logs each changed field with before and after (the date definition as JSON). A delete logs the definition it removed (the schedule's fields and conditions, or the paycheck's definition), for the record and for recreating it by hand.

- **Create:** undo deletes the schedule, refused when it has linked transactions, relative dependents or changed since.
- **Update:** undo restores the before-values of the logged fields through the same engine update, refused when a field changed since. The next date is recomputed by the engine, so a date skipped after the update is not restored. A write is used once, as today.
- **Skip and post:** `NOT_UNDOABLE`. Skip: the engine cannot put back a skipped date (as `write_skip_paycheck`). Post: delete the transaction with `write_delete_transactions`.
- **Paycheck create:** undo deletes the paycheck while it has no posted pay transactions.
- **Schedule delete and paycheck delete:** `NOT_UNDOABLE`. Schedule delete: "recreate from the dry run's definition; a restore is planned in sc-5522". The same-id restore, for schedule and paycheck deletes, is the separate story sc-5522; this change does not touch `api/undelete-rows`.

## D5. Scope and the production grant

No new scope. The spec's scope list already says `schedules:write` covers schedules and paychecks; the deleting tools need `delete` as well (existing rule). One tool needs a second area scope: `write_post_schedule_transaction` adds a transaction, so it also needs `transactions:write`. `write_create_paycheck` needs `schedules:write` alone: the engine only reads an account's business calendar and days early to compute dates (`setAccountBusinessDays` writes them), and the inline clearing account it could create is not exposed (Q5).

Ken's first use, adding a loan schedule, needs only `schedules:write`.

The production grant is the server file named by `ACTUAL_MCP_GRANTS_FILE`. In the row whose `client` is `claude-production`, the `scopes` array must contain `"schedules:write"` (check whether it already does, since `write_skip_paycheck` needs it). For the group 1 tools that is `"schedules:write"`, and `"transactions:write"` for `write_post_schedule_transaction`. Group 2 needs no scope beyond `"schedules:write"` and `"delete"` (the two deletes); `"delete"` is already in the grant since alpha.45, so nothing more is added for it. Keep `confirm_destructive` true. The server re-reads the file on every call, so no restart is needed. This is a production change and needs Ken's approval.

## D6. Limits

No new setting. Each call changes one schedule or paycheck. A paycheck's deductions and deposits are bounded by the connection's `max_rows`; the audit-line limit and "an undoable write must stay undoable" apply as for every write.

## Risks

- **Date definition drift.** Hand-mapping recurrence to the engine's types can diverge from the app; the same-stored-result test guards it.
- **Delete is final.** Neither delete is undoable here; the always-confirm call and the logged definition are the safeguards (Q2, Q3).
- **Payee must exist.** A new lender is not yet a payee and the MCP has no payee create (Q4).

## Questions

Recommendations first; none blocks the proposal review.

- **Q1. What does "mark it complete" mean?** The app has no such action; `completed` is set by the service and the API refuses it. Recommend: map it to the app's "Post transaction" (`write_post_schedule_transaction`), which is how a one-time schedule is finished, and build no direct complete tool. Product Owner to confirm.
- **Q2. Is a paycheck delete undoable?** Ruled (Architect): not undoable now, with a fixed reason naming sc-5522; it always confirms. This departs from the sc-4650 acceptance ("undoable"); the Product Owner is confirming.
- **Q3. How does a schedule delete undo?** Ruled (Architect): it does not. Declared not undoable in `declarations.ts` with the reason "recreate from the dry run's definition; a restore is planned in sc-5522", and it always confirms. The same-id restore (extending `api/undelete-rows`) is the separate story sc-5522; it is not in this change.
- **Q4. Payee create.** Ken's lender may not be a payee. Recommend a separate Backlog story (`write_create_payee`, `structure:write`), filed by the Product Owner; until then he adds the payee in the app.
- **Q5. Inline clearing account.** `write_create_paycheck` takes an existing `clearing_account_id`; the app can also create one inline. Recommend leaving it out (use `write_create_account`).
