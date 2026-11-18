import AppKit
import WebKit
import XCTest

@testable import HomeEconomicsMac

// Story 5220: every automatic page reload shows a brief notice under the title bar
@MainActor
final class ReloadNoticeTests: XCTestCase {
    // MARK: The host says when it reloaded on its own and when the page loaded

    private var automaticReloads = 0
    private var gaveUp = 0
    private var pagesLoaded = 0

    private func host() -> MacEngineHost {
        let host = MacEngineHost(
            www: FileManager.default.temporaryDirectory, version: "test", policy: NavigationPolicy(allowedHosts: []),
            openInBrowser: { _ in })
        host.loadPage = { _ in }
        host.onAutomaticReload = { [unowned self] in self.automaticReloads += 1 }
        host.onPageGone = { [unowned self] in self.gaveUp += 1 }
        host.onPageLoaded = { [unowned self] in self.pagesLoaded += 1 }
        return host
    }

    func testEachAutomaticReloadIsReported() {
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

    func testAFinishedOrFailedLoadIsReported() {
        let host = host()
        let error = URLError(.cannotConnectToHost)
        host.webView(host.webView, didFinish: nil)
        host.webView(host.webView, didFail: nil, withError: error)
        host.webView(host.webView, didFailProvisionalNavigation: nil, withError: error)
        XCTAssertEqual(pagesLoaded, 3)
    }

    // MARK: The notice

    private final class FakeScheduler {
        var pending: [(delay: TimeInterval, work: () -> Void)] = []
        func schedule(_ delay: TimeInterval, _ work: @escaping () -> Void) { pending.append((delay, work)) }
        func fireAll() {
            let due = pending
            pending = []
            due.forEach { $0.work() }
        }
    }

    private let scheduler = FakeScheduler()
    private var announced: [String] = []
    private var clock = Date(timeIntervalSince1970: 1_000)
    private let notStored = WindowNotice(text: "Not stored", lifetime: .persistent)

    private func notices() -> WindowNotices {
        WindowNotices(
            schedule: scheduler.schedule, announce: { [unowned self] in self.announced.append($0) },
            now: { [unowned self] in self.clock })
    }

    private func readyNotices() -> WindowNotices {
        let notices = notices()
        notices.pageDidLoad()
        notices.windowChanged(isKeyAndVisible: true)
        return notices
    }

    func testTheCopyIsTheAgreedText() {
        XCTAssertEqual(
            WindowNotice.pageRestarted.text,
            "The app restarted just now, so your last change may not have been saved. Check it, and make it again if it’s missing.")
    }

    func testItWaitsForThePageToLoad() {
        let notices = readyNotices()
        notices.show(.pageRestarted)
        XCTAssertNil(notices.current)
        XCTAssertTrue(announced.isEmpty)
        XCTAssertTrue(scheduler.pending.isEmpty)
        notices.pageDidLoad()
        XCTAssertEqual(notices.current, .pageRestarted)
        XCTAssertEqual(announced, [WindowNotice.pageRestarted.text])
        XCTAssertEqual(scheduler.pending.map(\.delay), [15])
    }

    func testARestartInTheBackgroundShowsInFullOnReturn() {
        let notices = notices()
        notices.show(.pageRestarted)
        notices.pageDidLoad()
        XCTAssertNil(notices.current)
        XCTAssertTrue(announced.isEmpty)
        notices.windowChanged(isKeyAndVisible: true)
        XCTAssertEqual(notices.current, .pageRestarted)
        XCTAssertEqual(announced.count, 1)
        XCTAssertEqual(scheduler.pending.map(\.delay), [15])
    }

    func testItHidesAfterFifteenSeconds() {
        let notices = readyNotices()
        notices.show(.pageRestarted)
        notices.pageDidLoad()
        clock += 15
        scheduler.fireAll()
        XCTAssertNil(notices.current)
    }

    func testLeavingTheWindowRestartsTheCountWithoutAnnouncingAgain() {
        let notices = readyNotices()
        notices.show(.pageRestarted)
        notices.pageDidLoad()
        let firstHide = scheduler.pending.removeFirst()
        notices.windowChanged(isKeyAndVisible: false)
        firstHide.work()
        XCTAssertEqual(notices.current, .pageRestarted, "an old timer must not hide it")
        notices.windowChanged(isKeyAndVisible: true)
        XCTAssertEqual(scheduler.pending.map(\.delay), [15])
        XCTAssertEqual(announced.count, 1)
    }

    func testAnotherLoadDoesNotExtendTheCount() {
        let notices = readyNotices()
        notices.show(.pageRestarted)
        notices.pageDidLoad()
        notices.pageDidLoad()
        XCTAssertEqual(scheduler.pending.count, 1)
    }

    func testAnotherRestartStartsOverAndAnnouncesAgain() {
        let notices = readyNotices()
        notices.show(.pageRestarted)
        notices.pageDidLoad()
        let firstHide = scheduler.pending.removeFirst()
        notices.show(.pageRestarted)
        firstHide.work()
        XCTAssertEqual(notices.current, .pageRestarted)
        notices.pageDidLoad()
        XCTAssertEqual(announced.count, 2)
        XCTAssertEqual(scheduler.pending.map(\.delay), [15])
    }

    // The spec's "The person keeps working"
    func testInputDelaysHidingByTwoSeconds() {
        let notices = readyNotices()
        notices.show(.pageRestarted)
        notices.pageDidLoad()
        clock += 14.5
        notices.noteInput()
        XCTAssertEqual(notices.current, .pageRestarted, "input leaves the notice alone")
        clock += 0.5
        scheduler.fireAll()
        XCTAssertEqual(notices.current, .pageRestarted, "the page must not move under a click")
        XCTAssertEqual(scheduler.pending.count, 1)
        XCTAssertEqual(scheduler.pending[0].delay, 1.5, accuracy: 0.001)
        clock += 1.5
        scheduler.fireAll()
        XCTAssertNil(notices.current)
    }

    func testClearRemovesAShownOrWaitingNotice() {
        let notices = readyNotices()
        notices.show(.pageRestarted)
        notices.pageDidLoad()
        let hide = scheduler.pending.removeFirst()
        notices.clear()
        XCTAssertNil(notices.current)
        hide.work()

        notices.show(.pageRestarted)
        notices.clear()
        notices.pageDidLoad()
        XCTAssertNil(notices.current, "a cleared notice must not appear later")
        XCTAssertEqual(announced.count, 1)
    }

    // MARK: One slot: a persistent notice wins (story 5219's rule)

    func testAPersistentNoticeReplacesATimedOneAtOnceAndStays() {
        let notices = readyNotices()
        notices.show(.pageRestarted)
        notices.pageDidLoad()
        let hide = scheduler.pending.removeFirst()
        notices.show(notStored)
        XCTAssertEqual(notices.current, notStored)
        XCTAssertEqual(announced.last, "Not stored")
        hide.work()
        XCTAssertEqual(notices.current, notStored)
        XCTAssertTrue(scheduler.pending.isEmpty, "it never hides itself")
    }

    func testAPersistentNoticeNeedsNoLoadedPage() {
        let notices = notices()
        notices.show(notStored)
        XCTAssertEqual(notices.current, notStored)
    }

    func testAPersistentNoticeDropsAWaitingTimedOne() {
        let notices = readyNotices()
        notices.show(.pageRestarted)
        notices.show(notStored)
        notices.pageDidLoad()
        XCTAssertEqual(notices.current, notStored)
        XCTAssertEqual(announced, ["Not stored"])
    }

    func testATimedNoticeNeverAppearsOverAPersistentOne() {
        let notices = readyNotices()
        notices.show(notStored)
        notices.show(.pageRestarted)
        notices.pageDidLoad()
        XCTAssertEqual(notices.current, notStored)
        XCTAssertEqual(announced, ["Not stored"])
        XCTAssertTrue(scheduler.pending.isEmpty)
    }

    func testClearLeavesAPersistentNotice() {
        let notices = readyNotices()
        notices.show(notStored)
        notices.clear()
        XCTAssertEqual(notices.current, notStored)
    }

    // MARK: The strip

    private func container(width: CGFloat) -> (NoticeContainer, NSView) {
        let page = NSView()
        let container = NoticeContainer(frame: NSRect(x: 0, y: 0, width: width, height: 400), content: page)
        container.layoutSubtreeIfNeeded()
        return (container, page)
    }

    func testThePageFillsTheWindowWithoutANotice() {
        let (container, page) = container(width: 800)
        XCTAssertEqual(page.frame, container.bounds)
        XCTAssertTrue(container.strip.isHidden)
    }

    func testTheStripSitsAtTheTopAndMovesThePageDown() {
        let (container, page) = container(width: 800)
        container.show(WindowNotice.pageRestarted.text)
        XCTAssertFalse(container.strip.isHidden)
        XCTAssertEqual(container.strip.frame.maxY, container.bounds.maxY)
        XCTAssertEqual(page.frame.maxY, container.strip.frame.minY, "nothing is covered")
        XCTAssertEqual(page.frame.minY, 0)
        container.show(nil)
        XCTAssertTrue(container.strip.isHidden)
        XCTAssertEqual(page.frame, container.bounds)
    }

    func testTheStripGrowsWhenItsTextWraps() {
        let (wide, _) = container(width: 1200)
        let (narrow, page) = container(width: 320)
        wide.show(WindowNotice.pageRestarted.text)
        narrow.show(WindowNotice.pageRestarted.text)
        XCTAssertGreaterThan(narrow.strip.frame.height, wide.strip.frame.height)
        XCTAssertEqual(page.frame.maxY, narrow.strip.frame.minY)
    }

    func testTheStripFollowsAResize() {
        let (container, page) = container(width: 1200)
        container.show(WindowNotice.pageRestarted.text)
        let wideHeight = container.strip.frame.height
        container.setFrameSize(NSSize(width: 320, height: 400))
        container.layoutSubtreeIfNeeded()
        XCTAssertGreaterThan(container.strip.frame.height, wideHeight)
        XCTAssertEqual(page.frame.maxY, container.strip.frame.minY)
    }

    func testTheStripTakesClicksAndNeverFocus() {
        let (container, _) = container(width: 800)
        container.show("Text")
        XCTAssertFalse(container.strip.acceptsFirstResponder)
        let inside = NSPoint(x: container.strip.frame.minX + 1, y: container.strip.frame.minY + 1)
        XCTAssertTrue(container.hitTest(inside) === container.strip, "clicks must not fall through to the page")
    }

    func testDismissIsAButtonWithAVoiceOverLabel() {
        let (container, _) = container(width: 800)
        var dismissed = 0
        container.onDismiss = { dismissed += 1 }
        container.show("Text")
        XCTAssertEqual(container.dismissButton.title, "Dismiss")
        XCTAssertEqual(container.dismissButton.accessibilityLabel(), "Dismiss this notice")
        XCTAssertFalse(container.dismissButton.refusesFirstResponder, "reachable from the keyboard")
        container.dismissButton.performClick(nil)
        XCTAssertEqual(dismissed, 1)
    }
}
