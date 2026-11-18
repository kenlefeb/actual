# Proposal

## Why

Stories sc-4300 (native Settings on iPhone) and sc-4643 (the engine read and write for settings and limits, and the Limits section), epic 470. sc-4643's MCP tools are a separate change, `mcp-settings-tools`, in its own PR, so this change can ship and archive without waiting on them.

Settings is still the web screen in the iPhone app. It is also where people turn native screens on and off and see the fork's client and server versions. ADR 11 and Ken's rule (2026-11-15: native first for everything, native screens on by default) make it next.

Ken's rule that every limit is a configurable setting is only half met: the `LIMITS` registry has defaults and ceilings, but nothing can change them.

- Explore findings: sc-4300 comment 5087. Product Owner decisions: comment 5093.
- Design: Figma "Home Economics" native design system, Settings (node 46-2).

## What Changes

- **Group 1, sc-4643:** two engine reads and one write.
  - `native/settings`: budget preferences, budget identity, encryption, server and sync state, and every limit with its name, help, default and ceiling.
  - `native/server-info`: server reachability and version, with its own deadline.
  - `native/settings-save`: validated, written in one batch (all keys and any cache reset), one undo step, last write wins. It is the one engine path every caller uses.
  - Plus the `[native:invalid-setting]` refusal code, contract fixtures, a perf gate and both allowlists.
- **Group 2, sc-4300:**
  - `SettingsViewModel`;
  - the native-screen switch rows;
  - the `NativeScreen.settings` switch;
  - the `webSettingsAction` hand-off message with its closed action list;
  - the theme rule for web screens inside the app.
- **Group 3, sc-4300:** the iPhone Settings tab:
  - budget card;
  - Formatting and Budget;
  - Native screens;
  - Sync (server address, encryption status, sign-out, with a warning and Sync now when changes are unsynced);
  - About, with the fork client, iPhone app and server versions;
  - the hand-off rows;
  - accessibility and hardware keyboard.

  It sits behind the switch until a hands-on pass, then it is on by default.
- **Group 4, sc-4643:** the Limits drill-down under Advanced, natively and in web Settings › Advanced, through the same write. Every limit has a plain-words name, what it protects, its default, ceiling and Reset.

Mobile scope:

- **iPhone app:** the Settings tab becomes native.
- **Web Settings (desktop and phone web):** gains the Limits section (group 4) and the Settings switch row (group 2). Inside the iPhone app it hides the Themes row (theme follows the system).
- **Mac:** the Mac Settings window (⌘,) is story 5110. It waits for the Mac app (sc-3629) and Mac chrome (sc-4944), on the same handlers and view model.

Not in this change:

- Each hand-off target is native later under sc-4621: sync server and encryption changes (sc-4637), users and access (sc-4638), bank sync providers (sc-4639), business calendars (sc-4640), features and experimental (sc-4641), data, export and repair (sc-4642), language and budget files.
- Backups: Mac-only (Ken, 2026-11-16). iPhone backups are sc-4648.
- An AI-use setting: none exists today. Its row is story 5111 (design D9).
- MCP `get_settings` and `write_update_settings`: change `mcp-settings-tools` (sc-4643).

## Capabilities

### New Capabilities

- `native-settings-screen`: the native iPhone Settings tab, its switches, preferences, limits, versions, sync state, sign-out, hand-offs and accessibility.

### Modified Capabilities

- `native-bridge`: added requirements for the settings reads and write, their refusal code, latency gate and allowlisting.

## Impact

- **loot-core:**
  - `server/native/settings.ts` (new);
  - the `LIMITS` registry moved to `server/native/limits.ts` and exported for reading and writing;
  - `server/native/app.ts`, fixtures, `native-refusal-codes.json`, tests, `settings.perf.test.ts`.
- **desktop-client:**
  - `data/native-bridge-allowlist.json` and `native/nativeBridge.ts` (argument lists, and the client version added by the page);
  - `native/nativeChrome.ts`;
  - `components/settings/NativeScreens.tsx` (Settings row) and `index.tsx` (Limits section, Themes hidden in the app).
- **iOS:**
  - `NativeBridgeCore` (switch registry, router, view model, allowlist, decode tests);
  - the App target's Settings screens, added to `App.xcodeproj`, and `NativeTabBarController`.
- **MCP:** `coverage.json` skips for the three native names only. The tools are in `mcp-settings-tools`.
- **AI:** nothing in this change uses AI features.
- **Reviews:** Tester, Security Analyst (allowlist, write, sign-out), Product Owner, and the UX Designer against the frames.
