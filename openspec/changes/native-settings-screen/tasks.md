# Tasks

**Tests first:** write the tests, see them fail, then write the code.

**Order:** one PR per group, in order.

- Group 1 blocks group 2, which blocks group 3.
- Group 4 needs groups 1 and 3.
- The archive waits for all four groups.
- The MCP tools are a separate change, `mcp-settings-tools` (sc-4643), that builds on group 1.

## 1. Engine: settings reads, the save, limits and gates (sc-4643)

- [ ] 1.1 Move `LIMITS` and `readLimit` to `server/native/limits.ts` (design D1, D11).
  - Add `server-info-timeout-seconds` (default 5, ceiling 30).
  - Add any limit from #435 or #436 that has not merged yet, so the registry matches D11's table.
  - Write failing tests first:
    - the registry equals D11's list;
    - every id has a localized name and help line;
    - no MCP server limit or grant key is in the registry.
  - The existing limit tests must stay green.
- [ ] 1.2 `native/settings` (design D1). Write failing contract tests first:
  - every preference, with and without `flags.currency`;
  - budget name and ids;
  - encryption on and off;
  - a server and a local-only budget;
  - `sync.pending` true while `messages_pending` has rows;
  - the limits equal the registry, with value, default and ceiling;
  - no network call.

  Fixture: `settings.json`.
- [ ] 1.3 `native/server-info`. Write failing tests first:
  - a reachable server;
  - an unreachable server returns `{reachable: false, version: null}` within the deadline;
  - the deadline limit uses its default for out-of-range values.
- [ ] 1.4 `native/settings-save` (design D1), as one exported engine function that every caller uses. Write failing tests first:
  - each key's closed set, compared with what web Settings stores for the same choice;
  - the upcoming length accepts the web's presets and custom values matching `^[1-9][0-9]{0,2}-(day|week|month|year)$`, stored exactly as sent;
  - it refuses `0-day`, `03-week`, `1000-day`, `3-weeks`, `3-Week`, ` 3-week`, `-1-day`, `NaN-day` and `custom`;
  - an already-stored out-of-pattern value is returned as it is and never blocks saving another key;
  - the view model sends only changed keys. A stored invalid upcoming length shows as Custom with its text, is never rewritten unless the person picks a new value, and is replaced by a valid choice;
  - limits from 1 to the ceiling, and null resets;
  - `[native:invalid-setting]` for an unknown key, a bad value, an MCP limit or grant key, or an empty change, with nothing written;
  - a two-key save with one bad key changes neither key;
  - a write failure on the second key leaves both unchanged (one batch);
  - one undo step through `native/undo`, with no changed-since check;
  - `budgetType` runs `reset-budget-cache` in the same batch.

  Add `invalid-setting` to `native-refusal-codes.json`.
- [ ] 1.5 `settings.perf.test.ts` (design D3): the stated seed, a median under 50 ms, printing the median and p95.
- [ ] 1.6 Allowlists (design D2):
  - the three names in `native-bridge-allowlist.json` and the Swift client list, with a test that the lists are equal;
  - the page's argument lists, with a test that extra fields are dropped;
  - the page adds `clientVersion`;
  - the origin-guard name for the save;
  - a test that the raw handlers in D2 are refused natively;
  - `coverage.json` skips;
  - Swift decode tests for `settings.json`.
- [ ] 1.7 Run `yarn typecheck`, `yarn lint`, the tests, `yarn check:mcp-coverage`, the perf suite and `openspec validate --all --strict`. Security reviews.

## 2. View model, switches and hand-offs (sc-4300)

- [ ] 2.1 The switch registry in `NativeScreenSwitch` (design D5).
  - One entry per shipped screen, each with its own default from its own story.
  - `NativeScreen.settings` reads off while unset, with its script entry, `.settings` in `nativeTabs`, and the Settings row in web `NativeScreens.tsx`.
  - Write failing tests first:
    - a row shows the stored value, or the screen's own default while unset (Reconcile on; Budget, Paychecks, Accounts and Add transaction as their code says today);
    - an explicit off is kept;
    - native and web write the same key.
  - Do not change any other screen's default (sc-5090, sc-3611 task 3.8, sc-3602 task 3.9).
- [ ] 2.2 `webSettingsAction` (design D6).
  - The closed action list, origin-checked, with no field read but `action`.
  - The page opens each existing web section. The native screen steps aside, then re-reads when the section closes.
  - Sign-out runs the page's sign-out with `endProviderSession: true`.
  - Write failing tests first on both sides.
