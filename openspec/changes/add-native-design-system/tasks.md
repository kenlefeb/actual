# Tasks

Test-first: write the tests, run them and see them fail before writing the code. Each group ships in its own PR. Each group heading names its story.

## 1. Native theme (sc-3505)

- [x] 1.1 Add a failing unit test for a native-shell check (`isNativeShell()` in `packages/desktop-client`): true in Capacitor's native platform and in Electron, false in a browser. Verify: the test fails.
- [x] 1.2 Implement the check, then add `home-economics-light.css` and `home-economics-dark.css` in `packages/component-library/src/themes/`. They set every `--color-*` that `theme.ts` reads, plus `--font-family` (system font), using the values in `DESIGN.native.md` §3. Verify: 1.1 passes.
- [x] 1.3 Extend `contrast.web.test.ts` to both new files. Run it first against placeholder values and see it fail, then with the final values. Verify: it passes at 4.5:1 for text and amount pairs.
- [x] 1.4 Add a failing test for `ThemeStyle` covering three cases: in a native shell it renders the Home Economics sheets with a `prefers-color-scheme` switch; in a browser it renders upstream's sheets; and in a native shell the theme pref is ignored. Then implement the guarded branch in `packages/desktop-client/src/style/theme.tsx`. Verify: the test passes, and existing theme tests are unchanged.
- [x] 1.5 Hide the theme setting in Settings when in a native shell, with a test for the desktop Settings page and the mobile Settings screen. Verify: tests pass, and the browser's Settings still shows the setting.
- [ ] 1.6 Mac app: launch an Electron dev build in light and dark. Verify: the screenshots of the budget page are attached to the story, and `yarn vrt` for the browser is unchanged.

## 2. iPhone native chrome (sc-3514)

- [x] 2.1 Choose how to build the native tab bar as the app's root (ADR 11): a plugin or a small local Swift plugin whose tabs can each host either the shared WebView or a native view controller. A plugin that only draws a tab bar over one WebView doesn't qualify. Record the choice and its review by the Security Analyst. Verify: there is a comment on the story.
- [x] 2.2 Add a failing test that `MobileNavTabs` renders nothing when the native tab bar is present, and still renders in a phone browser. Then implement the root: one shared WebView (one engine) moves into whichever tab shows a web screen, tab selection drives the router, a tab can be marked as native (no native screen ships in this group), and the Add button opens the new-transaction screen. Verify: the tests pass, and in the iOS Simulator only one WebView exists after visiting every tab.
- [x] 2.3 Add haptics on saving a transaction and on moving money (a no-op outside the iOS app), with unit tests for the call sites. Verify: the tests pass.
- [x] 2.4 Make the status bar follow the appearance and use system keyboard behaviour (decimal keypad for amounts). Verify in the iOS Simulator: the screenshots are attached.
- [ ] 2.5 Add the scenarios "Switching sections on iPhone" and "Adding a transaction on iPhone" as a TestFlight acceptance checklist for Ken. Verify: Ken's result is recorded on the story.

## 3. Mac window chrome (sc-3523)

- [ ] 3.1 Add a failing test for the window options builder in `packages/desktop-electron`: inset title bar and sidebar material on macOS, unchanged on other platforms. Then implement it. Verify: the test passes.
- [ ] 3.2 Make the window title follow the current view, with a test covering Budget, Accounts and Reports. Verify: the tests pass.
- [ ] 3.3 Add a menu bar with the main commands and their shortcuts, including New Transaction, with a test of the menu template. Verify: the test passes, and a manual check of the shortcut in a dev build is recorded on the story.

## 4. App icon and wordmark (sc-3532)

- [ ] 4.1 Build the direction-A icon in Icon Composer: an accent background with the jar and coins as foreground layers. Export it for iOS (`packages/mobile-client/ios`) and macOS (`packages/desktop-electron`). Verify: the Simulator and Dock screenshots, in default, dark and tinted styles, are attached.
- [ ] 4.2 Set the display name "Home Economics" for the Mac build, matching iOS's `CFBundleDisplayName`. Verify: the menu bar and the Dock show it.
- [ ] 4.3 Add the wordmark asset (SF Pro Rounded Semibold, converted to outlines) for the sign-in screen in the native apps only. Verify: Simulator and Mac screenshots, and the browser sign-in screen is unchanged.

## 5. Dynamic Type on iPhone (sc-3564)

- [ ] 5.1 On iPhone, map body text to the `-apple-system-*` keywords so Dynamic Type applies, and stop amounts from truncating in the mobile budget rows (`packages/desktop-client/src/components/mobile/budget/`). Verify, in the iOS Simulator at the default size and at the largest accessibility size, in light and dark: the screenshots are attached to the story.

## 6. Back goes up one level (sc-3736)

- [ ] 6.1 Add failing tests for `MobileBackButton`: in the iOS app it goes to the page's declared parent route and never calls `navigate(-1)` or changes the tab; on a tab root it renders nothing; in a phone browser it still goes back in history. Verify: the tests fail.
- [ ] 6.2 Change the shared `MobileBackButton` default and declare a parent route for each mobile page under `packages/desktop-client/src/components/mobile/` (account to accounts, category to budget, a schedule to Schedules, Schedules to Settings, business calendars to Settings). Verify: the tests pass, and a deep-linked or restored page goes to its parent.
- [ ] 6.3 Add the "Back goes up one level" scenarios to the TestFlight acceptance checklist for Ken. Verify: Ken's result is recorded on the story.

## 7. iPhone landscape keeps the phone layout (sc-3706)

- [x] 7.1 Add a failing test that the layout choice returns the phone layout in the iOS app on iPhone at landscape widths, and the wide layout on iPad and in a phone browser. Verify: the test fails.
- [x] 7.2 Implement the check beside the native-shell detection, so no wide-layout chrome (sidebar, privacy-mode top bar) shows on iPhone. Verify: the test passes, and rotating in the iOS Simulator keeps the screen and selected tab, with Schedules reachable from Settings in both orientations; screenshots are attached to the story.
