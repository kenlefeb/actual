# Proposal

## Why

Shortcut sc-3742, for sc-3593 (native Budget screen on iPhone). ADR 11 (`docs/adr/0011-native-ui-without-upstream-parity.md`) migrates iPhone screens to SwiftUI one at a time over the one loot-core. Budget is first: it is the daily screen and the one that proves the bridge (`native-bridge`, sc-3584) pays off. The `native-bridge` change specifies the bridge, not a screen, and leaves each screen story to add the write handlers it needs. This change gives the screen its own capability, so the nine slices of sc-3593 (sc-3751, sc-3760, sc-3769, sc-3778, sc-3787, sc-3796, sc-3805, sc-3814, sc-3823) have requirements and scenarios to meet.

## What Changes

- **New capability `native-budget-screen`**, one requirement per slice: the per-screen switch and web fallback; month navigation; editing a budgeted amount; tracking budgets; moving money; change-event and foreground re-reads; a real `sync-event` on a device; Dynamic Type, Dark Mode and VoiceOver; the 300-category target. Scenarios come from sc-3593's acceptance.
- **Delta to `native-bridge`.** The allowlist gains the write handlers this screen uses: `budget/budget-amount` (envelope and tracking: the handler picks the table from the budget type), `budget/transfer-category` and `budget/transfer-available`. Each keeps the refused-name scenario. The bridge client also has to carry typed arguments (numbers), because today it passes strings only.
- **No new loot-core handlers.** Every write reuses an existing handler the web screen already calls, so the web numbers and the native screen cannot diverge.

Out of scope: writing any Swift or app code in this change (the slices do that), budget templates, goals and other long-tail budget screens (they stay web), covering overspending and other flows beyond a plain move, the Mac SwiftUI app, Android and desktop.

## Capabilities

### New Capabilities

- `native-budget-screen`: the SwiftUI Budget tab on iPhone, in envelope and tracking modes.

### Modified Capabilities

- `native-bridge`: adds write handlers to the allowlist. (The capability's spec lives in the still-open change `native-bridge`; this delta is written against it and applies once that change is archived.)

## Mobile scope

This change is the mobile screen: the iPhone Budget tab, in `packages/mobile-client/ios/` and the platform-free `NativeBridgeCore` package. Desktop, the browser, Android and the Mac app keep the web Budget screen unchanged. ADR 11 sets native screens as Apple-only with no upstream parity (Ken, 2026-11-11), which is the recorded exception to the desktop-and-mobile rule for this work.

## Decisions for Ken

None. The decisions are the Architect's, in `design.md`.
