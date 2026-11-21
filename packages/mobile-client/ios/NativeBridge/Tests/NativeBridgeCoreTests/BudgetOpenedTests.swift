import Foundation
import XCTest

@testable import NativeBridgeCore

// native-bridge (sc-5496): "A native screen that has not loaded re-reads when
// the budget opens". A read refused during a slow open leaves a screen failed;
// loot-core's `budget-opened` event re-reads it once, and only it.
private let fixturesDir = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("loot-core/src/server/native/fixtures")

private func fixture(_ name: String) -> String {
    String(decoding: (try? Data(contentsOf: fixturesDir.appendingPathComponent("\(name).json"))) ?? Data(), as: UTF8.self)
}

private struct Refused: Error {}

// What each read does, in order; reads after the plan succeed
private enum Step { case ok, refuse, holdThenRefuse }

private final class Reads: @unchecked Sendable {
    private let lock = NSLock()
    private var plan: [Step]
    private var started = 0
    private var released = false
    init(_ plan: [Step]) { self.plan = plan }

    var count: Int { lock.lock(); defer { lock.unlock() }; return started }
    func release() { lock.lock(); released = true; lock.unlock() }

    func next() -> (step: Step, isReleased: () -> Bool) {
        lock.lock(); defer { lock.unlock() }
        started += 1
        let step = plan.isEmpty ? Step.ok : plan.removeFirst()
        return (step, { self.lock.lock(); defer { self.lock.unlock() }; return self.released })
    }

    func client(_ json: String) -> NativeBridgeClient {
        NativeBridgeClient(timeout: 5) { _, _ in
            let (step, isReleased) = self.next()
            switch step {
            case .ok: return json
            case .refuse: throw Refused()
            case .holdThenRefuse:
                while !isReleased() { try await Task.sleep(nanoseconds: 1_000_000) }
                throw Refused()
            }
        }
    }
}

@MainActor
private protocol OpenedScreen: AnyObject {
    func load() async
    func budgetOpened() async
    func setSceneActive(_ active: Bool) async
    var isLoaded: Bool { get }
    var isFailed: Bool { get }
}

extension AccountsListViewModel: OpenedScreen {
    var isLoaded: Bool { if case .loaded = state { return true } else { return false } }
    var isFailed: Bool { if case .failed = state { return true } else { return false } }
}

extension BudgetViewModel: OpenedScreen {
    var isLoaded: Bool { if case .loaded = state { return true } else { return false } }
    var isFailed: Bool { if case .failed = state { return true } else { return false } }
}

extension PaychecksViewModel: OpenedScreen {
    var isLoaded: Bool { if case .loaded = state { return true } else { return false } }
    var isFailed: Bool { if case .failed = state { return true } else { return false } }
}

@MainActor
final class BudgetOpenedTests: XCTestCase {
    private typealias Make = (NativeBridgeClient) -> OpenedScreen
    private let screens: [(name: String, json: String, make: Make)] = [
        ("accounts", fixture("accounts-list"), { AccountsListViewModel(client: $0) }),
        ("budget", fixture("budget-month-envelope"), { BudgetViewModel(client: $0) }),
        ("paychecks", fixture("schedules-paychecks"), { PaychecksViewModel(client: $0) }),
    ]

    func testAFailedScreenReReadsOnceAndLoads() async {
        for screen in screens {
            let reads = Reads([.refuse])
            let model = screen.make(reads.client(screen.json))
            await model.load()
            XCTAssertTrue(model.isFailed, screen.name)
            await model.budgetOpened()
            XCTAssertEqual(reads.count, 2, screen.name)
            XCTAssertTrue(model.isLoaded, screen.name)
        }
    }

    func testALoadedScreenIgnoresIt() async {
        for screen in screens {
            let reads = Reads([])
            let model = screen.make(reads.client(screen.json))
            await model.load()
            await model.budgetOpened()
            XCTAssertEqual(reads.count, 1, screen.name)
            XCTAssertTrue(model.isLoaded, screen.name)
        }
    }

    func testAReadInFlightIsReplacedAndItsLateRefusalDoesNotOverwriteTheNewerRead() async throws {
        for screen in screens {
            let reads = Reads([.holdThenRefuse])
            let model = screen.make(reads.client(screen.json))
            let first = Task { await model.load() }
            try await waitUntil("the first read started") { reads.count == 1 }
            await model.budgetOpened()
            XCTAssertEqual(reads.count, 2, screen.name)
            XCTAssertTrue(model.isLoaded, screen.name)
            reads.release()
            await first.value
            XCTAssertTrue(model.isLoaded, "the older refusal must not win: \(screen.name)")
            XCTAssertEqual(reads.count, 2, screen.name)
        }
    }

    func testAFailedReReadStaysFailedAndDoesNotLoop() async {
        for screen in screens {
            let reads = Reads([.refuse, .refuse])
            let model = screen.make(reads.client(screen.json))
            await model.load()
            await model.budgetOpened()
            for _ in 0..<50 { await Task.yield() }
            XCTAssertEqual(reads.count, 2, screen.name)
            XCTAssertTrue(model.isFailed, screen.name)
        }
    }

    func testABackgroundScreenDoesNotReadAndTheReadOnReturningCoversIt() async {
        for screen in screens {
            let reads = Reads([.refuse])
            let model = screen.make(reads.client(screen.json))
            await model.load()
            await model.setSceneActive(false)
            await model.budgetOpened()
            XCTAssertEqual(reads.count, 1, screen.name)
            await model.setSceneActive(true)
            XCTAssertEqual(reads.count, 2, screen.name)
            XCTAssertTrue(model.isLoaded, screen.name)
        }
    }

    // The shells' routing: `budget-opened` goes only to its own handler, never
    // to the change path (a loaded Budget screen re-reads on any event there)
    func testBudgetOpenedNeverReachesTheChangePathOfALoadedBudgetScreen() async throws {
        let json = fixture("budget-month-envelope")
        let reads = Reads([])
        let model = BudgetViewModel(client: reads.client(json))
        await model.load()
        XCTAssertEqual(reads.count, 1)

        // Wired as the shells wire it: onBudgetOpened to budgetOpened(), the rest to the change path
        func deliver(_ event: String) {
            PageEventRouting.route(event, onBudgetOpened: { Task { await model.budgetOpened() } }) {
                model.changeEventReceived()
            }
        }
        deliver("budget-opened")
        try await Task.sleep(nanoseconds: 300_000_000)
        XCTAssertEqual(reads.count, 1, "a loaded screen must not read on budget-opened")

        // The harness does reach the change path for any other event
        deliver("cells-changed")
        try await waitUntil("the change path re-read") { reads.count == 2 }
    }

    func testBudgetOpenedReachesAFailedScreenThroughTheRoute() async throws {
        let reads = Reads([.refuse])
        let model = BudgetViewModel(client: reads.client(fixture("budget-month-envelope")))
        await model.load()
        PageEventRouting.route("budget-opened", onBudgetOpened: { Task { await model.budgetOpened() } }) {
            XCTFail("budget-opened must not reach the change path")
        }
        try await waitUntil("the re-read loaded") { model.isLoaded }
        XCTAssertEqual(reads.count, 2)
    }
}
