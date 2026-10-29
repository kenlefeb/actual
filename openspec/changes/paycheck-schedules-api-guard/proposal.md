# Proposal

## Why

`@actual-app/api` scripts can update or delete the schedules a paycheck generated. The next paycheck save regenerates them, so a script's change silently disappears later, or the deposits drift until then. There's no public paychecks API (Shortcut sc-558; ADR 2).

## What Changes

- The API's `updateSchedule` and `deleteSchedule` refuse a schedule that a paycheck generated, meaning its pay schedule or one of its deposit schedules. They fail with "This schedule is managed by paycheck "Acme". Edit the paycheck in the app." and change nothing.
- The API's `updateRule` refuses the rule behind such a schedule with the same error, since editing that rule edits the schedule (design.md, Product decisions 1). `deleteRule` already refuses any rule that has a schedule: it resolves to `false` without deleting. The spec now records that behaviour. ADR 2 is updated to match (task 3.2).
- The app is unchanged. Its paycheck save, delete and skip keep regenerating, deleting and advancing these schedules, and the app's own schedule editor keeps its existing note that changes last only until the next paycheck save.
- The API reference (`packages/docs/docs/api/reference.md`) says the app manages paycheck schedules and that these calls refuse them.

Non-goals: a public paychecks API; guarding internal (non-`api/`) handlers; reconciling schedules that a paycheck generated but no longer lists (sc-556).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `paychecks`: "Editing and deleting paychecks" adds that the API refuses updates and deletes of a paycheck's schedules, while the app's paycheck actions keep working.

## Impact

- Code: `packages/loot-core` only:
  - `server/api.ts`: a guard in `api/schedule-update`, `api/schedule-delete` and `api/rule-update`, before any write.
  - A lookup from a schedule id to the paycheck that lists it (`server/paychecks/app.ts`).
  - Tests in `packages/api/methods.test.ts`.
- Docs: the Schedules section of `packages/docs/docs/api/reference.md`. No spec covers the API docs.
- Data, sync and the app UI: none. Errors use the existing `APIError`.
- Consistent with ADR 2: the paycheck definition is the source of truth, and its stored `paySchedule` and `deposits[].schedule` ids identify the generated schedules.
