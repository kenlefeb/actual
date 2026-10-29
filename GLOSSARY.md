# Glossary

Fork-only; never upstream. The domain terms used by the fork's specs and ADRs (`docs/adr/`).

- **Business calendar**: a named set of non-working weekdays, holiday rules and per-year exceptions. It decides which days are **business days**. Stored in the budget (`business_calendars`). Not a calendar of events.
- **Business day**: a day that isn't a non-working weekday, an observed holiday or a non-business exception in a given business calendar. Without a calendar, any weekday is a business day.
- **Holiday rule**: a rule that yields a holiday each year: a fixed date, the nth or last weekday of a month, or an offset from Easter. It also has an **observance**, which says where the holiday moves when it falls on a weekend.
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
- **Deposit schedule**: the relative schedule a paycheck generates for one deposit. Its source is the pay schedule, and it's dated some business days before the pay date.
- **Days early**: how many business days before the pay date an account's direct deposits arrive, 0 to 10. A setting on the receiving account (`deposit_days_early`), shared by every paycheck that deposits there.
- **Account business days**: an account's business calendar plus its days early.
- **Lookup**: one of the two synchronous in-memory maps (business calendars, schedule dates) that schedule date math reads (ADR 1). Not a cache of server responses.
- **Fork data**: anything that exists only in this fork's budgets: the `business_calendars` and `paychecks` tables, the two account columns, the fork date shapes in rule conditions, and the fork flags (ADR 4).
