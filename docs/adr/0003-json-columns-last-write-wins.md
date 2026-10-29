# 3. JSON-value columns with last-write-wins sync

Fork-only; never upstream. Accepted 2026-10-29.

## Context

Actual syncs each cell (table, row, column) as a CRDT message, and the newest
write to a cell wins. The fork's new data comes in nested shapes: a calendar's
holiday rules and exceptions, and a paycheck's deductions and deposits. The
editor edits and validates each of these as a unit, and nothing queries inside
them.

## Decision

Store each nested shape as JSON text in one column, as upstream already does
for `rules.conditions` and `rules.actions`:

- `business_calendars.non_working_days`, `.holidays` and `.exceptions`
  ([migration](../../packages/loot-core/migrations/1793116240000_add_business_calendars.sql)).
- `paychecks.definition`
  ([migration](../../packages/loot-core/migrations/1793200000000_add_paychecks.sql)).

Server handlers validate a value when they write it. Reads parse it
defensively and skip what they can't parse:

- `parseJsonArray` in
  [`business-calendars/app.ts`](../../packages/loot-core/src/server/business-calendars/app.ts).
- `toPaycheck`, which returns `null` for a definition it can't parse
  ([`paychecks/app.ts:53-63`](../../packages/loot-core/src/server/paychecks/app.ts)).

## Consequences

- Concurrent edits to the same column on two devices don't merge. The later
  write replaces the whole value, so one device's added holiday or deposit is
  lost. That's accepted for calendars, which are small and edited rarely. For
  paychecks the lost write can also leave a stray schedule behind (see
  [ADR 2](0002-paycheck-definition-is-source-of-truth.md), sc-556).
- One migration per feature, and no new AQL relations to wire up.
- Finding which rows reference an id means a `LIKE` on the JSON text
  (`paychecks/app.ts:629`, `schedules/app.ts`). That's acceptable because UUIDs
  don't collide.

## Links

- Changes: `openspec/changes/archive/2026-10-27-business-calendars/design.md`
  ("One table with JSON rule columns"), `2026-10-27-paychecks/design.md`.
- Story: sc-556.
