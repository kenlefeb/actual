# 11. Native UI without upstream parity

Fork-only; never upstream. **Status: Proposed** (2026-11-11, Solution
Architect, sc-3579). It supersedes the decision in
[ADR 10](0010-native-ui-approach.md). ADR 10's measurements, options and
sources still stand; this ADR changes two of its inputs and re-weighs the
options.

## Context

After ADR 10 merged, Ken clarified two things (2026-11-11, sc-3579):

1. **No UX parity with upstream in the native apps.** The iPhone and Mac apps
   don't need to follow upstream Actual's UI. ADR 10's main argument against a
   native UI was that a native UI would have to re-do about two upstream UI
   commits a day. For the native apps, that cost is gone.
2. **One budget engine, never ported.** Ken does not want to rewrite loot-core
   or maintain a second copy of it. A port would only be considered if the
   fork someday breaks off from Actual entirely.

With these two inputs, the real choice is between two options:

- **Hybrid (ADR 10, option 2):** web screens, native chrome, native extras.
- **Option 3a:** a SwiftUI/AppKit UI that drives the one loot-core through a
  hidden WebView.

Options 3b (loot-core in JavaScriptCore), 3c (a Swift port) and 4 (React
Native or Compose) are out:

- **3c** breaks the engine rule.
- **3b:** in-app JavaScriptCore on iOS has had no JIT, and so no WebAssembly
  for sql.js. Re-verify that limit before relying on it, but even if it has
  changed, 3b only adds a second JavaScript host to maintain.
- **4:** without upstream parity, it reuses nothing that SwiftUI doesn't
  already give, and it still needs a new SQLite binding under loot-core.

### What the engine already offers a native UI

Measured on `development`, 2026-11-11:

- **A self-contained engine build.** `packages/api` already builds loot-core
  for the browser as a Web Worker, with the sql.js WebAssembly and the
  migrations embedded (`browser-worker.ts`). A WKWebView can load that build
  with no React UI. In a WKWebView it runs with the JIT, exactly as the
  current app does.
- **Reads.** Two ways in:
  - `query` (`server/main.ts`) runs a serialized AQL query, the same query
    language `@actual-app/api` uses.
  - `get-cell`, `get-cell-names` and `create-query` read the budget
    spreadsheet, which holds the computed numbers: budgeted, spent, balance
    and to-budget.
- **Change events.** The engine pushes `cells-changed` with the changed
  cells, and `sync-event` after a sync.
- **Writes.** Through the 240 handler registrations (`app.method`), such as
  `transaction-add` and `budget/budget-amount`.
- **How the web client reads today.** It asks for one cell per message:
  `useSpreadsheet.tsx` calls `send('get-cell', …)` for each bound cell and
  caches the result until `cells-changed` arrives. Inside one process that is
  fine. Over a native bridge, a budget month of 60 categories at four cells
  each would be about 240 round trips.

## Options

Effort is in rough agent-assisted person-weeks (pw). "Core screens" means the
screens Ken uses daily: Budget, Accounts with their transactions, Add and edit
transaction, a basic Reports overview, and Settings. Everything else stays a
web screen inside the app. No parity is required.

### A. Hybrid: web screens, native chrome and extras

This is ADR 10's recommendation. It is the in-flight `add-native-design-system`
change plus native extras.

### B. Native UI on the one engine, migrated screen by screen (3a, incremental)

Build a native SwiftUI UI over the existing app, one screen at a time.

**The iPhone migration path:**

- A native tab bar is the root of the app.
- Each tab hosts either the existing WebView screen or a new SwiftUI screen.
- A SwiftUI screen calls loot-core through a small Capacitor plugin. The
  plugin forwards to `send()` in the page, and loot-core keeps running where
  it runs today. Capacitor's documented way to show native UI is a plugin
  that presents from the bridge's view controller.
- Each screen ships on its own and replaces its web twin only in the iOS
  app.
- When no visible web screen is left on a path, the WebView on that path is
  just the hidden engine host.

**The Mac path:** Electron can't host SwiftUI screens, so the Mac can't
migrate inside Electron.

- Once the iPhone core screens have proved the bridge, build a SwiftUI Mac
  app.
- It shares the iPhone's view models and most of its views, and has its own
  dense money table and menu bar.
- It hosts the same engine in a hidden WKWebView.
- Long-tail screens open as web screens in a WKWebView window.
- It ships beside the Electron app until it covers Ken's daily use. Electron
  then stays the app for Windows and Linux.

