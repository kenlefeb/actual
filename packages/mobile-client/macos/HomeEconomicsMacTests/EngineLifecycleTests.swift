import XCTest

@testable import HomeEconomicsMac

// sc-4942 task 1.5: the engine's window is hidden, never closed, and views
// re-read on activation and wake, never while inactive or asleep
final class EngineLifecycleTests: XCTestCase {
    private final class FakeWindow: EngineWindow {
        var visible = true
        var orderedOut = 0
        func orderOut(_ sender: Any?) {
            visible = false
            orderedOut += 1
        }
        func makeKeyAndOrderFront(_ sender: Any?) { visible = true }
    }

    private var reads = 0
    private lazy var lifecycle = EngineLifecycle { [unowned self] in self.reads += 1 }

    func testClosingTheWindowHidesItWithoutClosingIt() {
        let window = FakeWindow()
        XCTAssertFalse(lifecycle.windowShouldClose(window))
        XCTAssertFalse(window.visible)
        XCTAssertEqual(window.orderedOut, 1)
    }

    // sc-5219 (D8): storage is flushed before the window goes or the app quits
    private var flushes: [() -> Void] = []
    private lazy var flushing = EngineLifecycle(reread: {}, flush: { [unowned self] in self.flushes.append($0) })

    func testClosingTheWindowWaitsForTheFlush() {
        let window = FakeWindow()
        XCTAssertFalse(flushing.windowShouldClose(window))
        XCTAssertTrue(window.visible)
        flushes[0]()
        XCTAssertFalse(window.visible)
    }

    func testQuittingRepliesOnceAfterTheFlush() {
        var replies = 0
        flushing.shouldTerminate { replies += 1 }
        flushing.shouldTerminate { replies += 1 }
        XCTAssertEqual(flushes.count, 1)
        XCTAssertEqual(replies, 0)
        flushes[0]()
        XCTAssertEqual(replies, 1)
    }

    func testSleepAsksForABestEffortFlush() {
        flushing.willSleep()
        XCTAssertEqual(flushes.count, 1)
    }

    func testTheAppKeepsRunningWithNoWindow() {
        XCTAssertFalse(EngineLifecycle.terminatesAfterLastWindowClosed)
    }

    func testReopeningShowsTheSameWindowAndReReads() {
        let window = FakeWindow()
        lifecycle.didBecomeActive()
        reads = 0
        _ = lifecycle.windowShouldClose(window)
        lifecycle.reopen(window)
        XCTAssertTrue(window.visible)
        XCTAssertEqual(reads, 1)
    }

    func testActivationReReads() {
        lifecycle.didBecomeActive()
        XCTAssertEqual(reads, 1)
    }

    func testWakeReReadsOnlyWhileActive() {
        lifecycle.didBecomeActive()
        lifecycle.willSleep()
        lifecycle.didWake()
        XCTAssertEqual(reads, 2)

        lifecycle.didResignActive()
        lifecycle.willSleep()
        lifecycle.didWake()
        XCTAssertEqual(reads, 2)
    }

    func testNoReadWhileAsleep() {
        lifecycle.willSleep()
        lifecycle.didBecomeActive()
        XCTAssertEqual(reads, 0)
        lifecycle.didWake()
        XCTAssertEqual(reads, 1)
    }

    func testNoReadWhileInactive() {
        let window = FakeWindow()
        lifecycle.reopen(window)
        lifecycle.didWake()
        XCTAssertEqual(reads, 0)
    }
}
