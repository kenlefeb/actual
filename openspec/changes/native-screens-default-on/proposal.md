# Proposal

## Why

Story sc-5090, epic 470. Ken decided on 2026-11-15 that a native screen that ships is on by default. The Budget and Paychecks switches still read off when never set, so a fresh install or an untouched device shows the web screens until the user finds Settings.

## What Changes

- The `NativeScreen.budget` and `NativeScreen.paychecks` switches read on when unset, in the app (`NativeScreenSwitch.swift`) and on the page (`isNativeScreenOn`). An explicit off is kept.
- One file, `desktop-client/src/data/native-screen-defaults.json`, lists every switch's unset default. A page test and a Swift test both read it, so the two cannot drift.
- Accounts stays off when unset until story 3611; Reconcile already reads on.
- Existing installs that never touched the switch see the native screens after updating. That is intended. The release note says how to turn them off in Settings.

## Capabilities

### Modified Capabilities

- `native-budget-screen`: the switch defaults to on.

## Impact

- `NativeScreenSwitch.swift`, `nativeChrome.ts`, `NativeScreens.tsx` and their tests. No bridge, loot-core or data change.
- The web fallback is unchanged: Settings turns a screen off, and a failed first read still shows the screen's error state with a retry.
