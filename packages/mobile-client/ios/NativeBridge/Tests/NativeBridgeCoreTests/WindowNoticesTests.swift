import XCTest

@testable import NativeBridgeCore

// sc-5220: the brief notice after each automatic page reload, and its one slot
@MainActor
final class WindowNoticesTests: XCTestCase {
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
    // Stands in for the sc-5219 notices that outrank this one
    private let mustStay = WindowNotice(text: "Must stay", lifetime: .persistent)

    private func notices() -> WindowNotices {
        WindowNotices(
            schedule: scheduler.schedule, announce: { [unowned self] in self.announced.append($0) },
            now: { [unowned self] in self.clock })
    }

    private func readyNotices() -> WindowNotices {
        let notices = notices()
        notices.pageDidLoad()
        notices.windowChanged(isActive: true)
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
        notices.windowChanged(isActive: true)
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

    func testLeavingTheAppRestartsTheCountWithoutAnnouncingAgain() {
        let notices = readyNotices()
        notices.show(.pageRestarted)
        notices.pageDidLoad()
        let firstHide = scheduler.pending.removeFirst()
        notices.windowChanged(isActive: false)
        firstHide.work()
        XCTAssertEqual(notices.current, .pageRestarted, "an old timer must not hide it")
        notices.windowChanged(isActive: true)
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

    // Hiding moves the page, so it must not happen under a finger
    func testInputDelaysHidingByTwoSeconds() {
        let notices = readyNotices()
        notices.show(.pageRestarted)
        notices.pageDidLoad()
        clock += 14.5
        notices.noteInput()
        XCTAssertEqual(notices.current, .pageRestarted, "input leaves the notice alone")
        clock += 0.5
        scheduler.fireAll()
        XCTAssertEqual(notices.current, .pageRestarted)
        XCTAssertEqual(scheduler.pending.count, 1)
        XCTAssertEqual(scheduler.pending[0].delay, 1.5, accuracy: 0.001)
        clock += 1.5
        scheduler.fireAll()
        XCTAssertNil(notices.current)
    }

    // Used by Dismiss and when the "stopped working" alert is wanted
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

    func testChangesAreReported() {
        let notices = readyNotices()
        var seen: [WindowNotice?] = []
        notices.onChange = { seen.append($0) }
        notices.show(.pageRestarted)
        notices.pageDidLoad()
        notices.clear()
        XCTAssertEqual(seen, [.pageRestarted, nil])
    }

    // MARK: One slot: a notice that must stay wins (native-durable-writes)

    func testAPersistentNoticeReplacesATimedOneAtOnceAndStays() {
        let notices = readyNotices()
        notices.show(.pageRestarted)
        notices.pageDidLoad()
        let hide = scheduler.pending.removeFirst()
        notices.show(mustStay)
        XCTAssertEqual(notices.current, mustStay)
        XCTAssertEqual(announced.last, "Must stay")
        hide.work()
        XCTAssertEqual(notices.current, mustStay)
        XCTAssertTrue(scheduler.pending.isEmpty, "it never hides itself")
    }

    func testAPersistentNoticeNeedsNoLoadedPage() {
        let notices = notices()
        notices.show(mustStay)
        XCTAssertEqual(notices.current, mustStay)
    }

    func testAPersistentNoticeDropsAWaitingTimedOne() {
        let notices = readyNotices()
        notices.show(.pageRestarted)
        notices.show(mustStay)
        notices.pageDidLoad()
        XCTAssertEqual(notices.current, mustStay)
        XCTAssertEqual(announced, ["Must stay"])
    }

    func testATimedNoticeNeverAppearsOverAPersistentOne() {
        let notices = readyNotices()
        notices.show(mustStay)
        notices.show(.pageRestarted)
        notices.pageDidLoad()
        XCTAssertEqual(notices.current, mustStay)
        XCTAssertEqual(announced, ["Must stay"])
        XCTAssertTrue(scheduler.pending.isEmpty)
    }

    // The alert clears the slot, and its Reload must not take away the notice
    // about changes that may not have been saved
    func testClearLeavesAPersistentNotice() {
        let notices = readyNotices()
        notices.show(mustStay)
        notices.clear()
        XCTAssertEqual(notices.current, mustStay)
    }
}
