# 2. The paycheck definition is the source of truth

Fork-only; never upstream. Accepted 2026-10-29.

## Context

A **paycheck** turns into ordinary schedules: one **pay schedule** on the
**clearing account**, and one **deposit schedule** per **direct deposit**. The
deposit schedules use relative dates, a number of business days before the pay
date. Those schedules drive previews, posting, forecasts and goal templates,
the same as any other schedule. Their inputs can change from two places: the
paycheck itself, or the receiving account's business calendar and **days early**.

## Decision

- The `paychecks.definition` JSON
  ([`types/models/paycheck.ts`](../../packages/loot-core/src/types/models/paycheck.ts))
  is the source of truth. It stores the ids of the schedules it generated:
  `paySchedule` and `deposits[].schedule`.
- Every create, update and skip regenerates all of the paycheck's schedules
  from the definition and the current account settings
  ([`writePaycheckSchedules`, `paychecks/app.ts:232-358`](../../packages/loot-core/src/server/paychecks/app.ts)).
  Existing schedules are updated in place. A missing one is recreated. A
  schedule for a deposit that was removed is deleted.
- `account-set-business-days` regenerates every paycheck whose definition
  mentions the account. It finds them with a `LIKE` on the definition
  (`paychecks/app.ts:603-644`).
- All of this runs inside one `mutator(undoable(...))`, so undo restores the
  definition and its schedules together.

## Consequences

- Editing a generated schedule directly lasts only until the next paycheck
  save. The schedule editor says so. API scripts can still edit or delete
  generated schedules; sc-558 will make the API refuse that.
- **Concurrent edits aren't handled yet (sc-556).** Each device creates the
  schedules for its own edit, and the definition syncs as one value with last
  write wins ([ADR 3](0003-json-columns-last-write-wins.md)). Two devices that
  each add a deposit before syncing leave one device's deposit schedule active
  but unlisted in the definition, and forecasts count it twice. The intended
  rule: an active schedule a paycheck generated must be listed in its
  definition, or the next reconcile deletes it. sc-556 decides when that
  reconcile runs.
- There's no public paychecks API (Ken, 2026-10-29).

## Links

- Specs: `paychecks` ("Deposit schedules", "Editing and deleting paychecks"),
  `account-business-days` ("Account changes update deposit dates").
- Change: `openspec/changes/archive/2026-10-27-paychecks/design.md`.
- Stories: sc-556, sc-558.
