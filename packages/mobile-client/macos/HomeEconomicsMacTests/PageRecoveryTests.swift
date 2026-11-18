import WebKit
import XCTest

@testable import HomeEconomicsMac

// Story 5186: when WebKit ends the page's process, the app reloads its own
// page, and stops after repeated failures to ask the user instead
@MainActor
final class PageRecoveryTests: XCTestCase {
    private var loaded: [URL] = []
    private var gaveUp = 0
    private var clock = Date(timeIntervalSince1970: 1_000_000)

    private func host() -> MacEngineHost {
        let host = MacEngineHost(
            www: FileManager.default.temporaryDirectory, version: "test", policy: NavigationPolicy(allowedHosts: []),
            openInBrowser: { _ in XCTFail("nothing opens in the browser") })
        host.loadPage = { [unowned self] in self.loaded.append($0.url!) }
        host.now = { [unowned self] in self.clock }
        host.onPageGone = { [unowned self] in self.gaveUp += 1 }
        return host
    }

    func testATerminatedPageReloadsTheAppsOwnPage() {
        let host = host()
        host.webViewWebContentProcessDidTerminate(host.webView)
        XCTAssertEqual(loaded, [URL(string: "homeeconomics://localhost/")!])
        XCTAssertEqual(gaveUp, 0)
    }

    func testRepeatedTerminationsStopAfterThreeReloadsAndAsk() {
        let host = host()
        for _ in 0..<4 {
            host.webViewWebContentProcessDidTerminate(host.webView)
            clock += 5
        }
        XCTAssertEqual(loaded.count, 3)
        XCTAssertEqual(gaveUp, 1)
    }

    func testTerminationsFarApartKeepReloading() {
        let host = host()
        for _ in 0..<5 {
            host.webViewWebContentProcessDidTerminate(host.webView)
            clock += 120
        }
        XCTAssertEqual(loaded.count, 5)
        XCTAssertEqual(gaveUp, 0)
    }

    func testTheUsersReloadStartsOver() {
        let host = host()
        for _ in 0..<4 { host.webViewWebContentProcessDidTerminate(host.webView) }
        host.reloadAfterGivingUp()
        XCTAssertEqual(loaded.count, 4)
        host.webViewWebContentProcessDidTerminate(host.webView)
        XCTAssertEqual(loaded.count, 5)
        XCTAssertEqual(gaveUp, 1)
    }

    func testTheGuardAlone() {
        var guardrail = ReloadGuard(limit: 2, window: 60)
        let start = Date(timeIntervalSince1970: 0)
        XCTAssertTrue(guardrail.allowsReload(at: start))
        XCTAssertTrue(guardrail.allowsReload(at: start + 10))
        XCTAssertFalse(guardrail.allowsReload(at: start + 20))
        XCTAssertTrue(guardrail.allowsReload(at: start + 71))
    }
}
