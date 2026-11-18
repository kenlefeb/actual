## ADDED Requirements

### Requirement: Upcoming rows are their own read
Upcoming rows SHALL come from `native/account-upcoming {account_id, scope, search}`, a read-only handler, never from `native/account-register`. The register read SHALL do no schedule work: no schedule query, preview, status or rule run. `native/account-upcoming` SHALL join the bridge allowlist in the Swift list and the page's list, which stay equal, with a `coverage.json` skip, and SHALL validate `scope` and `search` as the register read does.

#### Scenario: The register read ignores schedules
- **GIVEN** an account with 200 schedules in the window
- **WHEN** native code reads the register's first page
- **THEN** the result has no `upcoming`, `upcomingCount`, `upcomingTotal` or `upcomingCapDays`, and no schedule or rule is read

#### Scenario: Allowlisted
- **WHEN** the page is asked for `native/account-upcoming`
- **THEN** it is forwarded, and both allowlists name it

#### Scenario: Bad arguments
- **WHEN** native code calls `native/account-upcoming` with an unknown account, scope `paid`, or a search over 100 characters
- **THEN** the call fails as the register read fails for the same arguments, and nothing is read or changed

### Requirement: The upcoming read returns rows as they will post
`native/account-upcoming` SHALL return `upcoming`: rows built with the web preview's functions (rules run, split-action relevance, per-line inversion), each with id, scheduleId, date, payee, category, categoryId, notes, signed amount, cleared, splitCount, transferAccount, status and `ruleFields`, filtered by the scope and search with posted rows' predicate. Every returned row SHALL have had its rules run.

#### Scenario: Rules applied
- **GIVEN** a schedule whose rule sets the payee "Power Co" and the category "Utilities"
- **WHEN** native code reads `native/account-upcoming`
- **THEN** its row has payee "Power Co" and category "Utilities", equal to the web's preview

#### Scenario: A template split line
- **GIVEN** a split schedule whose line payee is set by a template action that resolves to this account's transfer payee
- **WHEN** native code reads this account's upcoming rows
- **THEN** that line is a row, inverted

#### Scenario: Filtered
- **WHEN** native code reads with scope `uncleared` and search "rent"
- **THEN** `upcoming` holds only rows that are uncleared and match "rent"

#### Scenario: More rows than SQLite's variable limit
- **GIVEN** a row cap of 500 and 500 upcoming rows, each with split lines
- **WHEN** native code reads with a search
- **THEN** the read succeeds and filters them, with no error about too many variables

### Requirement: The upcoming read returns its count and total
`native/account-upcoming` SHALL return `upcomingCount` (its returned rows, an inverted line counting once) and `upcomingTotal` (loot-core's sum of their signed amounts). The register read's `resultCount` and `resultTotal` SHALL count posted rows only.

#### Scenario: Separate totals
- **GIVEN** a search matching posted rows of -10.00 and -5.00 and an upcoming row of -20.00
- **WHEN** native code reads the register's first page and the upcoming read
- **THEN** `resultCount` is 2 and `resultTotal` is -1500; `upcomingCount` is 1 and `upcomingTotal` is -2000

#### Scenario: Nothing upcoming
- **WHEN** no schedule falls in the window
- **THEN** `upcoming` is empty, `upcomingCount` is 0 and `upcomingTotal` is 0

### Requirement: Upcoming rows name the fields rules set
Each upcoming row SHALL carry `ruleFields`: the names, from the fixed set payee, category, amount, notes, date, cleared and splits, of the fields whose value after the schedule's rules differs from the preview before them, in that order; empty when rules changed nothing. An inverted row SHALL carry its line's fields. Row ids SHALL be stable between reads: `preview/<schedule>/<date>`, and `preview/` plus the line id for an inverted line.

#### Scenario: Payee and category set by a rule
- **GIVEN** a schedule whose rule sets the payee and the category
- **WHEN** native code reads the upcoming rows
- **THEN** the row's `ruleFields` is `["payee", "category"]`

#### Scenario: Stable ids
- **WHEN** native code reads the same upcoming rows twice
- **THEN** every row, inverted lines included, has the same id both times, in the documented format

### Requirement: The upcoming horizon is a capped setting
The window SHALL be the budget's upcoming-length preference and each schedule's custom length, as on the web, capped at `accounts-register-upcoming-max-days`, a synced limit read through `readLimit` (default 92, ceiling 366). A missing or bad value SHALL fall back to the default with no refusal. When the cap hid any row, the read SHALL return `upcomingCapDays` (the cap in days), and omit it otherwise.

#### Scenario: A custom length beyond the cap
- **GIVEN** a schedule with a custom upcoming length of 6 months and the default cap
- **WHEN** native code reads the upcoming rows
- **THEN** only its occurrences within 92 days of today are rows, and `upcomingCapDays` is 92

#### Scenario: Nothing hidden
- **GIVEN** every schedule's window inside the cap
- **WHEN** native code reads the upcoming rows
- **THEN** there is no `upcomingCapDays`

#### Scenario: A bad value
- **WHEN** `accounts-register-upcoming-max-days` is "0", "400" or "abc"
- **THEN** the cap is 92

### Requirement: Upcoming rows are capped before rules run
The read SHALL keep, in the web's preview order, at most `accounts-upcoming-max-rows` previews (a synced limit through `readLimit`, default 100, ceiling 500) of the schedules relevant to the account, before rules run, then run rules, invert, filter and count only those. When previews were dropped it SHALL return `upcomingMore`, their number; else omit it. Rows past the cap are neither searched nor counted.

#### Scenario: Fifty daily schedules
- **GIVEN** 50 daily schedules over a 92-day window, about 4,600 previews, and the default row cap
- **WHEN** native code reads the upcoming rows
- **THEN** rules run for 100 previews only, the nearest by date, and `upcomingMore` is the number dropped

#### Scenario: Under the cap
- **GIVEN** 12 previews in the window
- **WHEN** native code reads the upcoming rows
- **THEN** all 12 run rules and there is no `upcomingMore`

#### Scenario: A bad value
- **WHEN** `accounts-upcoming-max-rows` is "0", "600" or "abc"
- **THEN** the cap is 100

### Requirement: Schedule statuses cost one query
The upcoming read SHALL work out statuses only for schedules relevant to the account, and SHALL find which of them already have a transaction in their occurrence window with one query over their ids (each schedule's latest transaction date compared with its match start date), giving the same answer as `getHasTransactionsQuery`.

#### Scenario: Same answer as the web's query
- **GIVEN** a budget fixture with paid, unpaid, split and transfer schedules
- **WHEN** the one-query check and `getHasTransactionsQuery` run over the same schedules
- **THEN** they name the same schedules

### Requirement: The reads meet their latency gates
The perf suite SHALL fail when the register's first page median exceeds 50 ms on the 20,000-row account with 200 schedules in the window, or when `native/account-upcoming`'s median exceeds 100 ms with those 200 schedules (split, transfer-in and daily among them) or 150 ms in a worst case of 50 daily schedules across the 92-day cap, each with no filter, search and scope `uncleared`.

#### Scenario: The gates run in CI
- **WHEN** Fork CI runs `yarn workspace @actual-app/core run perf`
- **THEN** it prints each case's median and p95, and fails if a median is over its gate
