# Proposal

## Why

Stories sc-4207 (create, edit, skip and post schedules) and sc-4650 (delete a schedule; create and delete a paycheck), both in epic 1550, are proposed together at the Product Owner's request.

Ken's standing rule is that the MCP does everything he can do in the app, limited by permissions and not by missing tools. Today the MCP can only list schedules (`list_schedules`, `get_schedule_next_dates`) and skip a paycheck. Ken's client cannot add a loan payment schedule, so it cannot build the cash-flow forecast he asked for (sc-4207): the production budget holds only the seven paycheck schedules.

## What Changes

- **Group 1 (sc-4207): schedule tools** (`schedules:write`).
  - `write_create_schedule`: payee, account, amount (exact, approximate or range), a one-time date, a recurrence with end conditions, or a date relative to another schedule; whether it posts automatically; a name.
  - `write_update_schedule`: any of those fields on an existing schedule.
  - `write_skip_schedule_date`: skip the next date, as the app's "Skip next date".
  - `write_post_schedule_transaction`: post the schedule's transaction, as the app's "Post transaction" (and "Post transaction today").
  - `list_schedules` gains the fields an edit needs (payee, account, amount rule, date definition, posts automatically).
  - Create and update accept `dry_run: true`, which shows the stored result and the next dates and writes nothing.
  - Create and update are undoable.
- **Group 2 (sc-4650): deletes and paychecks** (`schedules:write`; `delete` for deletes).
  - `write_delete_schedule`, `write_create_paycheck`, `write_delete_paycheck`.
  - Both deletes are not undoable, so both always answer the first call with a dry run and a `confirm`, whatever `confirm_destructive` says (design Q2, Q3).
  - A paycheck create is undoable.
- **No new scope.** `schedules:write` already exists in `grants.ts` and in the spec ("schedules, paychecks, business calendars"), and `write_skip_paycheck` already needs it. Ken's production grant must list it (design D5).
- **No new limit.** One schedule or paycheck per call; the only list input (a paycheck's deductions and deposits) uses the connection's existing row limit.

Mobile scope: none. MCP tools have no UI.

Not in this change:
- editing a paycheck (sc-4208);
- creating a payee or an account inline (the paycheck tool takes an existing clearing account);
- setting a schedule's `completed` flag by hand (design Q1);
- schedule discovery, move and the link and unlink actions on rows.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `mcp-server`: ADDED requirements for the schedule and paycheck write tools, their dry run, undo, scopes and coverage. `schedule-relative-dates` and `schedule-business-days` are unchanged: the tools only pass their date definitions through to the engine.

## Impact

- **MCP code:** new `packages/mcp/src/tools/write/schedules.ts`; `paychecks.ts` (two tools); `declarations.ts` (undo table); `undo.ts` (two planners); `read/core.ts` (`list_schedules` fields); `coverage.json`, `README.md` and tests.
- **API and loot-core:** `packages/api/methods.ts` gains `skipScheduleNextDate` and `postScheduleTransaction`; `api/undelete-rows` is not touched (the same-id restore is sc-5522).
- **Production:** Ken's production grant must list `schedules:write`, plus `transactions:write` (post) and `delete` (the deletes). That is a production change and needs his approval.
- **Reviews:** Architect, Product Owner and Security Analyst (scope, delete, undo).
