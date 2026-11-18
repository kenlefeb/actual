# Tasks

**Tests first:** write the tests, see them fail, then write the code.

**Order:** one PR per group, in order.

- Group 1 blocks groups 2 and 3.
- Group 3 blocks group 4.
- Group 5 needs groups 1 and 4.

## 1. Engine: settings reads, the save, limits and gates (sc-4643)

- [ ] 1.1 Move `LIMITS` and `readLimit` to `server/native/limits.ts` (design D1).
  - Add `server-info-timeout-seconds`, default 5 and ceiling 30.
  - Add `payee-picker-max-results` and `transaction-split-max-children` if sc-3602 has not merged yet.
  - The existing limit tests must stay green.
- [ ] 1.2 `native/settings` (design D1). Write failing contract tests first:
  - every preference, with and without `flags.currency`;
  - budget name and ids;
  - encryption on and off;
  - a server and a local-only budget;
  - every limit with value, default and ceiling;
  - no network call.

  Fixture: `settings.json`.
- [ ] 1.3 `native/server-info`. Write failing tests first:
  - a reachable server;
  - an unreachable server returns `{reachable: false, version: null}` within the deadline;
  - the deadline limit uses its default for values out of range.
- [ ] 1.4 `native/settings-save` (design D1). Write failing tests first:
  - each key's closed set, compared with what web Settings stores for the same choice;
  - limits from 1 to the ceiling, and null resets;
  - `[native:invalid-setting]` for an unknown key, a bad value or an empty change, with nothing written;
  - one undo step through `native/undo` with no changed-since check;
  - `budgetType` runs `reset-budget-cache` in the same call.

  Add `invalid-setting` to `native-refusal-codes.json`.
- [ ] 1.5 `settings.perf.test.ts` (design D3): the stated seed, a median under 50 ms, printing the median and p95.
- [ ] 1.6 Allowlists (design D2):
  - the three names in `native-bridge-allowlist.json` and the Swift client list, with a test that the lists are equal;
  - the page's argument lists, with a test that extra fields are dropped;
  - the page adds `clientVersion`;
  - the origin-guard name for the save;
  - a test that the raw handlers listed in D2 are refused natively;
  - `coverage.json` lines;
  - Swift decode tests for `settings.json`.
- [ ] 1.7 Run `yarn typecheck`, `yarn lint`, the tests, `yarn check:mcp-coverage`, the perf suite and `openspec validate --all --strict`. Security reviews.

## 2. MCP settings tools (sc-4643)

- [ ] 2.1 `get_settings` (`budget:read`) and `write_update_settings` (`settings:write`) through the group 1 handlers' validation. Add the `settings:write` scope to `grants.ts` and to the grants schema. Write failing tests first:
  - refused by scope without `settings:write`, and audit-logged;
  - an out-of-range limit refused, naming its ceiling;
  - reset to the default;
  - the audit line for each write;
  - a wildcard-client grant cannot hold `settings:write`.
- [ ] 2.2 The `coverage.json` entries and tool descriptions that name their scopes. Security reviews the scope.

## 3. View model, switches and hand-offs (sc-4300)

- [ ] 3.1 The switch registry in `NativeScreenSwitch` (design D5):
  - one entry per shipped screen (Budget, Paychecks, Reconcile, Accounts and Add transaction as their stories ship);
  - `NativeScreen.settings` reading off while unset, its script entry, `.settings` in `nativeTabs`, and the Settings row in web `NativeScreens.tsx`.

  Write failing tests first:
  - unset reads as the registry's default;
  - an explicit off is kept;
  - native and web write the same key.

  Do not change the Budget, Paychecks, Accounts or Add transaction defaults (sc-5090, sc-3611 task 3.8, sc-3602 task 3.9).
