# Tasks

Test-first: write each test, run it and see it fail before writing the code. One story, one PR per group. Group 1 comes first, and its spike decides whether groups 2 and 3 go ahead as written. Groups 2 and 3 follow the Figma page "Budget — Mac" (file `2Ts4fUoFzCWfvubD9vgTWx`, node 62-2), which is drawn; sc-4954 is done.

## 1. App shell, engine host and web onboarding, which is also the spike (sc-4942)

- [ ] 1.1 Create `packages/mobile-client/macos/HomeEconomicsMac.xcodeproj`. It has a SwiftUI app target `app.homeeconomics.budget.mac` (macOS 14, development signing, entitlements `app-sandbox` and `network.client` only), a unit test target, a local package dependency on `../ios/NativeBridge`, and a copy phase that bundles the staged `www` and skips it when missing. Verify: it builds unsigned with `xcodebuild ... CODE_SIGNING_ALLOWED=NO` with and without `www`.
- [ ] 1.2 Add failing unit tests for the scheme handler:
  - serves files from `www` with the right MIME type and COOP/COEP headers;
  - refuses `..` paths, absolute paths, and hosts other than `localhost`;
  - returns 404 for missing files.

  Then implement it. Verify: the tests pass.
- [ ] 1.3 Add failing vitest tests in `packages/desktop-client` for the page:
  - `nativeShell()` recognizes the `HomeEconomicsMac/` user agent as the SwiftUI Mac shell, distinct from Electron's `'mac'`;
  - the backend starts with `forceDirectWorker` there;
  - Safari, Chrome and Electron UAs are unchanged.

  Then implement it. Verify: the tests pass.
- [ ] 1.4 Implement `MacEngineHost`: the web view in the main window's bottom layer with `applicationNameForUserAgent`, the `actualNativeBridge` message handler gated by `PageOriginGuard` on `homeeconomics://localhost`, `NativeBridgeClient` over `PageCall`, and the navigation delegate (in-frame only the sync server and the OpenID provider; other links open in the browser). Write a failing Swift test first: the origin guard accepts that origin and refuses the provider's host, the server's web app and a subframe. Verify: the test passes.
- [ ] 1.5 Keep the engine alive. Closing the window orders it out without terminating; reopening from the Dock shows the same web view. Re-read hooks fire on `didBecomeActive` and `didWake` and never while inactive. Test the lifecycle logic with fakes, failing first. Verify: the tests pass.
- [ ] 1.6 Add a Debug-menu item, in Debug builds only, that calls `native/budget-month` for the current month and shows the result size and time.
- [ ] 1.7 **Spike exit criteria.** Run on Ken's Mac or a team Mac against staging and record each result on sc-4942. All must pass before group 2 starts.
  1. The engine starts. Either `crossOriginIsolated` and `SharedArrayBuffer` are present, or the documented override fallback runs in the direct Worker. Relaunching keeps the downloaded budget.
  2. OpenID sign-in through staging's Auth0 completes and returns to `homeeconomics://localhost/openid-cb`.
  3. An envelope budget, a tracking budget and an end-to-end encrypted budget each download and open. The encrypted one asks for its password.
  4. The 1.6 bridge call succeeds within the iPhone latency gate, also after the window was closed for 10 minutes and after a sleep and wake.
  5. With the Electron app open on the same budget, both sync a change and neither touches the other's files.
- [ ] 1.8 If criterion 1 fails without a safe override, stop. Record the evidence, and ask the PO (through the Director) to re-plan sc-4942 onto the `packages/api` browser-worker bundle with a new page bridge and native onboarding (about 1 to 1.5 person-weeks more). If criterion 2 fails, propose moving `ASWebAuthenticationSession` sign-in into sc-4942 the same way.
- [ ] 1.9 Add `.github/workflows/fork-mac-native.yml`: on PRs touching `packages/mobile-client/macos/**` or `packages/mobile-client/ios/NativeBridge/**`, build and test unsigned on `macos-26` with no secrets. Verify: the job runs green on this PR and fails when a test is broken on purpose (then reverted).
- [ ] 1.10 Run `yarn check:native-swift` with a temporary `import SQLite3` in a Mac Swift file. Verify: it fails and names the file, then passes once the line is removed.
- [ ] 1.11 Security Analyst review of the sign-in and sync-download path. Confirm `isValidRedirectUrl` is unchanged, the origin guard covers the scheme, and the scheme handler can't serve files outside `www`. Record the review on the PR.

