# Proposal

## Why

Shortcut sc-3483. Ken (2026-11-11) wants the native "Home Economics" apps to have their own look and take full advantage of Apple's design language. The apps are the iOS app (sc-3398, a Capacitor WebView) and the Mac app (sc-3410, Electron). Today both show the browser's web UI and upstream Actual's theme. The web app keeps upstream's look.

The UX Designer's exploration on sc-3483 (comments 3492, 3499 and 3503) recommends two things. First, a native theme chosen only inside the native shells. Second, system-drawn chrome: a native tab bar on iPhone, and the native window, sidebar and menu bar on Mac. A SwiftUI rewrite is rejected, because the budget engine is JavaScript and a second app would double every feature. Ken's decisions are the Hearth Teal accent, app icon direction A (a jar of coins), and following the system light and dark appearance.

## What Changes

- **Native theme.** A new "Home Economics" light and dark theme, used only inside the iOS and Mac apps. It uses the system font, Apple's semantic colours and one accent. The appearance follows the device's light or dark setting, and there is no theme picker for Midnight or custom themes in those apps. In a browser, nothing changes.
- **Type.**
  - **iPhone:** text follows Dynamic Type.
  - **Mac:** text uses the macOS sizes.
  - **Amounts:** tabular digits, and an amount never truncates.
- **iPhone chrome.**
  - **Tab bar:** a native tab bar with Budget, Accounts, Reports and Settings, plus a separate Add button. It replaces the web tab grid inside the app only.
  - **System touches:** haptics on save and on moving money, a status bar that matches the appearance, and system keyboards.
- **Mac chrome.**
  - **Window:** an inset title bar and a system sidebar material.
  - **Menu bar:** holds the main commands with keyboard shortcuts.
  - **Window titles:** name the view, not the app.
- **Brand.** The app icon is direction A, delivered as an Icon Composer file. The wordmark is "Home Economics" in SF Pro Rounded.
- **Design rules.** The design rules live in the fork-only `DESIGN.native.md`, with one cross-link from `DESIGN.md`. Upstream's web themes and tokens are not edited.

Out of scope:
- Android (sc-3419).
- Native SwiftUI or AppKit screens.
- Widgets and Shortcuts.
- Vision receipt reading (sc-2640).
- Any change to the browser look.

## Capabilities

### New Capabilities

- `native-appearance`: how the native iOS and Mac apps look and navigate. It covers the native theme and system appearance, type and amounts, the iPhone tab bar and haptics, the Mac window and menu bar, and the app's brand. The browser stays on upstream's look.

### Modified Capabilities

None.

## Mobile scope

**iPhone.** The native theme covers every phone screen in `packages/desktop-client/src/components/mobile/`. The tab bar replaces `MobileNavTabs` inside the iOS app only.

**Mac.** The Mac app shows the desktop screens, which get the same theme. The window chrome is in `packages/desktop-electron`.

The browser, on phones and desktops alike, is unchanged. Every requirement states a scenario for both iPhone and Mac, or says which one it applies to.

## Impact

- **New, fork-only:**
  - `packages/component-library/src/themes/home-economics-light.css` and `home-economics-dark.css`;
  - a small native-shell check in `packages/desktop-client`;
  - `DESIGN.native.md`;
  - the app icon assets in `packages/mobile-client` and `packages/desktop-electron`.
- **Upstream files touched (merge cost):**
  - one guarded branch in `packages/desktop-client/src/style/theme.tsx` (`ThemeStyle`);
  - the theme setting in Settings, hidden inside the native apps;
  - `MobileNavTabs` and the mobile page layout, made inset-aware when the native tab bar is present;
  - the Electron `BrowserWindow` options and menu in `packages/desktop-electron`.
- **New dependencies:** Capacitor plugins for the tab bar, haptics, status bar and keyboard. The Security Analyst reviews them.
- **No change** to loot-core, the sync server, the API or the database.