- [ ] 3.2 `webSettingsAction` (design D6): the closed action list, origin-checked, and the page opening each existing web section. The native screen steps aside and re-reads when the section closes. Sign-out runs the page's sign-out with `endProviderSession: true`. Write failing tests first on both sides.
- [ ] 3.3 Theme (design D7): inside the iOS app, the page uses `auto` without writing the stored theme, and web Settings hides Themes. Write failing tests first.
- [ ] 3.4 `SettingsViewModel` against the fake transport and fixtures (design D10). Write failing tests first:
  - a redacted first load;
  - a re-read keeps the values;
  - coalesced `preferences` and `sync` events;
  - no calls in the background;
  - a save with a token and the Undo toast, timed with an injected sleep;
  - a refusal restores the value;
  - a timeout offers Retry;
  - `native/server-info` failures show "Server unreachable" while the rest works;
  - sign-out drops cached values.
- [ ] 3.5 Run the checks in 1.7 and the `NativeBridgeCore` tests.

## 4. iPhone Settings tab (sc-4300)

**Before 4.1:** the UX Designer supplies, in Figma file 2Ts4fUoFzCWfvubD9vgTWx (node 46-2):

- the Native screens section with the Settings row and its explanatory footer;
- the hand-off row style ("Opens in the web view");
- the Budget type confirmation;
- the Sign out confirmation;
- About with the server unreachable and Retry;
- the Limits drill-down (value, default, stepper and field, Reset, the over-ceiling message);
- AX5 layouts for About and Formatting;
- the hardware-keyboard focus appearance.

- [ ] 4.1 The tab (design D10):
  - the budget card;
  - Budget with the Formatting drill-down, Budget type, Learn categories and Upcoming length;
  - Native screens;
  - Sync with server, encryption and Sign out;
  - Features and Data hand-off rows;
  - Advanced with copyable ids;
  - About with the client, app and server versions and Notifications.

  Add the new Swift sources to `App.xcodeproj`. Verify in the Simulator against the frames, light and dark.
- [ ] 4.2 Overlay and routing: the Settings container shows native while the switch is on. `/settings` page routes open native, and hand-off sections return to it.
- [ ] 4.3 Sign out end to end in the Simulator against staging. Check that the session, keys and last budget are gone and that the switches are kept.
- [ ] 4.4 Hardware keyboard (design D12): Tab and arrows, Space, Return, Esc, ⌘,. Add a UI test that toggles a switch by keyboard.
- [ ] 4.5 VoiceOver labels, values and states, and the hand-off hint. Dynamic Type to AX5, Dark Mode, Reduce Motion and localization. The UX Designer reviews.
- [ ] 4.6 Equal-values test: every preference set natively and in web Settings on one seed stores identical values.
- [ ] 4.7 A fork news entry for native Settings.
- [ ] 4.8 The Tester's hands-on pass in the Simulator, with notes on the story. Then flip `NativeScreen.settings` to read on when unset. Write failing tests first. This lands only after the pass.

## 5. Limits section (sc-4643)

- [ ] 5.1 The native Limits drill-down under Advanced (design D11): one row per limit, with value, default, stepper and field bounded by the ceiling, and Reset. Labels come from a localized table with the id as fallback. Write failing view-model tests first, using an injected sleep.
- [ ] 5.2 Web Settings › Advanced › Limits through the same handler, on desktop and phone web. Write failing tests first. Also add a VRT for the section.
- [ ] 5.3 A test that a limit changed on iPhone applies to the next register page and to MCP `get_settings`.

## Follow-ups

- **Mac Settings window (⌘,)** with General, Budget and About on these handlers and the view model, under sc-3629 and sc-4944. The Product Owner is to file it as a related story.
- **AI-use setting** (off, local model, bring-your-own-key) in Settings › Features. No AI setting exists yet. The Product Owner is to file a placeholder story.
- **Each hand-off row** becomes native under sc-4621 and sc-4637 to sc-4642. iPhone backups are sc-4648.

## Workflow follow-up

- Archive when the last group merges. Then:
  - move both stories' change links to the archive path;
  - add the `spec:native-settings-screen` label;
  - add the spec to epic 470's description.
