# Design

## Context

Read on `development` at 2645aa42b:

- `upcomingRows` in `server/native/accounts.ts` calls `computeSchedulePreviewTransactions` and runs no rules. Its account test is `_account === account` or a payee that transfers in, so it misses the split-action branch. It flips a transfer's whole amount. It returns `{ id, scheduleId, date, payee, amount }` on the first page only, and only when `filter.filtered` is false.
- The web (`usePreviewTransactions`, `useAccountPreviewTransactions`) works in four steps:
  1. computes the same previews, filtered by `isScheduleRelevantToAccount`;
  2. runs `rules-run` on each, sets the status as category and gives children `preview/<id>` ids;
  3. sorts with `comparePreviewTransactions`;
  4. applies `inverseBasedOnAccount`, which shows a row as-is when it is this account's, and otherwise each line (or the plain row) whose payee transfers in, inverted.

  The web hides previews whenever the register is filtered.
- `registerFilter` builds SQL over the aliases `t`, `a`, `p`, `c` and `ta`. Its search also matches split children through a subquery on `v_transactions_internal_alive`.
- `readLimit` reads synced preferences listed in `LIMITS` (whole numbers within a ceiling, else the default). sc-4643 edits that list.

## Goals / Non-Goals

**Goals:** upcoming rows equal what will post, in every filtered view where the posted row would match; one rule engine, one filter predicate.

**Non-Goals:** projected running balances; web parity while filtered; schedule editing; an MCP tool (sc-5098).

## Decisions

### D1. One engine: move the relevance and inversion functions to loot-core

`isScheduleRelevantToAccount`, `inverseBasedOnAccount` and `comparePreviewTransactions` are pure. Their bodies move verbatim to `packages/loot-core/src/shared/schedules.ts` (or a sibling module) with their tests. The desktop-client hooks change only their imports, with no change in web behaviour. The web-only steps stay in the hooks: the status shown as the category, and the `preview/<id>` child ids. The native read then runs the web's steps server-side, in the same call:
- preview, then `runRules` (the function behind `rules-run`) on each row;
- sort with `comparePreviewTransactions`;
- `inverseBasedOnAccount` for the account.

The functions' callbacks (`getTransferAccountByPayee`, `getPayeeByTransferAccount`) are built from one payees and accounts read.

Alternative rejected: a native copy of the web logic, in TypeScript or Swift. That is a second engine, which the Product Owner ruled out.

### D2. What an upcoming row is

An upcoming row is a top-level row as `inverseBasedOnAccount` returns it for this account:
- the schedule's own row when its account is this one, a split showing `splitCount` with its lines;
- an inverted row for a transfer into this account, or for each split line that transfers into it.

An inverted row's amount is the negated line amount, its payee is the transfer payee of the schedule's account, and `transferAccount` names that account. A row carries the following fields:
- `id` (`preview/<schedule>/<date>`, `preview/` plus the line id for an inverted line) and `scheduleId`;
- `date`, `payee`, `category` and `categoryId`;
- `notes`, `amount` (signed for this account), `cleared` (false unless a rule sets it);
- `splitCount`, `transferAccount`;
- `status`: `due`, `upcoming` or `missed`, from the statuses `getStatus` gives.

- `ruleFields`: the names, from the fixed set payee, category, amount, notes, date, cleared and splits, of the fields whose value after `runRules` differs from the preview before it. Each comparison is a value comparison, done in loot-core.