### C. Native UI on the one engine, all at once (3a, big bang)

The same architecture as B, but built as a separate new app and switched over
only when it reaches the scope of the core screens.

## Comparison

| Criterion                | A. Hybrid                                                      | B. Native, screen by screen                                                                                                                            | C. Native, big bang                                                                                 |
| ------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Effort, iPhone           | 3–5 pw for the theme and chrome; 2–3 pw per extra              | Bridge and engine host 3–5 pw once; then 12–19 pw for the core screens (Budget 3–4, Accounts and transactions 4–6, Add 1–2, Reports 3–5, Settings 1–2) | The same screens, plus 2–4 pw to rebuild the shell, onboarding and sign-in before the first release |
| Effort, Mac              | 1–2 pw of chrome                                               | 8–12 pw on top of iPhone: shared view models, plus a Mac money table, menus and windows                                                                | The same                                                                                            |
| First user-visible value | Days                                                           | After the first screen (Budget), in about 6–9 pw                                                                                                       | After all core screens, in about 17–28 pw                                                           |
| Platform fidelity        | Native chrome; web content                                     | Fully native on migrated screens; web on the long tail                                                                                                 | Fully native on core screens; web on the long tail                                                  |
| Data safety              | Unchanged                                                      | Unchanged if the bridge rules below hold                                                                                                               | The same as B                                                                                       |
| Rollback                 | Not needed                                                     | Per screen: turn the native screen off and the web twin comes back                                                                                     | All or nothing                                                                                      |
| Android, Windows, Linux  | Unchanged; they get the web UI and upstream's UI work for free | Unchanged. Native screens are Apple-only, and the web UI stays the UI everywhere else                                                                  | The same as B                                                                                       |

### Bridge design and performance

These rules apply to B and C. They are the part of this decision that matters
most.

1. **Batch reads.** Add a fork-only loot-core handler that returns a whole
   view's numbers in one message. For example, `native/budget-month` would
   return every category's budgeted, spent and balance, and the month totals,
   for one month. Native code never asks for cells one by one.
2. **Push changes.** The native side subscribes to `cells-changed` and
   `sync-event`. It re-reads only the view models whose cells changed,
   debounced to one read per frame.
3. **Page lists.** Transaction lists use AQL `limit` and `offset` (or a
   keyset) through `query`, one page per message.
4. **Measure the bridge.** Published numbers for a WKWebView message round
   trip date from 2015 (0.4–3.6 ms on an iPad mini 2) and need re-measuring on
   current devices. The design target: a budget month loads in one round trip
   under 50 ms for 300 categories on the oldest supported iPhone. Build a
   benchmark with the bridge before the first screen.
5. **Typed contract.** The Swift side uses `Codable` types for each bridged
   handler's input and output. A vitest contract test calls each bridged
   handler on a real budget and checks the result against a JSON fixture. The
   Swift tests decode that same fixture. A shape change in loot-core then
   fails CI on both sides.

### Data safety (B and C)

- **Only loot-core writes.** Swift code never opens the SQLite file, never
  writes CRDT messages, and never computes a balance that it then stores.
- **An allowlist.** The bridge plugin forwards only the handlers on an
  explicit list: the batched read handlers, `query`, and the write handlers
  the native screens need. Any other name is rejected. This also limits what
  a compromised web page could ask native code to do.
- **Display only.** Native code may format and arrange numbers, but every
  number it shows comes from loot-core. Totals are not re-summed in Swift.
- **Widgets and App Intents** follow ADR 10: a widget reads a snapshot the
  app writes, and an intent calls a write handler.
- **Moving the Mac from Electron to SwiftUI** changes where the local copy
  lives: Electron's `better-sqlite3` file versus WKWebView storage. The Mac
  app opens a budget by downloading it from the sync server, as a new device
  does. It never copies the Electron file across.

### Testing

- **Engine.** The vitest suites and the new bridge contract test, as above.
- **Native.**
  - Swift unit tests for view models, against a fake bridge fed by the
    contract fixtures.
  - XCUITest for each migrated screen, on an iOS simulator on a macOS CI
    runner.
  - Swift snapshot tests in place of VRT for native screens.
- **Web.** Playwright e2e and VRT keep covering the web UI, which still ships
  in browsers and on Android, Windows and Linux. A web screen's
  `*.mobile.test.ts` stays as long as any build still shows that screen.

## Decision

**Recommendation: B. Build a native UI on the one engine, screen by screen,
starting on iPhone.**

