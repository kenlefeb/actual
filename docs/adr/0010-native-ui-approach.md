# 10. Native UI approach for the iOS and Mac apps

Fork-only; never upstream. **Status: Superseded** by
[ADR 11](0011-native-ui-without-upstream-parity.md) (2026-11-11: Ken dropped
upstream UI parity for the native apps and made "one loot-core, never ported"
a hard rule). Originally proposed 2026-11-11 by the Solution Architect,
sc-3579. It builds on the UX Designer's exploration on sc-3483
(comment 3492), [`DESIGN.native.md`](../../DESIGN.native.md) and the
`native-appearance` spec in `openspec/changes/add-native-design-system/`.

## Context

The fork ships "Home Economics" as two native apps:

- **iPhone:** a Capacitor 8 shell (`packages/mobile-client`, sc-3398). It
  shows the same web build in a WKWebView. The native code today is one
  49-line `AppDelegate.swift`.
- **Mac:** an Electron 43 shell (`packages/desktop-electron`, sc-3410). It
  shows the same web build in Chromium and runs loot-core in a utility
  process with `better-sqlite3`.

Ken asked whether the apps should keep the responsive web UI or rewrite the UI
entirely in native technologies (SwiftUI and AppKit, or similar). The current
plan (sc-3483) keeps the web UI and adds a native theme and native chrome.

### What the code says (measured 2026-11-11 on `development`)

Non-test TypeScript, counted with `wc -l`:

| Code                                                   | Lines   | Notes                                                                   |
| ------------------------------------------------------ | ------- | ----------------------------------------------------------------------- |
| `desktop-client/src` (941 files)                       | 173,130 | The React UI                                                            |
| of which `components/`                                 | 151,417 |                                                                         |
| of which `components/mobile/` (80 files)               | 16,827  | Phone-only screens and sheets                                           |
| of which `components/modals/`                          | 19,502  | Mostly shared by phone and desktop                                      |
| `component-library/src`                                | 14,236  | Its `View` and `Text` render `<div>` and `<span>`                       |
| `loot-core/src`                                        | 53,202  | The budget engine; `server/` alone is 38,692                            |
| `crdt/src`                                             | 737     | Sync messages and the Merkle trie                                       |
| `mobile-client` and `desktop-electron` (native shells) | 2,065   | Shell code only                                                         |
| loot-core handler registrations (`app.method(...)`)    | 240     | The API surface any non-web UI would have to call (1)                   |
| Files that branch on width (`useResponsive` etc.)      | 96      | Phone and desktop layouts are mostly the same components, not forks (2) |

(1) `grep -rE "app\.method\(" packages/loot-core/src --include='*.ts'`,
excluding `*.test.*` files: 240 calls, 210 distinct method names.
(2) `grep -rlE 'useResponsive|isNarrowWidth' packages/desktop-client/src`
over `*.ts` and `*.tsx`, excluding `*.test.*` files.

Tests: 35 Playwright e2e files (18 of them `*.mobile.test.ts`), 474 visual
regression (VRT) snapshots, and 195 unit test files in `desktop-client`.

The engine and storage are JavaScript and SQLite on every platform. In a
browser and in the iOS WebView, loot-core runs `@jlongster/sql.js` (SQLite
compiled to WebAssembly) over `absurd-sql` and IndexedDB
(`platform/server/sqlite/index.ts`). In Electron it uses `better-sqlite3`
(`index.electron.ts`). The CRDT sync (`packages/crdt`) writes the same
messages from both.

Upstream churn, from `git log --since=2026-08-13 upstream/master` (90 days):

- 350 commits in all; 189 touched `desktop-client/src` (46,016 lines added,
  11,609 removed), 27 touched `components/mobile`, and 118 touched
  `loot-core/src`.
- That is about two UI commits a day that a separate UI would have to
  re-implement by hand to stay at parity.
- The fork itself adds 34,733 lines over 328 files in `desktop-client/src`
  and `loot-core/src`, 5,694 of them in `components/mobile`. Its features
  (paychecks, business calendars, receipts) are written once, in React, and
  show on phone and desktop.

## Options

Effort is rough agent-assisted person-weeks (pw) for a first release at parity
with today's app on that platform. It excludes App Store review time.

### 1. Keep the web UI with a native theme and native chrome (current plan)

The sc-3483 plan, specified in `DESIGN.native.md`:

- Two fork-only theme files map the 239 `--color-*` tokens to Apple system
  colours plus the accent. Only `ThemeStyle` gains a guarded branch.
- The system font, which in WKWebView follows Dynamic Type through the
  `-apple-system-*` keywords.
