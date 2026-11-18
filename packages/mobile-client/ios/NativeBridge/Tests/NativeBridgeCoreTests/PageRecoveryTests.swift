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
    private var alertCanShow = true
    private var scheduled: [(delay: TimeInterval, work: () -> Void)] = []

    private func recovery() -> PageRecovery {
        PageRecovery(
            now: { [unowned self] in self.clock },
            schedule: { [unowned self] in self.scheduled.append(($0, $1)) },
            reload: { [unowned self] in self.reloads += 1 },
            giveUp: { [unowned self] in
                self.gaveUp += 1
                return self.alertCanShow
            })
    }

    private func reachTheCap(_ recovery: PageRecovery) {
        for _ in 0..<4 { recovery.processEnded() }
    }

    private func runScheduled() {
        let due = scheduled
        scheduled = []
        due.forEach { $0.work() }
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

    func testAShownAlertNeedsNoRetry() {
        reachTheCap(recovery())
        XCTAssertEqual(gaveUp, 1)
        XCTAssertTrue(scheduled.isEmpty)
    }

    func testAnAlertThatCannotShowIsTriedAgain() {
        let recovery = recovery()
        alertCanShow = false
        reachTheCap(recovery)
        XCTAssertEqual(gaveUp, 1)
        XCTAssertEqual(scheduled.map(\.delay), [PageRecovery.alertRetryDelay])
        alertCanShow = true
        runScheduled()
        XCTAssertEqual(gaveUp, 2)
        XCTAssertTrue(scheduled.isEmpty)
        XCTAssertEqual(reloads, 3, "the alert showed, so the app waits for the person")
    }

    // The page must not stay dead with nothing on screen, within the cap
    func testAnAlertThatNeverShowsReloadsOnceASlotIsFree() {
        let recovery = recovery()
        alertCanShow = false
        reachTheCap(recovery)
        for _ in 0..<(PageRecovery.alertAttempts + 3) { runScheduled() }
        XCTAssertEqual(reloads, 3, "no slot is free yet")
        XCTAssertEqual(scheduled.count, 1, "it keeps trying the alert")
        clock += 61
        runScheduled()
        XCTAssertEqual(reloads, 4)
        XCTAssertTrue(scheduled.isEmpty)
    }

    func testAReloadBeforeTheLastAttemptWaitsEvenWithAFreeSlot() {
        let recovery = recovery()
        alertCanShow = false
        reachTheCap(recovery)
        clock += 61
        runScheduled()
        XCTAssertEqual(reloads, 3, "the alert gets its attempts first")
    }

    // Security's probe (PR 484): the page dies right after every load and the
    // alert never shows, as when the app isn't active
    func testAPageThatKeepsDyingStaysWithinTheCapWhenTheAlertCannotShow() {
        var queue: [(at: Date, work: () -> Void)] = []
        var loads: [Date] = []
        var recovery: PageRecovery!
        recovery = PageRecovery(
            now: { [unowned self] in self.clock },
            schedule: { [unowned self] delay, work in queue.append((self.clock + delay, work)) },
            reload: { [unowned self] in
                loads.append(self.clock)
                queue.append((self.clock + 0.2, { recovery.processEnded() }))
            },
            giveUp: { false })
        let start = clock
        recovery.processEnded()
        while let next = queue.indices.min(by: { queue[$0].at < queue[$1].at }), queue[next].at < start + 3_600 {
            let item = queue.remove(at: next)
            clock = item.at
            item.work()
        }
        XCTAssertGreaterThan(loads.count, 3, "it keeps trying to recover")
        for (index, load) in loads.enumerated() {
            let inWindow = loads[index...].prefix { $0.timeIntervalSince(load) < 60 }.count
            XCTAssertLessThanOrEqual(inWindow, 3, "at \(load.timeIntervalSince(start)) s")
        }
    }

    func testReturningToTheAppShowsTheWaitingAlertAtOnce() {
        let recovery = recovery()
        alertCanShow = false
        reachTheCap(recovery)
        alertCanShow = true
        recovery.appBecameActive()
        XCTAssertEqual(gaveUp, 2)
        runScheduled()
        XCTAssertEqual(gaveUp, 2, "the alert is up, so the retry stops")
        XCTAssertEqual(reloads, 3)
    }

    func testReturningToTheAppDoesNotStartASecondRetry() {
        let recovery = recovery()
        alertCanShow = false
        reachTheCap(recovery)
        recovery.appBecameActive()
        XCTAssertEqual(scheduled.count, 1)
    }

    func testReturningToTheAppWithNothingWaitingDoesNothing() {
        let recovery = recovery()
        recovery.appBecameActive()
        XCTAssertEqual(gaveUp, 0)
        XCTAssertEqual(reloads, 0)
    }

    func testAnotherEndWhileRetryingDoesNotStartASecondRetry() {
        let recovery = recovery()
        alertCanShow = false
        reachTheCap(recovery)
        recovery.processEnded()
        XCTAssertEqual(scheduled.count, 1)
        XCTAssertEqual(gaveUp, 1)
    }

    func testTheUsersReloadCancelsAPendingRetry() {
        let recovery = recovery()
        alertCanShow = false
        reachTheCap(recovery)
        recovery.userReload()
        runScheduled()
        XCTAssertEqual(gaveUp, 1)
        XCTAssertEqual(reloads, 4)
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
