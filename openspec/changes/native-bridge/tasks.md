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