## 2. Native Budget window, read-only (sc-4951)

- [ ] 2.1 Add failing Swift tests on `BudgetViewModel` (with Mac-only additions, if any, in the Mac target) for a 1 to 3 month window:
  - one `native/budget-month` read per newly shown month;
  - Command-Left and Command-Right shift by one and read only the new month;
  - Command-T returns to this month;
  - no read outside the range.

  Verify: they fail first.
- [ ] 2.2 Implement the Budget window from the Figma envelope frames:
  - a dense `Table` with 24 pt rows and tabular digits;
  - groups that collapse, with totals;
  - Budgeted, Spent and Balance per month, with balance pills that carry a sign and a label;
  - a month summary with to-budget;
  - toolbar month controls;
  - the Budget menu's navigation items.

  Verify: 2.1 passes, and the numbers equal the web Budget screen's and the iPhone tab's on a seeded envelope budget.
- [ ] 2.3 Implement the tracking layout (Budgeted, Actual, Remaining; income first; the Saved summary). Verify: its numbers equal the web screen's on a seeded tracking budget.
- [ ] 2.4 Add the native-or-web switch (View menu, persisted, default native) and the error state with a retry. Test them failing first. Verify: switching shows the web Budget screen in the same window, and the choice survives a relaunch.
- [ ] 2.5 Wire the re-reads: one per burst of `cells-changed` or `sync-event`, plus on activation and on wake. Test failing first with a fake transport. Verify: a change from another device shows without a refresh.
- [ ] 2.6 Accessibility and appearance:
  - a VoiceOver table with row and column headers;
  - cell labels as in the Figma VoiceOver frame;
  - Dark Mode;
  - Increase Contrast.

  Verify with VoiceOver and Accessibility Inspector; the UX Designer reviews screenshots against the Figma frames.

## 3. Native Budget window, edits and move money (sc-4952)

- [ ] 3.1 Add a failing vitest contract test in loot-core: `budget/budget-amount`, `budget/transfer-category` and `budget/transfer-available` record an optional `undoToken` as the undo marker; `native/undo` with it undoes only that step; a web call without a token is unchanged. Implement it additively (ADR 4) and pass the token through the page bridge's validation. Verify: the tests pass.
- [ ] 3.2 Add the typed undo token to `BudgetAmountWrite` and `Transfer` in `NativeBridgeCore`, with failing Swift tests first (an empty token is refused, and the token is encoded). Verify: `swift test` passes and the allowlist test still matches.
- [ ] 3.3 Add a failing Swift arithmetic test fed by fixtures that vitest writes from loot-core's `evalArithmetic` (for example `50+25`, `*1.1`, invalid input). Then implement the parser. Verify: both sides agree on every fixture.
- [ ] 3.4 Implement inline editing of Budgeted cells:
  - Return or typing starts an edit;
  - Return saves and re-reads;
  - Tab and Shift-Tab save and move to the next or previous month;
  - Escape cancels;
  - a failed save keeps the old value and shows the error;
  - Command-Z undoes the last native edit by token.

  Test the view-model logic failing first. Verify: the web screen shows each edit, and undo restores it.
- [ ] 3.5 Implement the Move Money and Cover Overspending popover from the Figma frame:
  - it opens by clicking a balance, by Return on a selected balance, or with Shift-Command-M;
  - the amount field is pre-filled, and the destination or source popup lists overspent categories first;
  - the default button spells out the amount;
  - one undo step.

  Hide it for tracking budgets. Test failing first. Verify: balances and the summary match the web screen after a move.
- [ ] 3.6 Keyboard flow (arrow keys between cells, Space on a group) and VoiceOver announcements of the new to-budget after a change. Verify with VoiceOver; the UX Designer reviews against the menu bar, keyboard and VoiceOver frame.

## Workflow follow-up

- When sc-4952 merges, archive this change, and point sc-4942, sc-4951 and sc-4952 at the archive path.
- Then file Backlog stories for:
  - the Budget menu's bulk items (Copy Last Month, 3-Month Average, Zero);
  - copy and paste of amounts;
  - drag to move money;
  - native onboarding with `ASWebAuthenticationSession`;
  - pinning the sync server's OpenID return schemes, if Security wants it.
- sc-4953 (TestFlight for `app.homeeconomics.budget.mac`) stays its own story.
