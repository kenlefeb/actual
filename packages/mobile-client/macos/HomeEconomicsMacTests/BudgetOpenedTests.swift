import Foundation
import NativeBridgeCore
import XCTest

@testable import HomeEconomicsMac

// sc-5496 (native-budget-opened-signal): "A native screen that has not loaded
// re-reads when the budget opens", on the Mac shell. The first test sends the
// event through the host's real receive path. The second, which runs only in
// the gate job (a web build made with FORK_TEST_HOOKS=true and
// FORK_TEST_SLOW_OPEN_MS=6000, HE_SLOW_OPEN=1), opens a budget slowly on the
// real engine and shows the Budget view model ends loaded with no retry. There
// is no UI test target on the Mac, and no window claim is made.
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

    func testASlowOpenEndsLoadedThroughTheRealEventPath() async throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["HE_SLOW_OPEN"] == "1", "runs in the gate job")
        // Past this point nothing skips: a gate that can't run has failed
        let www = Bundle.main.resourceURL!.appendingPathComponent("www")
        XCTAssertTrue(try holdsSlowOpenHook(www), "the staged web build must be made with FORK_TEST_HOOKS=true and FORK_TEST_SLOW_OPEN_MS")

        let host = MacEngineHost(www: www, version: "slow-open")
        let model = BudgetViewModel(client: host.client)
        // Wired as a native window would wire it: the open event to its own handler, the rest to the change path
        host.onBudgetOpened = { Task { await model.budgetOpened() } }
        host.onEvent = { _ in model.changeEventReceived() }
        host.load()
        let page = PageCall(runner: host.webView, serverURL: MacEngineHost.serverURL)
        try await waitFor("the page bridge") { (try? await page.run("return typeof window.__actualNativeBridge")) as? String == "object" }

        // The open runs on in the page while this read is made, and is refused
        Task { _ = try? await page.run("await window.$send('create-budget', { testMode: true }); return 'ok';") }
        let started = Date()
        await model.load()
        guard case .failed = model.state else { return XCTFail("a read during the open should be refused, got \(model.state)") }
        try await waitFor("the Budget view model to load by itself", timeout: 60) {
            if case .loaded = model.state { return true }
            return false
        }
        print(String(format: "slow open: loaded %.1f s after the first read was refused, no retry", Date().timeIntervalSince(started)))
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
