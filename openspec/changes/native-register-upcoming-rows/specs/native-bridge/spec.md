## ADDED Requirements

### Requirement: The register's upcoming rows come from loot-core
The first page of `native/account-register` SHALL return `upcoming`: rows built with the same functions as the web's preview (rules run, split-action relevance, per-line inversion), each with id, scheduleId, date, payee, category, categoryId, notes, signed amount, cleared, splitCount, transferAccount, status and `ruleFields`. Rows SHALL pass the read's scope and search with posted rows' predicate. Later pages SHALL omit `upcoming`, and the cursor SHALL NOT cover it.

#### Scenario: Rules applied
- **GIVEN** a schedule whose rule sets the payee "Power Co" and the category "Utilities"
- **WHEN** native code reads the first page
- **THEN** its upcoming row has payee "Power Co" and category "Utilities", equal to the web's preview

#### Scenario: A formula split line
- **GIVEN** a split schedule whose line payee is set by a formula that resolves to this account's transfer payee
- **WHEN** native code reads this account's first page
- **THEN** that line is an upcoming row, inverted

#### Scenario: Paging
- **WHEN** native code reads the second page with the first page's cursor
- **THEN** the page has no `upcoming`, `upcomingCount` or `upcomingTotal`, and the same rows as without schedules

#### Scenario: Filtered
- **WHEN** native code reads with scope `uncleared` and search "rent"
- **THEN** `upcoming` holds only rows that are uncleared and match "rent"

#### Scenario: More rows than SQLite's variable limit
- **GIVEN** 40 daily schedules and a cap of 366 days, about 14,600 upcoming rows
- **WHEN** native code reads the first page with a search
- **THEN** the read succeeds and filters them, with no error about too many variables

### Requirement: The register returns upcoming count and total
Whenever the first page returns `upcoming`, it SHALL also return `upcomingCount` (its rows, an inverted line counting once) and `upcomingTotal` (loot-core's sum of their signed amounts), and later pages SHALL omit both. `resultCount` and `resultTotal` SHALL count posted rows only.

#### Scenario: Separate totals
- **GIVEN** a search matching posted rows of -10.00 and -5.00 and an upcoming row of -20.00
- **WHEN** native code reads the first page
- **THEN** `resultCount` is 2, `resultTotal` is -1500, `upcomingCount` is 1 and `upcomingTotal` is -2000

#### Scenario: Nothing upcoming
- **WHEN** no schedule falls in the window
- **THEN** `upcoming` is empty, `upcomingCount` is 0 and `upcomingTotal` is 0

### Requirement: Upcoming rows name the fields rules set
Each upcoming row SHALL carry `ruleFields`: the names, from the fixed set payee, category, amount, notes, date, cleared and splits, of the fields whose value after the schedule's rules differs from the preview before them, in that order; empty when rules changed nothing. An inverted row SHALL carry its line's fields. Row ids SHALL be stable between reads: `preview/<schedule>/<date>`, and `preview/` plus the line id for an inverted line.

#### Scenario: Payee and category set by a rule
- **GIVEN** a schedule whose rule sets the payee and the category
- **WHEN** native code reads the first page
- **THEN** the row's `ruleFields` is `["payee", "category"]`

#### Scenario: Stable ids
- **WHEN** native code reads the same first page twice
- **THEN** every upcoming row, inverted lines included, has the same id both times, in the documented format

### Requirement: The upcoming horizon is a capped setting
The window SHALL be the budget's upcoming-length preference and each schedule's custom length, as on the web, capped at `accounts-register-upcoming-max-days`, a synced limit read through `readLimit` (default 92, ceiling 366). A missing or bad value SHALL fall back to the default with no refusal. When the cap hid any row, the first page SHALL return `upcomingCapDays` (the cap in days), and omit it otherwise.

#### Scenario: A custom length beyond the cap
- **GIVEN** a schedule with a custom upcoming length of 6 months and the default cap
- **WHEN** native code reads the first page
- **THEN** only its occurrences within 92 days of today are rows, and `upcomingCapDays` is 92

#### Scenario: Nothing hidden
- **GIVEN** every schedule's window inside the cap
- **WHEN** native code reads the first page
- **THEN** there is no `upcomingCapDays`

#### Scenario: A bad value
- **WHEN** `accounts-register-upcoming-max-days` is "0", "400" or "abc"
- **THEN** the cap is 92

### Requirement: The register's upcoming rows meet the latency gate
The perf suite SHALL time the register's first page on the 20,000-row account with 200 schedules in the window (split schedules, transfers into the account and daily schedules among them), with no filter, with search and with scope `uncleared`, and a worst case of 50 daily schedules across the full default cap, and SHALL fail when a median exceeds 50 ms.

#### Scenario: The gate runs in CI
- **WHEN** Fork CI runs `yarn workspace @actual-app/core run perf`
- **THEN** it prints each case's median and p95, the worst case included, and fails if a median is over 50 ms