`runningBalance` stays null. Ids are stable between reads, and a fixture asserts their format so Swift row identity holds (Architect review, PR #436, nit 3).

### D3. Filtering with the posted rows' predicate

`registerFilter` gains a source name for its child subquery. The upcoming read (D7) builds a CTE, `upcoming(id, account, date, payee, category, notes, amount, cleared, is_parent, is_child, parent_id, transfer_id)`, from the D2 rows and their lines. The rows are passed as **one JSON parameter** and read with `json_each(?)` (`json_extract(value, '$.id')`, and so on), as the codebase already does elsewhere. Bound `VALUES` was rejected because it needs about 12 variables per row: even under the row cap of D8 (ceiling 500, each with its split lines), the rows would pass SQLite's variable limit on older builds (999). A test filters more rows than that (Architect review, finding 1). It joins `accounts a`, `payees p`, `categories c` and `accounts ta` as the posted query does, and applies the same `filter.sql` with the CTE as the source. So `uncleared`, `uncategorized` (with its split-parent, off-budget and on-budget-transfer exemptions) and search (payee, category, notes, amount, a matching line returning its row) mean exactly what they mean for posted rows.

Alternative rejected: a TEMP table, which writes during a read; or a TypeScript twin of the search, which is a second predicate.

### D4. Paging, count and total

Upcoming rows are never part of the register read or its keyset (D7), so cursors and pages are unchanged. `native/account-upcoming` returns `upcoming` with the matching rows, `upcomingCount` (their number, an inverted line counting as one row) and `upcomingTotal` (loot-core's sum of their amounts). `resultCount` and `resultTotal` keep counting posted rows only. Swift shows the numbers as given and adds no amounts.

### D5. Horizon

The window stays the budget's `upcomingScheduledTransactionLength` preference (default 7 days) and each schedule's `custom_upcoming_length`, as on the web. It is capped by `accounts-register-upcoming-max-days` in `LIMITS` (default 92, ceiling 366). Rows dated after today plus the cap are dropped before rules run. A missing or bad value falls back to 92. No refusal is added. When the cap dropped any row, the upcoming read returns `upcomingCapDays`, and the register shows "Scheduled rows shown up to N days; change this in Settings > Limits." The web equality holds only within the cap.

The limit is listed in native Settings' Limits section with the label "Scheduled rows: days ahead" and text saying it caps the budget's upcoming length. That section is story 4643's: it lists every entry in `LIMITS`, so this change adds the entry and its label, and depends on 4643 for the screen (Product Owner review, item 1).

### D5a. Tapping an upcoming row

A tap opens a native read-only detail: date, payee, category, amount, account, "Scheduled" in words, and "Fields set by rules: …" from `ruleFields` when it is not empty. There is no edit and no web hand-off, so the closed hand-off set is unchanged; schedule editing is story 4617 (Product Owner review, item 2).

### D6. Perf gates (amended 2026-11-18, see D7 to D10)

`accounts.perf.test.ts` keeps its seed: 200 schedules on the 20,000-row account at the default horizon (20 with split actions, 10 of them with a line into the account; 20 transfers into it; 5 daily), and a worst case of 50 daily schedules across the 92-day cap. Each case runs with no filter, with search and with scope `uncleared`.
- `native/account-register` first page: median at most **50 ms** with every schedule seed loaded. It does no schedule work, so the seeds only prove that.
- `native/account-upcoming`: median at most **100 ms** with the 200 schedules, and at most **150 ms** in the worst case.

Why those numbers hold: the developer's phase timings were taken at load averages of 126 to 970 on 10 cores, so they are upper bounds.
- After D8, rules run for at most 100 previews; at 0.9 ms each that is 90 ms at most.
- After D9, the status query covers only the account's relevant schedules, in one query (it was 110 to 130 ms for an `$or` over all 200).
- The `json_each` filter measured about 4 ms.
- The worst case adds only the preview loop over about 4,600 dates, because D8 cuts before rules.

Stop and report still applies. Measure on a quiet machine, with the load average below the core count, and print the load with the results. If a median misses its gate, the developer may lower the default of `accounts-upcoming-max-rows` to the largest value that meets it, down to 25, without asking first. Any default below 100 is reported to the Product Owner before merging, with the medians, p95s and load, because fewer rows changes what a person sees. Below 25, stop and report to the Director. Never loosen a gate.

### D7. Upcoming rows are their own read

The developer stopped at the gate (2026-11-18). Inside the register read, 200 schedules took a 472 ms median and the worst case 7,059 ms; the gate is 50 ms. The cost was:
- `runRules` at about 0.9 ms per row: schedule rules land in the rules indexer's catch-all bucket, so each row ranks every rule;
- `getHasTransactionsQuery` at 110 to 130 ms;
- posted rows at 15 to 40 ms;
- the filter at 4 ms.

No cap gets 200 schedules under 50 ms inside the register read, so the upcoming rows leave it.

`native/account-upcoming {account_id, scope, search}` is a new read-only handler. Swift calls it after the register's first page, and again on a scope, search or change event. Upcoming rows are already a separate section, so the register appears at once and the section fills in ("Loading scheduled…"). A reply for an older request (scope, search, account, or a write since) is dropped by a request counter in the view model.
- **In flight:** the section shows "Loading scheduled…".
- **Failure:** the posted rows stay usable, and the section shows "Couldn't load scheduled rows. Try again." with Retry, which re-reads the upcoming section only. The copy goes in the screen's copy table.
- **After a write:** a native write or change event that changes posted rows or schedules bumps the counter and re-runs the upcoming read. The section shows the loading state until the new reply, so upcoming rows read before a write never sit beside posted rows read after it.

The web has the same cost today and the same shape: the page computes statuses (`useCachedSchedules`, with `getHasTransactionsQuery` over every schedule) and sends one `rules-run` per preview after the transactions load, and the register renders before the previews arrive. So this matches the web rather than departing from it.

The handler joins the allowlist (Swift list, page list, `coverage.json` skip). The `native-accounts-screen` change (story 3611) still says the first page adds "upcoming schedules" and that no other accounts handler joins the allowlist. Archive that change first, as the Product Owner sequenced; this change's archive then turns "Upcoming rows are their own read" into MODIFIED deltas of "A register page is one read with a keyset cursor" and "The accounts handlers are allowlisted" (task 3.1).

### D8. A row cap before rules run

`accounts-upcoming-max-rows` (in `LIMITS`, default 100, ceiling 500) keeps previews of the schedules relevant to the account in rounds: every schedule's next occurrence first, then every schedule's second, and so on. Each round is in `comparePreviewTransactions` order, so a few weekly schedules cannot crowd a monthly bill off the list (Architect review, PR #445). The rows returned are then shown in the web's order. The cap is applied after the day cap and before rules run. Rules, inversion, the filter, the count and the total see only those. Every row shown has had its rules run, so "as they will post" holds for every shown row.

When the cap drops previews, the read returns:
- `upcomingAll`: all previews in the window, counted without running rules;
- `upcomingMore`: the number dropped.

The register labels the count and total as partial ("Nearest K of M scheduled", the total labelled as the nearest rows' total), so a capped total is never read as the whole (Product Owner review, PR #445). It also says "N more scheduled rows not shown or searched; change this in Settings > Limits." `upcomingCount` and `upcomingTotal` cover returned rows only. Rows past the cap are not searched, because searching them would mean running their rules.

### D9. Statuses in one query, for relevant schedules only

Relevance (`isScheduleRelevantToAccount`) needs no status, so it runs first. Statuses are then worked out only for the relevant schedules. "Has a transaction in its occurrence window" becomes one query: `SELECT schedule, MAX(date) FROM v_transactions_internal_alive WHERE schedule IN (SELECT value FROM json_each(?)) GROUP BY schedule`. A schedule has one when its latest date is on or after `getScheduleOccurrenceMatchStartDate(schedule, next_date)`, which is exactly what the `$or` asks. A test checks that both give the same set on a fixture with split children (a schedule paid by a child row), a tombstoned matching row and a schedule on a closed account. The web keeps its query; this is a server-side form of the same predicate, not a second rule.

### D10. Options not taken

- **Lazy rules after filtering:** the filter needs post-rule payee, category and notes. Filtering before rules would show rows the rules move out of a view and hide rows they move in. D8's cap does the bounding instead.
- **A per-schedule preview cache:** correct invalidation needs every rule, payee, category and schedule change plus date roll-over. It is complex, and a stale entry would show wrong money. Revisit only if D8 is not enough.
- **Fixing the catch-all bucket:** that is an upstream rules-engine change that would affect every rule run in the app and widen the fork's divergence from upstream for a fork-only screen. Not taken.

### D11. Answers to the developer's questions

- **A split schedule's parent row has payee null:** intended. `runRules` with split actions leaves the parent without a payee, the web preview shows the same, and so does the posted split. The row shows "Split (n)" as posted split parents do.
- **A formula on the payee field does nothing:** right. The rules engine does not apply formulas to `payee`. Relevance still treats a formula or template line as maybe relevant. The spec scenario now uses a template action, as the test does.
- **No label field in `LIMITS`:** both limits join story 4643's registry with a name and help line when it lands:
  - `accounts-register-upcoming-max-days`: "Scheduled rows: days ahead", help "Caps the budget's upcoming scheduled length in the native register."
  - `accounts-upcoming-max-rows`: "Scheduled rows: most shown", help "The most scheduled rows the native register shows and searches."

  Until then they stay code comments beside the entries. Whichever of the two merges second adds them (task 2.4).

## Risks / Trade-offs

- [Rules run on every upcoming read] → Bounded by the row cap, outside the register read; the upcoming gate measures it.
- [A capped search misses a later match] → The notice says the rows past the cap are not searched, and the cap is editable up to 500.
- [Moving web functions touches upstream files] → Approved by the Product Owner (decision 5); moved with their tests, and web behaviour is unchanged.
- [The cap differs from the web when a user's window exceeds it] → The default 92 days covers every preset (at most a month); a custom length such as `6-month` is cut at the cap, which is editable up to 366 days.

## Migration Plan

No data migration. Swift decodes the new fields as optional, so a build against an older loot-core still works.
