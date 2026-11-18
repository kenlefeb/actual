import XCTest

@testable import HomeEconomicsMac

// Story 5220: every automatic page reload shows a brief, non-blocking notice
@MainActor
final class ReloadNoticeTests: XCTestCase {
    // MARK: The host says when it reloaded on its own

    private var automaticReloads = 0
    private var gaveUp = 0

    private func host() -> MacEngineHost {
        let host = MacEngineHost(
            www: FileManager.default.temporaryDirectory, version: "test", policy: NavigationPolicy(allowedHosts: []),
            openInBrowser: { _ in })
        host.loadPage = { _ in }
        host.onAutomaticReload = { [unowned self] in self.automaticReloads += 1 }
        host.onPageGone = { [unowned self] in self.gaveUp += 1 }
        return host
    }

    func testEachAutomaticReloadIsAnnounced() {
        let host = host()
        for _ in 0..<3 { host.webViewWebContentProcessDidTerminate(host.webView) }
        XCTAssertEqual(automaticReloads, 3)
    }

    func testGivingUpAndTheUsersReloadAreNot() {
        let host = host()
        for _ in 0..<4 { host.webViewWebContentProcessDidTerminate(host.webView) }
        host.reloadAfterGivingUp()
        host.load()
        XCTAssertEqual(automaticReloads, 3)
        XCTAssertEqual(gaveUp, 1)
    }

    // MARK: The notice

    private final class FakeScheduler {
        var pending: [(TimeInterval, () -> Void)] = []
        func schedule(_ delay: TimeInterval, _ work: @escaping () -> Void) { pending.append((delay, work)) }
        func fireAll() {
            let due = pending
            pending = []
            due.forEach { $0.1() }
        }
    }

    func testANoticeShowsIsAnnouncedAndDismissesItself() {
        let scheduler = FakeScheduler()
        var announced: [String] = []
        let notices = WindowNotices(schedule: scheduler.schedule, announce: { announced.append($0) })
        notices.show(.pageRestarted)
        XCTAssertEqual(notices.current, .pageRestarted)
        XCTAssertEqual(announced, [WindowNotice.pageRestarted.text])
        XCTAssertEqual(scheduler.pending.map(\.0), [WindowNotices.transientDuration])
        scheduler.fireAll()
        XCTAssertNil(notices.current)
    }

    func testAnotherReloadRestartsTheTimer() {
        let scheduler = FakeScheduler()
        let notices = WindowNotices(schedule: scheduler.schedule, announce: { _ in })
        notices.show(.pageRestarted)
        let firstExpiry = scheduler.pending.removeFirst()
        notices.show(.pageRestarted)
        // The first notice's timer fires after the second notice: it must not hide it
        firstExpiry.1()
        XCTAssertEqual(notices.current, .pageRestarted)
        scheduler.fireAll()
        XCTAssertNil(notices.current)
    }

    func testTheCopyIsPlainAndShort() {
        let text = WindowNotice.pageRestarted.text
        XCTAssertFalse(text.isEmpty)
        XCTAssertLessThanOrEqual(text.count, 140)
    }
}
