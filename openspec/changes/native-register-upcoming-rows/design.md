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

`registerFilter` gains a source name for its child subquery. The register read builds a CTE, `upcoming(id, account, date, payee, category, notes, amount, cleared, is_parent, is_child, parent_id, transfer_id)`, from the D2 rows and their lines. The rows are passed as **one JSON parameter** and read with `json_each(?)` (`json_extract(value, '$.id')`, and so on), as the codebase already does elsewhere. Bound `VALUES` was rejected because it needs about 12 variables per row: 40 daily schedules over a 366-day cap make about 14,600 rows, far past SQLite's variable limit (32,766, or 999 on older builds). A test reads more rows than both limits (Architect review, finding 1). It joins `accounts a`, `payees p`, `categories c` and `accounts ta` as the posted query does, and applies the same `filter.sql` with the CTE as the source. So `uncleared`, `uncategorized` (with its split-parent, off-budget and on-budget-transfer exemptions) and search (payee, category, notes, amount, a matching line returning its row) mean exactly what they mean for posted rows.

Alternative rejected: a TEMP table, which writes during a read; or a TypeScript twin of the search, which is a second predicate.

### D4. Paging, count and total

Upcoming rows are a section of the first page (`cursor` null) only. They are never part of the keyset, so cursors and later pages are unchanged. The first page returns `upcoming` with the matching rows, plus `upcomingCount` (their number, an inverted line counting as one row) and `upcomingTotal` (loot-core's sum of their amounts). Both fields are present exactly when `upcoming` is, including when it is empty. `resultCount` and `resultTotal` keep counting posted rows only. Swift shows the numbers as given and adds no amounts.

### D5. Horizon

The window stays the budget's `upcomingScheduledTransactionLength` preference (default 7 days) and each schedule's `custom_upcoming_length`, as on the web. It is capped by `accounts-register-upcoming-max-days` in `LIMITS` (default 92, ceiling 366). Rows dated after today plus the cap are dropped before rules run. A missing or bad value falls back to 92. No refusal is added. When the cap dropped any row, the first page returns `upcomingCapDays`, and the register shows "Scheduled rows shown up to N days; change this in Settings > Limits." The web equality holds only within the cap.

The limit is listed in native Settings' Limits section with the label "Scheduled rows: days ahead" and text saying it caps the budget's upcoming length. That section is story 4643's: it lists every entry in `LIMITS`, so this change adds the entry and its label, and depends on 4643 for the screen (Product Owner review, item 1).

### D5a. Tapping an upcoming row

A tap opens a native read-only detail: date, payee, category, amount, account, "Scheduled" in words, and "Fields set by rules: …" from `ruleFields` when it is not empty. There is no edit and no web hand-off, so the closed hand-off set is unchanged; schedule editing is story 4617 (Product Owner review, item 2).

### D6. Perf gate

`accounts.perf.test.ts` seeds 200 schedules on the 20,000-row account at the default horizon:
- 20 with split actions, 10 of them with a line transferring into the account;
- 20 transfers into it;
- 5 daily.

The first-page cases (no search; search; `uncleared`) stay under the 50 ms median. A worst case adds 50 daily schedules across the full default cap of 92 days, about 4,600 occurrences through `runRules`, and it is held to the same gate (Architect review, finding 2).

Stop and report, as ADR 11 did: if any median, the worst case included, cannot get under 50 ms, the developer stops and reports the medians and p95s to the Director, and does not skip or loosen the gate. The remedies, decided by the Architect and the Product Owner, are a lower default cap, or a new named row-cap limit in `LIMITS` with its own default and ceiling.

## Risks / Trade-offs

- [Rules run on every first-page read] → Bounded by schedules and the horizon, not the register size; the gate measures it.
- [Moving web functions touches upstream files] → Approved by the Product Owner (decision 5); moved with their tests, and web behaviour is unchanged.
- [The cap differs from the web when a user's window exceeds it] → The default 92 days covers every preset (at most a month); a custom length such as `6-month` is cut at the cap, which is editable up to 366 days.

## Migration Plan

No data migration. Swift decodes the new fields as optional, so a build against an older loot-core still works.
