# Tasks

## 1. Contract

- [ ] 1.1 Spec delta for `paychecks` "Editing and deleting paychecks"; verify with `openspec validate paycheck-schedules-api-guard --strict`

## 2. API guard

- [ ] 2.1 In `packages/api/methods.test.ts`, add failing tests named after the scenarios. Create the "Acme" paycheck through the app handler (`paycheck-create` via the API's internal connection) with Checking and Savings deposits and a "Rent" schedule.
  - "A script edits Acme's Checking deposit schedule": `updateSchedule` rejects with the exact message and the schedule is unchanged.
  - "A script deletes Acme's pay schedule": `deleteSchedule` rejects and the schedule is still listed by `getSchedules`.
  - "A script edits the rule behind Acme's pay schedule": `updateRule` rejects and the rule is unchanged.
  - "A script edits and deletes the Rent schedule": both succeed.
- [ ] 2.2 Add `getPaycheckManagingSchedule` to `server/paychecks/app.ts` (a `LIKE` query, then an exact id match on `paySchedule` and `deposits[].schedule`), with unit tests:
  - a deposit schedule id and the pay schedule id each return the paycheck;
  - an unrelated id returns null, even if it appears elsewhere in the definition;
  - a deleted paycheck's schedules return null.
- [ ] 2.3 Call it first in `api/schedule-update`, `api/schedule-delete` and `api/rule-update` (for a rule, look up its schedule) in `server/api.ts`, throwing `APIError` with the message. Verify the 2.1 tests pass
- [ ] 2.4 Add the test "The app still manages Acme's schedules": after a refused API edit, `paycheck-update` with a raise, then `paycheck-skip-next`, then `paycheck-delete`, update, advance and delete the schedules. Verify it and the existing `server/paychecks` tests pass

## 3. Docs

- [ ] 3.1 In `packages/docs/docs/api/reference.md`, state the rule under `updateSchedule`, `deleteSchedule` and `updateRule`, and fix "rule" to "schedule" in the `updateSchedule` description. Verify that `yarn workspace docs build` succeeds (or the docs lint, if the build is too slow)

## 4. Integration checks

- [ ] 4.1 Run the `api` and `loot-core` tests, `yarn typecheck` and `yarn lint`; all pass

## Workflow follow-up

- Archive the change when sc-558 merges.