- A native `UITabBar` on iPhone, plus haptics, status bar and keyboard
  plugins.
- On Mac: `hiddenInset` title bar, a vibrancy sidebar, a native menu bar with
  shortcuts, and window titles that name the view.

**Effort:** about 0.5–1 pw for the theme, plus 1–2 pw per platform for
chrome: **3–5 pw** in all.

### 2. Hybrid: native shell and navigation, web screens, native extras

Option 1, then:

- Native navigation: a native tab bar and navigation bars, and native sheets
  for a few high-traffic flows such as Add transaction. Every other screen
  stays web.
- Native extras the web can't do at all: WidgetKit widgets, App Intents
  (Shortcuts and Siri), and Vision receipt reading (sc-2640).

Widgets and App Intents can't run loot-core themselves:

- A widget is a separate SwiftUI process that can't host a WebView. The app
  writes a small snapshot (for example "to budget" and a few category
  balances) to an App Group container, and the widget reads it.
- An App Intent either reads that snapshot or opens the app and calls a
  loot-core handler through the Capacitor bridge.

**Effort:** option 1, plus 2–4 pw for native navigation and sheets, plus
2–3 pw per extra: **about 10–16 pw** for option 1, navigation and three
extras. Each extra ships on its own.

### 3. Full native rewrite in SwiftUI (iPhone) and SwiftUI/AppKit (Mac)

Every screen is rewritten in Swift. The engine has three variants:

- **3a. loot-core in a hidden WKWebView.** Native views call the 240 handlers
  over a message bridge. The engine stays the same and keeps JIT and
  sql.js.
- **3b. loot-core in JavaScriptCore (`JSContext`).** iOS gives in-app
  JavaScriptCore no JIT and so no WebAssembly. sql.js won't run, so loot-core
  needs a new platform layer that binds to iOS's native SQLite, and all the
  engine code runs interpreted (one benchmark showed a 7.5× slowdown with the
  JIT off). The sources for this limit are several years old: re-verify the
  JavaScriptCore WebAssembly and JIT limit against the current iOS before
  choosing 3b.
- **3c. Port loot-core and the CRDT to Swift.** A second engine.

**Effort:**

- iPhone UI at parity with `components/mobile` and the modals it uses (about
  36k lines of TSX today): **30–50 pw**.
- Mac UI at parity with the desktop app (reports, rules, schedules, imports,
  bank sync, settings and the money table): **60–100 pw**.
- Engine: 3a about 3–4 pw; 3b about 6–10 pw; 3c **40–80 pw** to port 38.7k
  lines of `server/` and get its tests passing.

### 4. A cross-platform native framework

- **4a. React Native / Expo.** React Native renders native views, not the
  DOM. None of `desktop-client` or `component-library` can be reused as is,
  because their `View` is a `<div>`, 73 files use raw DOM tags and 60 use
  `react-aria-components`. Hooks, Redux slices and the loot-core client
  calls can be shared. Expo's DOM components (`"use dom"`) can host existing
  web screens in a WebView inside a React Native app, but that is option 2
  with React Native as the shell. React Native for Windows and macOS exist
  (Microsoft), but there is no Linux target. loot-core would need a native
  SQLite binding in place of sql.js.
  **Effort:** 50–90 pw for phone and desktop UIs, plus 4–8 pw for the engine
  platform layer.
- **4b. Kotlin / Compose Multiplatform.** iOS has been stable since 1.8.0
  (May 2025). Every screen is rewritten in Kotlin, and loot-core still needs
  a JS engine on each platform or a Kotlin port (the same choice as 3).
  **Effort:** 3's UI cost plus 3b or 3c's engine cost. It has no advantage
  over 3 on Apple fidelity, and it is a language the team doesn't use.

## Comparison

