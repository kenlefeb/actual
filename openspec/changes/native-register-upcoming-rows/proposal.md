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
- **A bounded horizon.** The window stays the budget's own upcoming-length setting (and each schedule's custom length), as on the web. It is capped by a new synced limit, `accounts-register-upcoming-max-days` (default 92, ceiling 366).
- **The perf gate covers schedules.** The register read's 50 ms median gate must hold with 200 schedules in the seed.

Mobile scope: the native register on iPhone (`NativeAccountRegisterView`). The Mac app has no register screen yet (`add-mac-app-shell` ships the Budget window first); its future register reads the same `NativeBridgeCore` view model, which this change updates and tests, so the Mac gets the same rows without further work here. The web register (desktop and mobile web) keeps its behaviour; it only imports the moved functions from their new place.

Not in this change: an MCP read of upcoming rows (sc-5098); projected running balances on upcoming rows (they stay null); schedule editing (sc-4617).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `native-accounts-screen`: new requirements "Upcoming rows show what will post", "Upcoming rows follow scope and search" and "Upcoming rows have their own count and total". These are ADDED only, so this change can archive after `native-accounts-screen` (sc-3611) without conflict.
- `native-bridge`: new requirements "The register's upcoming rows come from loot-core", "The register returns upcoming count and total", "The upcoming horizon is a capped setting" and "The register's upcoming rows meet the latency gate".

## Impact

- **Code:**
  - loot-core: `packages/loot-core/src/server/native/accounts.ts` (upcoming rows, the filter source, counts); `reconcile-lock.ts` (the new limit in `LIMITS`); `packages/loot-core/src/shared/` (the moved functions); `accounts.perf.test.ts`; fixtures.
  - desktop-client: `packages/desktop-client/src/hooks/useAccountPreviewTransactions.ts` imports the moved functions.
  - Swift: `Accounts.swift`, `AccountsViewModels.swift`, `NativeAccountRegisterView.swift` and their tests.
- **No new refusal codes:** the read adds no refusal, and a bad horizon value falls back to the default.
- **Ordering:** a separate change from `native-accounts-screen`, so that change archives with sc-3611; this one archives after it (Product Owner decision).
- **Reviews:** Tester; Solution Architect; the Product Owner reviews intent. No Security review is needed: a read with no new input.

## Decisions for Ken

None.
