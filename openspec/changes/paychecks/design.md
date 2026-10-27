# Design

## Context

See proposal.md for motivation and the two specs for behavior. The earlier changes give schedules everything paychecks need for dates:
- `business-calendars`: calendars and the synchronous calendar lookup.
- `schedule-business-days`: a repeating date moved before/after a calendar's non-business days.
- `schedule-relative-dates`: a `RelativeDateConfig` date that is N business days before another schedule's moved date, in a chosen calendar. Offset 0 means the nearest earlier business day.

A schedule is a rule plus a `schedules` row. The rule's conditions hold the account, payee, amount (`is` or `isapprox`, ±7.5%) and date. Its actions run whenever the rule runs: on bank import, on posting a schedule, and in previews. They include split actions (`set-split-amount` with `options.splitIndex`, plus `set` category/payee per split), so a posted schedule can produce a split transaction. Setting a split's or transaction's payee to an account's transfer payee makes it a transfer. Accounts have no settings beyond their columns.

## Goals / Non-Goals

**Goals:**
- One shared, pure computation of a paycheck: net pay, deposit amounts and validation errors. The editor shows it live and the server enforces it.
- The paycheck definition is the source of truth. Its schedules are regenerated from it whenever it, or an account it uses, changes.

**Non-Goals:**
- Changing schedule, rule or relative-date semantics.
- Per-paycheck amount overrides or payroll calculations.
- Listing paychecks on a separate page. They are reached from the schedules page.

## Decisions

### Storage
A migration adds `business_calendar_id TEXT` and `deposit_days_early INTEGER DEFAULT 0` to `accounts`. It also creates `paychecks (id, name, definition TEXT, tombstone)`, synced like other tables.
- `definition` is JSON: payee, clearing account, date `RecurConfig` (without a calendar), skip mode, gross amount and category, deductions, and deposits (`{ id, account, kind: 'fixed' | 'percent' | 'remainder', value, postAutomatically }`).
- It also records the generated schedule ids: `paySchedule`, and `schedule` per deposit.
- Why JSON: the definition is edited and validated as a whole. Nothing queries inside it except "which paychecks use account X", which a `LIKE` on the account id answers.
- Alternative: normalized deduction and deposit tables. Rejected because they add sync surface for data that is never queried on its own.

### Shared computation
`shared/paychecks.ts` exports `computePaycheck(definition)`. It returns net pay, each deposit's amount in integer cents (percent rounded half away from zero, remainder last) and a list of error codes matching the spec's rules. The editor maps the codes to translated messages. The create and update handlers reject a definition with errors.

### Generated schedules
`writePaycheckSchedules(paycheck)` runs inside the handler's `undoable` mutation:
- **Pay schedule:** on the clearing account, with no payee condition and the employer payee set by action.
  - Amount: `is` net pay. `posts_transaction` is true.
  - Date: `isapprox` with the definition's `RecurConfig`, plus `skipWeekend: true`, the skip mode, and the clearing account's `businessCalendarId`.
  - Actions: split 1 is gross pay to the income category. Each deduction is a negative fixed split, set to its category or to the target account's transfer payee.
- **Deposit schedules:** on the receiving account, with no payee condition, so imported bank payees still match.
  - Amount: `isapprox` deposit amount.
  - Date: `isapprox` with a `RelativeDateConfig`: the pay schedule, `deposit_days_early` business days before, and the account's calendar.
  - Action: set the payee to the clearing account's transfer payee, so a linked import becomes a transfer.
  - `posts_transaction` follows the deposit's `postAutomatically`, off by default. Bank import deduplication merges a posted transaction only with an import of the exact same amount within 7 days (`accounts/sync.ts`), while the schedule rule links imports within ±7.5%. Off is safe for varying deposits; on suits manual accounts and steady amounts.
- Schedules missing from the stored ids are created, existing ones get their conditions and actions replaced, and ones no longer in the definition are deleted.
- Schedule names: "<paycheck>" for pay, "<paycheck> → <account>" for deposits.
- Why regenerate rather than patch: every input (definition, account calendar, early days) flows through one function, so account changes and edits cannot diverge.

### Account settings
`account/set-business-days` updates the two columns. It then rewrites the schedules of every paycheck whose definition mentions the account (as clearing or receiving account), all in one undoable mutation. A small desktop modal from the account menu edits the settings, and the account type documents the fields.

### Skip next paycheck
`paycheck/skip-next` calls the existing `skipNextDate` for the pay schedule and each deposit schedule inside one mutation.

### Editor
A desktop `PaycheckEditModal` offers:
- name and employer payee;
- the clearing account (new or existing on-budget account);
- the date pattern, reusing `RecurringSchedulePicker` without its calendar select, because the calendar comes from the clearing account;
- gross pay and category, a deductions list, and a deposits list;
- live totals and errors from `computePaycheck`.

It is opened from "Add paycheck" on the schedules page and from a "Part of paycheck … Edit paycheck" note in the schedule editor, for schedules whose id is in a paycheck. Everything sits behind the `businessCalendars` flag.

## Risks / Trade-offs

- [Users edit or delete a paycheck's schedules directly] → The schedule editor points to the paycheck. The next paycheck save regenerates missing or changed schedules from the definition.
- [Early deposits make the clearing account briefly negative, and a deposit before a month boundary shifts cash between months] → Expected (decided during exploration). Income is budgeted on the pay date.
- [Bank amounts vary beyond ±7.5% (bonus, overtime)] → The deposit stays unlinked and is shown as a normal import, as for any schedule. The user can link it by hand.
- [Older clients] → They see ordinary schedules and accounts. They ignore the new columns and the table.

## Migration Plan

One additive migration with nullable/defaulted columns and a new table. Rollback: delete paychecks (their schedules go with them) before downgrading. The columns are harmless to older versions.
