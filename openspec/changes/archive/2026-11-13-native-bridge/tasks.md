# Tasks

Test-first: write the tests, run them and see them fail before writing the code. One story, one PR.

## 1. Native bridge spike (sc-3584)

- [x] 1.1 Add a failing vitest contract test for `native/budget-month` on a seeded envelope and a seeded tracking budget, checked against JSON fixtures. Verify: it fails before the handler exists.
- [x] 1.2 Implement `native/budget-month` in `packages/loot-core/src/server/native/app.ts` and map it in `packages/mcp/coverage.json`. Verify: 1.1 passes.
- [x] 1.3 Add failing tests for the page-side bridge in `packages/desktop-client/src/native/`: an allowlisted call is forwarded, any other name is refused, and change events reach native code. Then implement it and install it only in the iOS app. Verify: the tests pass.
- [x] 1.4 Add the Swift package `NativeBridgeCore` with the `Codable` budget month, the allowlist and the event coalescer, and Swift tests that decode the same fixtures and refuse a name off the list. Verify: `swift test` passes.
- [x] 1.5 Add the Capacitor plugin to the iOS app, calling the page bridge and receiving its events. Verify: the app builds and runs in the Simulator.
- [x] 1.6 Add `fork/scripts/check-native-swift.mjs` with a test, and run it in Fork CI. Verify: it fails on a Swift file that imports SQLite.
- [x] 1.7 Benchmark a 300-category month in the iOS Simulator, with the WebView visible, hidden, and across background and foreground. Verify: the numbers and findings are on sc-3584.
- [x] 1.8 Add failing Swift tests for a bridge call timeout (about 5 s default, configurable, fails with an error naming the handler, even when the transport ignores cancellation), then implement it in `NativeBridgeClient`. Verify: `swift test` passes.
- [x] 1.9 Move the benchmark's measurement into `NativeBridgeCore` with tests, and add a Release-build trigger: a two-finger, 3-second hold, then a confirmation, runs read-only reads of the open budget and shows the median and p95 with a Share button. Verify: in a Release Simulator build, the result shows and the share sheet opens.
- [x] 1.10 Extend `check-native-swift.mjs` to typed imports (`import struct SQLite3.x`), `canImport(...)`, FMDB, SQLCipher, CSQLite and Core Data, `sqlite3.h` in headers and `.sqlite3` paths, with tests first. Verify: the tests pass and the checkout is clean.
- [x] 1.11 Add the spec requirements for app extensions and for a suspended engine. Verify: `openspec validate --all --strict` passes.

## 2. Bridge origin guard (sc-3697)

- [x] 2.1 Add `PageOriginGuard` to `NativeBridgeCore`: accept a script message only from the main frame on the app server's scheme, host and port, compared case-insensitively on effective ports. Verify: `swift test` passes.
- [x] 2.2 Add `PageOriginGuardTests`, covering other hosts, schemes, ports and subframes, a missing server URL, a mixed-case server URL and default-port messages. Verify: the new tests fail before the guard change and pass after.
- [x] 2.3 Use the guard in both `NativeBridgePlugin` and `NativeChromePlugin`. Verify: both plugins call `PageOriginGuard.accepts` before handling a message.
