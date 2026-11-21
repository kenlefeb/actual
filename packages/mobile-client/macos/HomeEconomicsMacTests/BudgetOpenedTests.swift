import Foundation
import NativeBridgeCore
import XCTest

@testable import HomeEconomicsMac

// sc-5496 (native-budget-opened-signal): "A native screen that has not loaded
// re-reads when the budget opens", on the Mac shell. The first test sends the
// event through the host's real receive path. The slow-open pair, which runs
// only in the gate job (a web build made with FORK_TEST_HOOKS=true and
// FORK_TEST_SLOW_OPEN_MS=6000, HE_SLOW_OPEN=1), opens a budget slowly on the
// real engine: with the Budget view model wired to the signal alone it ends
// loaded with no retry, and the control, with the signal not wired, stays
// failed. There is no UI test target on the Mac, and no window claim is made.
@MainActor
final class BudgetOpenedTests: XCTestCase {
    private func receive(_ host: MacEngineHost, _ event: String) {
        host.receive(["event": event], isMainFrame: true, scheme: "homeeconomics", host: "localhost", port: 0)
    }

    func testBudgetOpenedReachesOnlyItsOwnHandler() async throws {
        let host = MacEngineHost(www: FileManager.default.temporaryDirectory, version: "test")
        var opened = 0
        var events: [String] = []
        var changes = 0
        host.onBudgetOpened = { opened += 1 }
        host.onEvent = { events.append($0) }
        host.onChange = { changes += 1 }

        receive(host, "budget-opened")
        try await Task.sleep(nanoseconds: 300_000_000)
        XCTAssertEqual(opened, 1)
        XCTAssertEqual(events, [], "budget-opened must not reach onEvent")
        XCTAssertEqual(changes, 0, "budget-opened must not reach the change path")

        // The harness does reach them for any other event
        receive(host, "cells-changed")
        try await Task.sleep(nanoseconds: 300_000_000)
        XCTAssertEqual(opened, 1)
        XCTAssertEqual(events, ["cells-changed"])
        XCTAssertEqual(changes, 1)
    }

    func testAnEventFromAnotherPageIsIgnored() {
        let host = MacEngineHost(www: FileManager.default.temporaryDirectory, version: "test")
        var opened = 0
        host.onBudgetOpened = { opened += 1 }
        host.receive(["event": "budget-opened"], isMainFrame: true, scheme: "https", host: "actual-staging.us.auth0.com", port: 0)
        host.receive(["event": "budget-opened"], isMainFrame: false, scheme: "homeeconomics", host: "localhost", port: 0)
        XCTAssertEqual(opened, 0)
    }

    // The screen is wired to the signal alone (no onEvent, so no change path re-reads it): a read
    // made during the open is refused, and only budget-opened can load it
    func testASlowOpenEndsLoadedThroughTheRealEventPath() async throws {
        let seconds = try await slowOpen(wireTheSignal: true)
        print(String(format: "slow open evidence (Mac, real): refused during the open, then loaded %.1f s after the first read, signal only, no retry", seconds ?? -1))
        XCTAssertNotNil(seconds, "the Budget view model never loaded by itself")
    }

    // Negative control: the same run with the signal not wired stays failed well past the open
    func testWithoutTheSignalTheBudgetViewModelStaysFailed() async throws {
        let seconds = try await slowOpen(wireTheSignal: false)
        XCTAssertNil(seconds, "the Budget view model loaded without the signal")
        print("slow open evidence (Mac, control): refused during the open, still failed well past the open with the signal not wired")
    }

    // Returns the seconds from the first read until the model loaded by itself, or nil if it stayed failed
    private func slowOpen(wireTheSignal: Bool) async throws -> TimeInterval? {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["HE_SLOW_OPEN"] == "1", "runs in the gate job")
        // Past this point nothing skips: a gate that can't run has failed
        let www = Bundle.main.resourceURL!.appendingPathComponent("www")
        XCTAssertTrue(try holdsSlowOpenHook(www), "the staged web build must be made with FORK_TEST_HOOKS=true and FORK_TEST_SLOW_OPEN_MS")

        let host = MacEngineHost(www: www, version: "slow-open")
        let model = BudgetViewModel(client: host.client)
        if wireTheSignal { host.onBudgetOpened = { Task { await model.budgetOpened() } } }
        host.load()
        let page = PageCall(runner: host.webView, serverURL: MacEngineHost.serverURL)
        try await waitFor("the page bridge") { (try? await page.run("return typeof window.__actualNativeBridge")) as? String == "object" }

        // The open runs on in the page while this read is made, and is refused
        Task { _ = try? await page.run("await window.$send('create-budget', { testMode: true }); return 'ok';") }
        let started = Date()
        await model.load()
        guard case .failed = model.state else {
            XCTFail("a read during the open should be refused, got \(model.state)")
            return nil
        }
        // The open takes 6 s from the create; 14 s is well past it
        let deadline = started.addingTimeInterval(14)
        while Date() < deadline {
            if case .loaded = model.state { return Date().timeIntervalSince(started) }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        return nil
    }

    private func holdsSlowOpenHook(_ www: URL) throws -> Bool {
        let files = FileManager.default.enumerator(at: www, includingPropertiesForKeys: nil)
        while let file = files?.nextObject() as? URL {
            guard file.pathExtension == "js" else { continue }
            if try String(contentsOf: file, encoding: .utf8).contains("__forkTestSlowOpen") { return true }
        }
        return false
    }

    private func waitFor(_ what: String, timeout: TimeInterval = 120, _ check: () async throws -> Bool) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if try await check() { return }
            try await Task.sleep(nanoseconds: 500_000_000)
        }
        XCTFail("timed out waiting for \(what)")
        throw CancellationError()
    }
}
