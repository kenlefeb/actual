# Glossary

Fork-only; never upstream. The domain terms used by the fork's specs and ADRs (`docs/adr/`).

- **Business calendar**: a named set of non-working weekdays, holiday rules and per-year exceptions. It decides which days are **business days**. Stored in the budget (`business_calendars`). Not a calendar of events.
- **Business day**: a day that isn't a non-working weekday, an observed holiday or a non-business exception in a given business calendar. Without a calendar, any weekday is a business day.
- **Holiday rule**: a rule that yields a holiday each year: a fixed date, the nth or last weekday of a month, or an offset from Easter. Each rule has an observance.
- **Observance**: where a holiday that falls on a non-working weekday is observed. There are three options: no shift; Sunday to the following Monday only; or Saturday to the preceding Friday and Sunday to the following Monday. The observed date is the non-business day, and it can fall in an adjacent year.
- **Preset**: a built-in calendar definition ("U.S. Federal Holidays", "U.S. Federal Reserve"). Creating a calendar from a preset makes an independent, editable copy, so later fixes to the preset don't change existing calendars.
- **Exception**: a one-off date that a calendar marks as a business day or a non-business day, overriding its rules.
- **Move off non-business days**: shifting a schedule's date to the nearest business day before or after it. Upstream calls this `skipWeekend` and `weekendSolveMode`. With a business calendar, it skips that calendar's non-business days rather than just weekends.
- **Relative date**: a schedule date defined as an offset (in days or business days, before or after) from each occurrence of another schedule, its **source schedule**. Stored as `RelativeDateConfig`.
- **Relative schedule**: a schedule whose date is a relative date.
- **Paycheck**: a definition of recurring pay. It has an employer payee, pay dates, gross pay, deductions and direct deposits. The app generates schedules from it. The definition is the source of truth (ADR 2).
- **Pay schedule**: the schedule a paycheck generates on its clearing account. It posts gross pay and the deductions on each pay date.
- **Pay date**: an occurrence of the pay schedule, after it's moved off non-business days.
- **Clearing account**: the on-budget account a paycheck's pay lands in before it's split into deposits. Its balance should return to zero after each pay date.
- **Deduction**: an amount taken out of gross pay, to a category or as a transfer (for example to a 401(k)).
- **Net pay**: gross pay minus deductions.
- **Direct deposit** (or **deposit**): one share of net pay sent to a receiving account. It can be fixed, a percent, or the remainder.
- **Deposit schedule**: the relative schedule a paycheck generates for one deposit. Its source is the pay schedule. Each deposit is dated the receiving account's days early, counted in business days of that account's calendar, before the pay date. With 0 days early, it falls on the pay date, or on the nearest earlier business day when the pay date isn't one.
- **Paychecks section**: the list of paychecks at the top of the Schedules page (when the `paychecks` flag is on). It has one row per paycheck, ordered by next pay date, showing net pay and each deposit's account, amount and expected date.
- **Skip next paycheck**: one undoable action that skips the next occurrence of the pay schedule and of every deposit schedule together.
- **Skipped paycheck**: an occurrence that was skipped this way. Its row shows "Skipped: <date>", and the following occurrence becomes the next paycheck. A pay transaction posted before its pay date counts as paid, not skipped.
- **Clearing account note**: the note in a clearing account's register (on a phone, its account page) that names its paycheck and says the balance should return to zero after each payday. The account also shows a paycheck icon in the sidebar (on a phone, the accounts list).
- **Clearing account warning**: the warning that follows the note (in the same line on desktop, on its own line on a phone) when the clearing account's balance isn't zero and the missing deposits (or, if none is missing, all deposits) are more than 2 business days past their expected dates. The paycheck's row shows the warning too.
- **Days early**: how many business days before the pay date an account's direct deposits arrive, 0 to 10. A setting on the receiving account (`deposit_days_early`), shared by every paycheck that deposits there.
- **Account business days**: an account's business calendar plus its days early.
- **Lookup**: one of the two synchronous in-memory maps (business calendars, schedule dates) that schedule date math reads (ADR 1). Not a cache of server responses.
- **Fork data**: anything that exists only in this fork's budgets: the `business_calendars` and `paychecks` tables, the two account columns, the fork date shapes in rule conditions, and the fork flags (ADR 4).