| Criterion                       | 1. Web + theme + chrome                                                                                                                                    | 2. Hybrid + extras                                                            | 3. SwiftUI / AppKit rewrite                                                                                                   | 4. React Native / Compose                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| First-release effort            | 3–5 pw                                                                                                                                                     | 10–16 pw (incremental)                                                        | 90–150 pw UI, plus 3–80 pw engine                                                                                             | 55–100 pw                                                                                    |
| Ongoing and upstream-merge cost | Low. Upstream UI merges as today; conflicts only in `ThemeStyle` and the `MobileNavTabs` gate                                                              | Low to medium. Each native screen must track its upstream web twin            | Very high. About 2 upstream UI commits a day re-done by hand, plus every fork feature built twice                             | Very high, the same as 3                                                                     |
| Liquid Glass                    | System-drawn on the tab bar, sheets presented natively, sidebar and menus. Content stays opaque, which is what the HIG asks for                            | The same, plus native navigation bars                                         | Full                                                                                                                          | React Native: through native modules, behind Apple. Compose: drawn by Skia, not system glass |
| Dynamic Type                    | Yes, through the `-apple-system-*` keywords in WKWebView; amounts must not truncate (spec)                                                                 | Yes                                                                           | Full                                                                                                                          | React Native: partial (`allowFontScaling`). Compose: its own scaling                         |
| Accessibility                   | WKWebView exposes ARIA to VoiceOver; the web app already has a11y e2e (`mobile-list-a11y.mobile.test.ts`). Rotor and custom actions are weaker than native | Native for navigation; web elsewhere                                          | Best                                                                                                                          | React Native: good. Compose iOS: weaker                                                      |
| Keyboard and pointer (Mac)      | Already a keyboard-first desktop app; native menu bar adds shortcuts                                                                                       | The same                                                                      | Best                                                                                                                          | React Native for macOS: less mature than Windows                                             |
| Widgets, App Intents, Vision    | No                                                                                                                                                         | Yes, as native targets fed by an App Group snapshot                           | Yes                                                                                                                           | Yes, through native modules                                                                  |
| Performance                     | WKWebView and Chromium have JIT; heavy work is in a worker. Scroll and launch are slower than native                                                       | Native navigation removes the most visible lag                                | Best UI; 3b engine runs without JIT                                                                                           | Good UI; engine needs a new SQLite binding                                                   |
| Offline and sync                | Unchanged: one engine, one CRDT                                                                                                                            | Unchanged                                                                     | 3a unchanged; 3b new storage layer; 3c a second CRDT implementation                                                           | New storage layer                                                                            |
| Testing                         | Keeps 35 e2e files and 474 VRT snapshots                                                                                                                   | Keeps them, plus XCUITest for native parts                                    | Starts again: XCUITest and snapshot tests; Playwright covers only the web                                                     | Starts again: Detox or Maestro                                                               |
| Android, Windows, Linux         | All: `mobile-client/android` exists, and Electron builds for Windows and Linux                                                                             | All; native extras are Apple-only                                             | Apple only; others keep the web app, so two UIs to maintain                                                                   | Android and Windows (React Native); no Linux                                                 |
| Production data correctness     | No change: the same loot-core everywhere                                                                                                                   | Snapshot is read-only; intents call loot-core                                 | 3a safe; 3b moderate; 3c high risk: two engines writing the same CRDT messages can disagree, and the result is a wrong budget | Moderate: new storage layer under the same engine                                            |
| Team and agent skills           | TypeScript and React, which every agent and the review process use daily                                                                                   | Mostly TypeScript; small Swift targets. Ken is an experienced Apple developer | Swift and SwiftUI for every feature; Playwright and VRT skills no longer apply                                                | React Native is close to React but not the same; Kotlin is new                               |

## Decision

**Recommendation: option 1 now, growing into option 2 one native extra at a
time. Do not rewrite the UI (options 3 and 4).**

- Option 1 is already specified (`native-appearance`) and gets most of the
  platform feel for 3–5 pw, with almost no merge cost.
- Option 2's extras are worth doing because the web can't do them at all.
  Each is a small, separate native target. None of them puts a second engine
  near production data.
- A rewrite (93–230 pw with its engine) costs about 18–50 times option 1
  alone, or 6–15 times options 1 and 2 together. It then costs again for every upstream
  and fork feature, gives up Android, Windows and Linux or doubles the UIs,
  and throws away the e2e and VRT suites.
- The one rewrite variant that keeps data safe (3a, loot-core in a hidden
  WebView) keeps the WebView anyway.

Rules that follow from this:

1. **One engine.** loot-core is the only code that writes budget data, on
   every platform. Native code reads snapshots or calls loot-core handlers; it
   never writes SQLite or CRDT messages itself.
2. **The system draws native chrome; the web draws content.** No CSS
   imitation of native controls or Liquid Glass (`DESIGN.native.md`).
3. **Native extras are separate targets** with their own story each (widgets,
   App Intents, Vision under sc-2640). Each names its iPhone and Mac form, or
   gives a reason one platform is deferred.
4. **Run e2e against WebKit too.** The suites run in Chromium today; the
   iPhone app runs WebKit. Add a Playwright WebKit project for the
   `*.mobile.test.ts` files when the native theme lands.

## What would change the decision

Revisit this ADR, with fresh measurements, if any of these happens:

- **The fork stops merging upstream**, or upstream slows to a trickle. Most of
  the rewrite's ongoing cost is re-doing upstream's UI work.
