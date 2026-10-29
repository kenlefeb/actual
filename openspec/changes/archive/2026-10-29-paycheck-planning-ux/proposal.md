# Proposal

## Why

Paychecks answer the planning question Ken asks most — what lands in which account, and when — only indirectly: after setup a paycheck has no screen of its own, just generated schedules ("Acme → Checking") mixed into the schedules list. The bookkeeping engine (clearing account, split transaction) is sound but invisible and unexplained, and setup is desktop-only behind an unrelated flag, so someone without a desktop can't use paychecks at all.

## What Changes

- A **Paychecks section** at the top of the Schedules page (desktop and mobile): one row per paycheck showing the next paycheck's date, net pay and each deposit (account, amount, date); "Show more" reveals the next three; a skipped paycheck shows as "Skipped: <date>"; the row offers "Skip next paycheck" with a confirmation and opens the editor when tapped; an empty state invites setting one up.
- A paycheck's generated schedules are **hidden from the regular schedules list** and reached through its row.
- The **clearing account is marked**: a paycheck icon in the sidebar and a one-line register note saying it should return to zero after each payday. Once every missing deposit's expected date has passed plus 2 business days and the account isn't back to zero, the note becomes a **warning** naming the amount and the missing deposit, also shown on the paycheck's row.
- The editor lets the user **change a deposit account's "business days early"** in place, noting it applies to every paycheck depositing there.
- The editor shows a **year-to-date summary** (gross pay, each deduction, net pay) for the current and previous year, from posted transactions.
- **Mobile gets the full editor** (create, edit, delete, skip) as one scrolling page with collapsible sections and net pay pinned at the bottom, after the list ships.
- **BREAKING (flags):** paychecks move from the `businessCalendars` flag to their own **`paychecks`** experimental flag; turning it on also turns on business calendars, and it starts on for anyone who already has a paycheck or has business calendars on.

Out of scope: per-paycheck overrides for one-off changes (bonuses, overtime) — those stay as edits to the posted transaction; hiding the clearing account; a separate Paychecks page or sidebar group.

## Capabilities

### New Capabilities
- `paycheck-planning`: the Paychecks section on the Schedules page — next-paycheck rows, upcoming occurrences, skipping from the list, skipped paychecks, the empty state, and the not-back-to-zero warning on a row.

### Modified Capabilities
- `paychecks`: the experimental flag and platforms (own `paychecks` flag, mobile editor); deposit and pay schedules no longer listed among regular schedules; the clearing account's marking, register note and warning; editing business days early from the editor; a year-to-date summary.

## Impact

- `packages/desktop-client`: Schedules page (desktop `components/schedules/index.tsx`, mobile `components/mobile/schedules`), a new paycheck list component, `PaycheckEditModal` (days early, year-to-date, mobile layout), sidebar account rendering, account register header, feature-flag list and Settings > Experimental.
- `packages/loot-core`: feature-flag type and default/migration for the new flag; a read of posted paycheck transactions for year-to-date totals and the clearing-account balance check; the schedules query used by the list (to exclude paycheck schedules).
- No sync-server or API changes; no new database tables (paycheck membership of schedules comes from paycheck definitions).