- [ ] 2.3 Theme (design D7): inside the iOS app the page uses `auto` without writing the stored theme, and web Settings hides Themes. Write failing tests first.
- [ ] 2.4 `SettingsViewModel`, tested against the fake transport and fixtures (design D10). Write failing tests first:
  - a redacted first load, with the switches shown at once and an error with Retry when the read fails;
  - a local-only budget: no Sign out or Encryption row, Set up sync, and no `native/server-info` call;
  - a re-read keeps the values;
  - coalesced `preferences` and `sync` events;
  - no calls in the background;
  - a save with a token and the Undo toast, timed with an injected sleep;
  - a refusal restores the value;
  - a timeout offers Retry;
  - `native/server-info` failures show "Server unreachable" while the rest works;
  - the sign-out confirmation carries the unsynced warning and Sync now only while `sync.pending` is true;
  - sign-out drops every cached value.
- [ ] 2.5 Run the checks in 1.7 and the `NativeBridgeCore` tests.

## 3. iPhone Settings tab (sc-4300)

**Before 3.1:** the UX Designer supplies these frames in Figma file 2Ts4fUoFzCWfvubD9vgTWx (node 46-2):

- the Native screens section, with the Settings row and its footer;
- the hand-off row style ("Opens the web version");
- the This iPhone section, with the Native screens switches and the Language row;
- the local-only Sync section (text and Set up sync, no Sign out or Encryption) and the local-only About;
- the Settings loading state (redacted) and the first-read error with Retry;
- the copy table: approved (node 90:1489, story comment 5151);
- the Budget type confirmation;
- the Sign out confirmation, with and without the unsynced-changes warning and Sync now;
- About with the server unreachable and Retry;
- the Limits drill-down: name, help line, value, default, ceiling, stepper and field, Reset, and the over-ceiling message;
- AX5 layouts for About, Formatting and Limits;
- the hardware-keyboard focus appearance.

- [ ] 3.1 The tab (design D10):
  - budget card;
  - Budget, with the Formatting drill-down, Budget type, Learn categories, and Upcoming length with exactly the web's choices;
  - This iPhone, with the Native screens switches and the Language hand-off;
  - Sync, with server, encryption and Sign out, or for a local-only budget the local-only text and Set up sync;
  - Features and Data hand-off rows;
  - the loading state and the first-read error;
  - every string localized, with text from the approved copy table;
  - Advanced, with copyable ids;
  - About, with the client, app and server versions, and Notifications.

  Add the new Swift sources to `App.xcodeproj`. Verify in the Simulator against the frames, light and dark.
- [ ] 3.2 Overlay and routing: the Settings container shows native while the switch is on, `/settings` page routes open native, and hand-off sections return to it.
- [ ] 3.3 Sign out end to end in the Simulator against staging:
  - with a pending offline change, check the warning and Sync now;
  - then check that the session, keys and last budget are gone;
  - check that the switches and the local budget copy remain.
- [ ] 3.4 Hardware keyboard (design D12): Tab and arrows, Space, Return, Esc, ⌘,. Add a UI test that toggles a switch by keyboard.
- [ ] 3.5 VoiceOver labels, values, states and the hand-off hint; Dynamic Type to AX5; Dark Mode; Reduce Motion; localization. The UX Designer reviews.
- [ ] 3.6 Equal-values test: every preference set natively and in web Settings on one seed stores identical values.
- [ ] 3.7 Fork news entry for native Settings.
- [ ] 3.8 The Tester's hands-on pass in the Simulator, with notes on the story. Then flip `NativeScreen.settings` to read on when unset. Write failing tests first. This lands only after the pass.

## 4. Limits section (sc-4643)

- [ ] 4.1 The native Limits drill-down under Advanced (design D11):
  - one row per limit, with its name, help line, value, "Default N", "Up to N", a stepper and field bounded by the ceiling, and Reset;
  - a limit with no text falls back to its id.

  Write failing view-model tests first, with an injected sleep.
- [ ] 4.2 Web Settings › Advanced › Limits through the same engine function, on desktop and phone web. Write failing tests first, plus a VRT for the section.
- [ ] 4.3 A test that a limit changed on iPhone applies to the next register page, and to a running engine without a restart.

## Follow-ups

- **Story 5110:** the Mac Settings window (⌘,), with General, Budget and About on these handlers and the view model, under sc-3629 and sc-4944.
- **Story 5111:** the AI-use setting row (off, local model, bring-your-own-key) in Settings › Features.
- **`mcp-settings-tools` (sc-4643):** MCP `get_settings` and `write_update_settings`.
- **Hand-off rows:** each becomes native under sc-4621 and sc-4637 to sc-4642. iPhone backups are sc-4648.

## Workflow follow-up

- Archive when group 4 merges. Then move both stories' change links to the archive path, add the `spec:native-settings-screen` label, and add the spec to epic 470's description.