- **Measured performance fails after tuning:** on the oldest supported iPhone,
  the budget screen can't hold 60 fps while scrolling, or a cold start to an
  interactive budget takes more than 2 seconds.
- **An accessibility audit finds a VoiceOver or Dynamic Type failure** that the
  WebView can't fix (for example, amounts truncating at accessibility sizes, or
  a control VoiceOver can't operate).
- **App Review rejects the app** as a repackaged website (guideline 4.2,
  minimum functionality), and the native extras don't resolve it.
- **The native surface grows past about three native screens**, at which
  point a native navigation framework (option 2 done fully, or 3a) may cost
  less than bridging screen by screen.
- **Upstream ships a native or portable engine** (for example a Rust or Swift
  core), or adopts React Native itself. Then option 3 or 4 no longer means a
  second engine or a fork of upstream's UI.
- **A platform requirement the WebView can't meet**, such as a system UI that
  must be built with SwiftUI (as widgets already are).

## Consequences

- The native apps keep shipping every upstream and fork feature the day it
  merges, on iPhone, Mac, Android, Windows, Linux and the browser.
- The apps look and navigate like Apple apps in their chrome, but scrolling,
  lists and sheets are web-drawn. A user may notice that, and the triggers
  above are how we'd know it matters.
- Native code stays small and Apple-specific: shells, chrome plugins and
  extras. Developers need some Swift for the extras, reviewed like any other
  code.

## Links

- Stories: sc-3579 (this ADR), sc-3483 (native design system), sc-3398 (iOS
  app), sc-3410 (Mac app), sc-2640 (receipt reading).
- Design: [`DESIGN.native.md`](../../DESIGN.native.md); spec
  `native-appearance` in `openspec/changes/add-native-design-system/`.
- Related ADR: [4. Fork migrations and upstream compatibility](0004-fork-migrations-and-upstream-compatibility.md).

## Sources

- In-app JavaScriptCore has no JIT on iOS, and WKWebView does:
  [Lucid, "JavaScriptCore—10 Months Later"](https://lucid.co/techblog/2019/01/03/javascriptcore-10-months-later);
  [Alastair Coote, "To JSC or not to JSC"](https://dev.to/alastaircoote/to-jsc-or-not-to-jsc-running-javascript-on-ios-in-2020-44ba);
  [WebKit bug 265151](https://bugs.webkit.org/show_bug.cgi?id=265151) (no
  JIT, so no WebAssembly, for JSC API clients on iOS).
- Widgets are SwiftUI in a separate extension process and share data through
  an App Group: [Apple, App extensions (SwiftUI)](https://developer.apple.com/documentation/swiftui/app-extensions);
  [Apple Developer Forums, WebView in a widget](https://developer.apple.com/forums/thread/654065).
- Expo DOM components host React DOM code in a WebView inside React Native:
  [Expo, DOM components](https://docs.expo.dev/guides/dom-components/).
- React DOM elements don't run in React Native:
  [Netguru, Sharing UI between React and React Native](https://netguru.com/blog/sharing-ui-between-react-and-react-native);
  [Theodo, React Strict DOM](https://blog.theodo.com/2024/04/react-strict-dom-react-native-web).
- React Native for Windows and macOS:
  [Microsoft, React Native for Windows + macOS](https://microsoft.github.io/react-native-windows);
  [react-native-macos README](https://unpkg.com/react-native-macos@0.81.9/README.md).
- Compose Multiplatform for iOS stable:
  [JetBrains, Compose Multiplatform 1.8.0](https://blog.jetbrains.com/kotlin/2025/05/compose-multiplatform-1-8-0-released-compose-multiplatform-for-ios-is-stable-and-production-ready/).
- Electron on macOS 26 had a WindowServer GPU bug, fixed in Electron 36.9.2,
  37.6.0 and 38.2.0 (the fork is on 43.8.1):
  [Electron PR 48376](https://releases.electronjs.org/pr/48376);
  [AppleInsider](https://appleinsider.com/articles/25/10/10/update-your-slack-discord-clients-the-electron-tahoe-gpu-slowdown-bug-is-fixed).
- WebKit storage policy (IndexedDB persistence is granted by heuristics, not
  guaranteed; options 1 and 2 keep relying on sync to the server for that):
  [WebKit, Updates to Storage Policy](https://webkit.org/?p=14403).
- System font and Dynamic Type in web content:
  [WebKit, Using the system font in web content](https://webkit.org/blog/3709/using-the-system-font-in-web-content/).
- Liquid Glass and the content layer:
  [Apple HIG, Materials](https://developer.apple.com/design/human-interface-guidelines/materials).
