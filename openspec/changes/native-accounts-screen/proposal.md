# Proposal

## Why

Stories sc-4386 (batched reads), sc-4931 (writes, switch, view models) and sc-3611 (SwiftUI screens), epic 470. Accounts and their registers are the daily screen still drawn by the web inside the iPhone app. ADR 11 and Ken's rule (2026-11-15: native first for everything) put them next, over the one loot-core through the bridge. The reconcile flow (sc-4801, sc-4825) is native already but enters from the web Accounts page; it should enter from the native one. Design: Figma "Home Economics" native design system, Accounts page (node 25-2). Explore findings: sc-3611 comment 4929.

## What Changes

- **Group 1, sc-4386:** two batched read-only handlers, `native/accounts-list` (every account with balance, detail and section, the section totals and net worth, in one call) and `native/account-register` (one keyset page of one account's register per call, with scope, search, header and upcoming schedules), with contract fixtures and perf gates.
- **Group 2, sc-4931:** four native writes with undo tokens (`native/transactions-categorize`, `native/transactions-delete`, `native/account-reopen`, `native/account-move`); the `NativeScreen.accounts` switch, which **ships on** and is turned off in Settings; the overlay on the Accounts tab; the Swift view models.
- **Group 3, sc-3611:** the SwiftUI Accounts list, closed accounts, register, search and scope chips, swipes, category picker and empty, loading and error states, plus the reconcile entry from the native screens. Dynamic Type, Dark Mode and VoiceOver.
- **Mac:** the same screens on the same handlers once the Mac app exists (sc-3629), as native-reconcile-flow did. No work in this change until then.

Mobile scope: this change is the iPhone app's Accounts tab (the phone). The web Accounts screens (desktop and phone web) do not change, except that the web reconcile banner hides while the native Accounts screen is on. The Mac native screens wait for sc-3629 (design D9).

Not in this change: account settings, rename and close (sc-4385); the all-accounts register (sc-4387); the native add and edit transaction form (sc-3602; until it ships a row opens the web editor); add account and bank sync setup (sc-4619); bank sync on pull (sc-3899); rules (sc-4618); the schedule editor and Make recurring (sc-4617); attachments.

## Capabilities

### New Capabilities

- `native-accounts-screen`: the native Accounts list and account register on iPhone, their switch, writes, states and reconcile entry.

### Modified Capabilities

- `native-bridge`: added requirements for the accounts reads (shape, paging, latency gate) and allowlisting the new reads and writes. Additive only (design D10).

## Impact

- **loot-core:** `server/native/accounts.ts` (new), `server/native/app.ts`, fixtures, `accounts.test.ts`, `accounts.perf.test.ts`.
- **desktop-client:** `data/native-bridge-allowlist.json`, `native/nativeChrome.ts`, `components/settings/NativeScreens.tsx`, `components/mobile/accounts/NativeReconcileBanner.tsx`.
- **iOS:** `NativeBridgeCore` (switch, router, view models, allowlist), the app's Accounts screens and `NativeTabBarController`.
- **MCP:** six `coverage.json` skips.
- **Reviews:** Tester, Security Analyst (allowlist and writes), Product Owner, UX Designer against the Figma frames.
