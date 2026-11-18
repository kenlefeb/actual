# Proposal

## Why

Story sc-4973, found in the review of PR 412 (sc-4386). The native account register's upcoming scheduled rows (the `native/account-register` read) have three problems:
- They don't run the schedule's rules, so the payee, category or amount shown can differ from what will post.
- They miss split schedules whose lines transfer into the account, and invert a transfer as a whole instead of per split line.
- They disappear whenever a scope chip or search is set.

The Architect's Explore is sc-4973 comment 5089; the Product Owner's decisions are comment 5100.

## What Changes

- **Upcoming rows are what will post.** loot-core runs each preview through the schedule's rules (split actions included) with the same functions the web uses. `isScheduleRelevantToAccount` and `inverseBasedOnAccount` move from desktop-client hooks into loot-core `shared/`, and the web hook and the native read both import them. Swift does no rule logic and no money arithmetic.
- **The right rows for an account, with the right sign.** A row shows when it is the account's own, a transfer into it, or a split line that transfers into it. A transfer shows inverted per line, with the other account's name.
- **Richer rows.** Each upcoming row carries category, notes, status (due, upcoming or missed), split count and the transfer's other account, like posted rows.
- **Filters apply.** Scope chips and search filter upcoming rows with the same SQL predicate as posted rows. This goes beyond the web, which hides upcoming rows when filtered. Upcoming rows get their own `upcomingCount` and `upcomingTotal`, never mixed into `resultCount` and `resultTotal`.
- **A bounded horizon.** The window stays the budget's own upcoming-length setting (and each schedule's custom length), as on the web. It is capped by a new synced limit, `accounts-register-upcoming-max-days` (default 92, ceiling 366). That limit is listed in the Limits section of native Settings, which story 4643 builds, so this change depends on 4643. The register says when the cap hides rows. "Equals the web" holds only within the cap.
- **A read-only detail.** Tapping an upcoming row opens a native read-only detail showing "Scheduled" and which fields the schedule's rules set ("Fields set by rules: payee, category"). There is no edit; schedule editing is story 4617.
- **Upcoming rows are their own read (amended 2026-11-18).** The developer stopped at the 50 ms gate: rules and schedule statuses inside the register read took a 472 ms median for 200 schedules. Upcoming rows now come from a separate read, `native/account-upcoming`, called after the register's first page, so the register appears at once and the upcoming section fills in, as on the web. The register read does no schedule work and keeps its 50 ms gate. The upcoming read gets its own gates: 100 ms for 200 schedules, 150 ms in the worst case.
- **A row cap before rules.** A new synced limit, `accounts-upcoming-max-rows` (default 100, ceiling 500), keeps the nearest previews before rules run, so every row shown is exactly as it will post. Occurrences are generated round by round from one lazy generator shared with the web's preview, stopping at the cap, so no work is done for rows that won't be shown (design D12). The register labels a capped count and total as partial ("First 100 scheduled; more not shown") and says how to see more: raise "Scheduled rows: most shown" in Settings > Advanced > Limits, up to 500.
- **Statuses in one query** for the account's relevant schedules only, instead of an `$or` over every schedule.
- **No variable-limit failure.** Upcoming rows go to SQLite as one JSON parameter (`json_each`), not as bound `VALUES`.

Mobile scope: the native register on iPhone (`NativeAccountRegisterView`). The Mac app has no register screen yet (`add-mac-app-shell` ships the Budget window first). This change updates and tests the shared `NativeBridgeCore` view model; the Mac side lands in story 5101 (the Mac account register, with upcoming rows, filters and search on that view model). The web register (desktop and mobile web) keeps its behaviour; it only imports the moved functions from their new place.

Not in this change: an MCP read of upcoming rows (sc-5098); projected running balances on upcoming rows (they stay null); schedule editing (sc-4617).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `native-accounts-screen`: new requirements "Upcoming rows show what will post", "Upcoming rows follow scope and search", "Upcoming rows have their own count and total", "The register says when the cap hides scheduled rows", "An upcoming row opens a read-only detail", "The register does not wait for upcoming rows", "Upcoming rows refresh after a write", "Updating rows open only the read-only detail", "A capped count and total say they are partial", "The register says when the row cap hides scheduled rows" and "The cap is a labelled limit in Settings". These are ADDED only, so this change can archive after `native-accounts-screen` (sc-3611) without conflict.
- `native-bridge`: new requirements "Upcoming rows are their own read", "The upcoming read returns rows as they will post", "The upcoming read returns its count and total", "Upcoming rows name the fields rules set", "The upcoming horizon is a capped setting", "Upcoming rows are capped before rules run", "Preview dates come from one generator", "Schedule statuses cost one query" and "The reads meet their latency gates". At archive, after `native-accounts-screen`, "Upcoming rows are their own read" becomes MODIFIED deltas of that change's register-page and allowlist requirements (design D7).

## Impact

- **Code:**
  - loot-core: `packages/loot-core/src/server/native/accounts.ts` (upcoming rows, the filter source, counts); `reconcile-lock.ts` (the new limit in `LIMITS`); `packages/loot-core/src/shared/` (the moved functions); `accounts.perf.test.ts`; fixtures.
  - desktop-client: `packages/desktop-client/src/hooks/useAccountPreviewTransactions.ts` imports the moved functions.
  - Swift: `Accounts.swift`, `AccountsViewModels.swift`, `NativeAccountRegisterView.swift` and their tests.
- **No new refusal codes:** the upcoming read fails on bad arguments exactly as the register read does, and a bad limit value falls back to its default.
- **Bridge:** `native/account-upcoming` joins the allowlist (Swift list, page list, `coverage.json` skip).
- **Depends on:** story 4643 for the Limits section that shows the new limit.
- **Ordering:** a separate change from `native-accounts-screen`, so that change archives with sc-3611; this one archives after it (Product Owner decision).
- **Reviews:** Tester; Solution Architect; Security Analyst (a new allowlisted bridge handler); the Product Owner reviews intent.

## Decisions for Ken

None.