- It is the only option that gives Ken a native app without a second engine
  and without a big-bang release.
- Each screen can be shipped, judged and rolled back on its own.
- The web UI never goes away. It stays the long tail inside the apps, and the
  whole UI on Android, Windows, Linux and in browsers.

Order of work:

1. **Finish the theme** (sc-3505). Web screens stay in the native apps for
   months, and for some screens indefinitely, so they should look native.
2. **Build the native tab bar as the app's root** (sc-3514, re-scoped). Each
   tab can host the WebView or a native screen. This replaces "a native tab
   bar over one WebView".
3. **Build the bridge spike:**
   - the Capacitor plugin and its allowlist;
   - `native/budget-month`, with the contract test;
   - the latency benchmark.

   A new story. Stop and revisit this ADR if the benchmark misses the target.

4. **Build the native Budget screen**, then Add transaction, then Accounts and
   transactions, then Reports. One story per screen, each with an OpenSpec
   scenario per platform.
5. **Build the Mac SwiftUI app** once the iPhone Budget and Add screens are
   in Ken's daily use.

Everything else keeps ADR 10's rules: one engine, the system draws chrome,
and native extras are separate targets.

### What this means for the in-flight stories

| Story                         | State       | Recommendation                                                                                                                                                                                                                      |
| ----------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| sc-3505 native theme          | In Review   | **Keep and finish.** The web screens stay in the apps for a long time. Its colour, type and spacing tokens also become the SwiftUI asset catalogue, so the native screens match it.                                                 |
| sc-3514 iPhone tab bar        | Ready to Do | **Keep, re-scoped.** The tab bar is the native root, each tab hosts a WebView or a native screen, and the Add button can later open a native sheet. The PO updates the story before it starts.                                      |
| sc-3523 Mac window chrome     | Ready to Do | **Shrink.** The menu bar and window titles help as long as the Electron app is in use, and on Windows and Linux. Defer the sidebar material and the inset title bar: the SwiftUI Mac app gets them from the system. The PO decides. |
| sc-3532 app icon and wordmark | Ready to Do | **Keep as is.** The icon and the name carry over to the SwiftUI apps unchanged.                                                                                                                                                     |

## What would change the decision

- **The bridge benchmark misses its target**, and batching can't fix it. Then
  stay with A for content and use native code only for chrome and extras.
- **Ken wants Android or Windows to look native too.** Then weigh a
  cross-platform native UI (ADR 10, option 4) against per-platform native
  code.
- **The fork breaks off from upstream.** Only then can a native engine port
  (3c) be weighed; Ken's rule stands until then.
- **Native screens multiply until the long tail is gone.** Then the iPhone app
  no longer needs Capacitor's visible WebView, and the engine host can move to
  a plain hidden WKWebView in a pure SwiftUI app (C's end state, reached
  gradually).

## Consequences

- The fork gains Swift code that grows with each native screen. Developers
  need SwiftUI skills, and CI needs a macOS runner for XCUITest.
- The iPhone and Mac apps stop showing upstream's UI on the migrated screens.
  Upstream UI changes to those screens no longer reach Apple users. That is
  intended.
- loot-core gains a few fork-only batched read handlers. They are additive,
  so the upstream-merge risk is low under
  [ADR 4](0004-fork-migrations-and-upstream-compatibility.md).

## Links

- Stories: sc-3579 (this ADR); sc-3505, sc-3514, sc-3523 and sc-3532
  (`add-native-design-system`); sc-3398 (iOS app); sc-3410 (Mac app);
  sc-2640 (receipt reading).
- Code: `packages/api/browser-worker.ts`; `packages/loot-core/src/server/main.ts`
  (`query`); `packages/loot-core/src/server/spreadsheet/app.ts`;
  `packages/desktop-client/src/hooks/useSpreadsheet.tsx`.

## Sources

ADR 10's sources apply. In addition:

- Presenting native views from a Capacitor plugin:
  [Capacitor, iOS plugin guide](https://capacitorjs.com/docs/plugins/ios);
  [VP0, Injecting SwiftUI inside a Capacitor app](https://vp0.com/blogs/injecting-swiftui-inside-capacitor-app).
- WKWebView message round-trip latency (2015 measurements, to be redone):
  [persistent.info, WKWebView communication latency](https://blog.persistent.info/2015/01/wkwebview-communication-latency.html);
  [the August 2015 follow-up](https://blog.persistent.info/2015/08/wkwebview-communication-latency.html).
