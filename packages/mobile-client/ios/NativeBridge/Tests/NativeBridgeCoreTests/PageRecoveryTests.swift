import XCTest

#if canImport(WebKit)
import WebKit
#endif

@testable import NativeBridgeCore

// sc-5247: what the iPhone app does when WebKit ends the page's process. The
// cap is the one the Mac app uses (sc-5186).
@MainActor
final class PageRecoveryTests: XCTestCase {
    private var reloads = 0
    private var gaveUp = 0
    private var clock = Date(timeIntervalSince1970: 1_000_000)

    private func recovery() -> PageRecovery {
        PageRecovery(
            now: { [unowned self] in self.clock },
            reload: { [unowned self] in self.reloads += 1 },
            giveUp: { [unowned self] in self.gaveUp += 1 })
    }

    func testTheGuardAllowsALimitWithinItsWindow() {
        var guardrail = ReloadGuard(limit: 2, window: 60)
        let start = Date(timeIntervalSince1970: 0)
        XCTAssertTrue(guardrail.allowsReload(at: start))
        XCTAssertTrue(guardrail.allowsReload(at: start + 10))
        XCTAssertFalse(guardrail.allowsReload(at: start + 20))
        XCTAssertTrue(guardrail.allowsReload(at: start + 71))
    }

    func testTheDefaultCapIsThreeInAMinute() {
        let guardrail = ReloadGuard()
        XCTAssertEqual(guardrail.limit, 3)
        XCTAssertEqual(guardrail.window, 60)
    }

    func testAnEndedProcessReloads() {
        recovery().processEnded()
        XCTAssertEqual(reloads, 1)
        XCTAssertEqual(gaveUp, 0)
    }

    func testAFourthEndWithinAMinuteAsksInstead() {
        let recovery = recovery()
        for _ in 0..<4 {
            recovery.processEnded()
            clock += 5
        }
        XCTAssertEqual(reloads, 3)
        XCTAssertEqual(gaveUp, 1)
    }

    func testEndsFarApartKeepReloading() {
        let recovery = recovery()
        for _ in 0..<5 {
            recovery.processEnded()
            clock += 120
        }
        XCTAssertEqual(reloads, 5)
        XCTAssertEqual(gaveUp, 0)
    }

    func testTheUsersReloadStartsOver() {
        let recovery = recovery()
        for _ in 0..<4 { recovery.processEnded() }
        recovery.userReload()
        XCTAssertEqual(reloads, 4)
        recovery.processEnded()
        XCTAssertEqual(reloads, 5)
        XCTAssertEqual(gaveUp, 1)
    }

    #if canImport(WebKit)
    // Stands in for Capacitor's handler, which reloads the current URL
    private final class FakeHandler: NSObject, WKNavigationDelegate {
        var terminated = 0
        var finished = 0
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { terminated += 1 }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { finished += 1 }
    }

    private static let didFinish = #selector(WKNavigationDelegate.webView(_:didFinish:))
    private static let didCommit = #selector(WKNavigationDelegate.webView(_:didCommit:))
    private static let didTerminate = #selector(WKNavigationDelegate.webViewWebContentProcessDidTerminate(_:))

    func testTheDelegateTakesTheEndOfTheProcessAwayFromTheHandler() {
        let handler = FakeHandler()
        var ended = 0
        let delegate = PageProcessDelegate(forwardingTo: handler) { ended += 1 }
        delegate.webViewWebContentProcessDidTerminate(WKWebView())
        XCTAssertEqual(ended, 1)
        XCTAssertEqual(handler.terminated, 0, "the handler would reload the current URL")
    }

    func testTheDelegatePassesEverythingElseToTheHandler() {
        let handler = FakeHandler()
        let delegate = PageProcessDelegate(forwardingTo: handler) {}
        XCTAssertTrue(delegate.responds(to: Self.didFinish))
        XCTAssertTrue(delegate.forwardingTarget(for: Self.didFinish) as AnyObject === handler)
        XCTAssertFalse(delegate.responds(to: Self.didCommit), "what the handler doesn't implement stays unimplemented")
        XCTAssertTrue(delegate.responds(to: Self.didTerminate))
        XCTAssertNil(delegate.forwardingTarget(for: Self.didTerminate))
    }

    func testAForwardedCallReachesTheHandler() {
        let handler = FakeHandler()
        let delegate = PageProcessDelegate(forwardingTo: handler) {}
        let navigation: WKNavigationDelegate = delegate
        navigation.webView?(WKWebView(), didFinish: nil)
        XCTAssertEqual(handler.finished, 1)
    }
    #endif
}
